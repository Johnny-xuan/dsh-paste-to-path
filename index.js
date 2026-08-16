// dsh-paste-to-path — host half.
//
// Clipboard/drop bytes are stored before DSH can admit them as native image
// content. The browser keeps only an opaque reference plus an absolute path.

import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-paste-to-path'
export const inject = ['webServer', 'settings']

const DEFAULTS = Object.freeze({
  longTextAsAttachment: true,
  longTextThreshold: 8000,
  maxBytes: 25 * 1024 * 1024,
  editableTextMaxBytes: 1024 * 1024,
})

export const Config = z.object({
  longTextAsAttachment: z.boolean().default(DEFAULTS.longTextAsAttachment),
  longTextThreshold: z.natural().min(1).default(DEFAULTS.longTextThreshold),
  maxBytes: z.natural().min(1).default(DEFAULTS.maxBytes),
  editableTextMaxBytes: z.natural().min(1).default(DEFAULTS.editableTextMaxBytes),
  dir: z.string(),
})

const CATEGORY_RULES = [
  { category: 'images', extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif', '.bmp', '.svg', '.ico'] },
  { category: 'docs', extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.rtf'] },
  { category: 'text', extensions: ['.txt', '.md', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm', '.log'] },
  { category: 'code', extensions: ['.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.c', '.cpp', '.h', '.go', '.rs', '.sh', '.sql', '.ipynb', '.css', '.scss'] },
  { category: 'archive', extensions: ['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz'] },
]

const MEDIA_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif'],
  ['image/bmp', '.bmp'],
  ['image/svg+xml', '.svg'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
])

class RequestError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

export function resolveConfig(config = {}) {
  const resolved = {
    longTextAsAttachment: config.longTextAsAttachment !== false,
    longTextThreshold: positiveInteger(config.longTextThreshold, DEFAULTS.longTextThreshold),
    maxBytes: positiveInteger(config.maxBytes, DEFAULTS.maxBytes),
    editableTextMaxBytes: positiveInteger(config.editableTextMaxBytes, DEFAULTS.editableTextMaxBytes),
  }
  if (typeof config.dir === 'string') resolved.dir = config.dir
  return resolved
}

function firstHeader(value) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function decodedHeader(req, key) {
  const value = firstHeader(req.headers[key])
  if (value === '') return ''
  try {
    return decodeURIComponent(value)
  } catch {
    throw new RequestError(400, `invalid ${key} header`)
  }
}

function normalizedMediaType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase()
}

export function categoryOf(fileName, mediaType = '') {
  const extension = extname(fileName).toLowerCase()
  for (const rule of CATEGORY_RULES) {
    if (rule.extensions.includes(extension)) return rule.category
  }
  const media = normalizedMediaType(mediaType)
  if (media.startsWith('image/')) return 'images'
  if (media.startsWith('text/')) return 'text'
  if (media === 'application/pdf') return 'docs'
  return 'misc'
}

export function safeFileName(fileName, mediaType = '') {
  const supplied = basename(String(fileName || '').replaceAll('\\', '/'))
  const fallbackExtension = MEDIA_EXTENSIONS.get(normalizedMediaType(mediaType)) ?? '.bin'
  const raw = supplied === '' || supplied === '.' || supplied === '..' ? `paste${fallbackExtension}` : supplied
  const extension = extname(raw).slice(0, 20)
  const stem = basename(raw, extension)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/:\\]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  const safeExtension = extension.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${stem || 'paste'}${safeExtension || fallbackExtension}`
}

async function storageRoot(workspace, fallbackDir) {
  const requested = workspace.trim()
  if (requested === '') return resolve(fallbackDir)
  if (!isAbsolute(requested)) throw new RequestError(400, 'workspace must be an absolute path')
  try {
    const canonical = await realpath(requested)
    if (!(await stat(canonical)).isDirectory()) throw new Error('not a directory')
    return join(canonical, '.dsh', 'pastes')
  } catch (error) {
    if (error instanceof RequestError) throw error
    throw new RequestError(400, 'workspace does not exist or is not a directory')
  }
}

async function writeUnique(directory, fileName, buffer) {
  await mkdir(directory, { recursive: true })
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const file = join(directory, `${Date.now()}-${randomBytes(5).toString('hex')}-${fileName}`)
    try {
      await writeFile(file, buffer, { mode: 0o600, flag: 'wx' })
      return file
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
  throw new Error('could not allocate a unique paste path')
}

function json(res, status, body, headers = {}) {
  if (res.headersSent || res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

async function readBody(req, maxBytes, allowEmpty = false) {
  const declared = Number(firstHeader(req.headers['content-length']))
  if (Number.isFinite(declared) && declared > maxBytes) {
    req.resume?.()
    throw new RequestError(413, `content exceeds the ${maxBytes}-byte limit`)
  }
  const chunks = []
  let size = 0
  let tooLarge = false
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) {
      tooLarge = true
      continue
    }
    chunks.push(chunk)
  }
  if (tooLarge) throw new RequestError(413, `content exceeds the ${maxBytes}-byte limit`)
  if (size === 0 && !allowEmpty) throw new RequestError(400, 'empty body')
  return Buffer.concat(chunks, size)
}

function attachmentFor(registry, req) {
  const id = decodedHeader(req, 'x-attachment-id')
  const sessionId = decodedHeader(req, 'x-session-id')
  const attachment = registry.get(id)
  if (attachment === undefined || attachment.sessionId !== sessionId) {
    throw new RequestError(404, 'attachment not found')
  }
  return attachment
}

const SETTINGS_FIELDS = new Set([
  'longTextAsAttachment',
  'longTextThreshold',
  'maxBytes',
  'editableTextMaxBytes',
])

function isLoopbackSettingsRequest(req) {
  const address = req.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = firstHeader(req.headers.origin)
  if (origin === '') return true
  const host = firstHeader(req.headers.host)
  if (host === '') return false
  try {
    return new URL(origin).host === new URL(`http://${host}`).host
  } catch {
    return false
  }
}

