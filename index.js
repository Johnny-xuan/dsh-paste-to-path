// dsh-paste-to-path — host half.
//
// Clipboard/drop bytes are stored before DSH can admit them as native image
// content. The browser keeps only an opaque reference plus an absolute path.

import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'

export const name = 'dsh-paste-to-path'
export const inject = ['webServer']

const DEFAULTS = Object.freeze({
  longTextAsAttachment: true,
  longTextThreshold: 8000,
  maxBytes: 25 * 1024 * 1024,
  editableTextMaxBytes: 1024 * 1024,
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
  return {
    longTextAsAttachment: config.longTextAsAttachment !== false,
    longTextThreshold: positiveInteger(config.longTextThreshold, DEFAULTS.longTextThreshold),
    maxBytes: positiveInteger(config.maxBytes, DEFAULTS.maxBytes),
    editableTextMaxBytes: positiveInteger(config.editableTextMaxBytes, DEFAULTS.editableTextMaxBytes),
    dir: config.dir,
  }
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

export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  const fallbackDir = config.dir ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tmp-paste')
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
          const root = await storageRoot(workspace, fallbackDir)
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
  ctx.effect?.(() => () => registry.clear(), 'dsh-paste-to-path: attachment registry')
}