async function readJson(req) {
  const buffer = await readBody(req, 16 * 1024)
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new RequestError(400, 'invalid JSON body')
  }
}

export function apply(ctx, rawConfig = {}) {
  const entryConfig = resolveConfig(rawConfig)
  const settingsScope = ctx.settings.register('paste-to-path', Config, { base: entryConfig })
  let config = resolveConfig(settingsScope.get())
  const disposeSettingsWatch = settingsScope.watch((next) => {
    config = resolveConfig(next)
  })
  const defaultFallbackDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tmp-paste')
  const registry = new Map()

  const routes = [
    {
      name: 'paste-to-path-config',
      kind: 'exact',
      path: '/paste-to-path/config',
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' }, { allow: 'GET' })
        return json(res, 200, {
          longTextAsAttachment: config.longTextAsAttachment,
          longTextThreshold: config.longTextThreshold,
          maxBytes: config.maxBytes,
          editableTextMaxBytes: config.editableTextMaxBytes,
        })
      },
    },
    {
      name: 'paste-to-path-settings',
      kind: 'exact',
      path: '/paste-to-path/settings',
      handler: async (req, res) => {
        try {
          if (!isLoopbackSettingsRequest(req)) throw new RequestError(403, 'local settings access only')
          if (req.method === 'GET') {
            return json(res, 200, { value: config, base: entryConfig, writable: ctx.settings.writable !== false })
          }
          if (req.method === 'PATCH') {
            const body = await readJson(req)
            if (body === null || typeof body !== 'object' || !SETTINGS_FIELDS.has(body.field)) {
              throw new RequestError(400, 'unknown settings field')
            }
            await settingsScope.update({ [body.field]: body.value })
            config = resolveConfig(settingsScope.get())
            return json(res, 200, { value: config, base: entryConfig, writable: ctx.settings.writable !== false })
          }
          if (req.method === 'DELETE') {
            await settingsScope.replace({})
            config = resolveConfig(settingsScope.get())
            return json(res, 200, { value: config, base: entryConfig, writable: ctx.settings.writable !== false })
          }
          return json(res, 405, { error: 'method not allowed' }, { allow: 'GET, PATCH, DELETE' })
        } catch (error) {
          const status = error instanceof RequestError ? error.status : 500
          return json(res, status, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      name: 'paste-to-path-content',
      kind: 'exact',
      path: '/paste-to-path/content',
      handler: async (req, res) => {
        try {
          const attachment = attachmentFor(registry, req)
          if (!attachment.editable) throw new RequestError(409, 'attachment is not editable text')
          if (req.method === 'GET') {
            const content = await readFile(attachment.path, 'utf8')
            return json(res, 200, { content })
          }
          if (req.method === 'PATCH') {
            const buffer = await readBody(req, config.editableTextMaxBytes, true)
            await writeFile(attachment.path, buffer, { mode: 0o600 })
            attachment.bytes = buffer.length
            return json(res, 200, { saved: true, bytes: buffer.length })
          }
          return json(res, 405, { error: 'method not allowed' }, { allow: 'GET, PATCH' })
        } catch (error) {
          const status = error instanceof RequestError ? error.status : 500
          return json(res, status, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      name: 'paste-to-path-upload',
      kind: 'exact',
      path: '/paste-to-path',
      handler: async (req, res) => {
        try {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' }, { allow: 'POST' })
          const sessionId = decodedHeader(req, 'x-session-id')
          if (sessionId === '') throw new RequestError(400, 'x-session-id is required')
          const fileName = decodedHeader(req, 'x-file-name')
          const workspace = decodedHeader(req, 'x-workspace')
          const mediaType = normalizedMediaType(firstHeader(req.headers['content-type']))
          const buffer = await readBody(req, config.maxBytes)
          const category = categoryOf(fileName, mediaType)
          const root = await storageRoot(workspace, config.dir ?? defaultFallbackDir)
          const displayName = safeFileName(fileName, mediaType)
          const path = await writeUnique(join(root, category), displayName, buffer)
          const id = randomUUID()
          const editable = (category === 'text' || category === 'code') && buffer.length <= config.editableTextMaxBytes
          const attachment = { id, sessionId, path, name: displayName, category, mediaType, bytes: buffer.length, editable }
          registry.set(id, attachment)
          return json(res, 200, attachment)
        } catch (error) {
          const status = error instanceof RequestError ? error.status : 500
          return json(res, status, { error: String(error?.message ?? error) })
        }
      },
    },
  ]

  for (const route of routes) ctx.webServer.register(route)
  ctx.effect?.(
    () => () => {
      disposeSettingsWatch()
      registry.clear()
    },
    'dsh-paste-to-path: settings and attachment registry',
  )
}
