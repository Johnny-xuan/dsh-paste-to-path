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

export const Config = z.object({
  longTextAsAttachment: z.boolean().required(),
  longTextThreshold: z.natural().min(1).required(),
  nativeImageExtensions: z.array(z.string()).required(),
  maxBytes: z.natural().min(1).required(),
  editableTextMaxBytes: z.natural().min(1).required(),
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

export function resolveConfig(config = {}) {
  const resolved = Config(config)
  return {
    ...resolved,
    nativeImageExtensions: normalizeImageExtensions(resolved.nativeImageExtensions),
  }
}

function normalizeImageExtension(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^\.+/, '')
}

function normalizeImageExtensions(values) {
  return [...new Set(values.map(normalizeImageExtension).filter(Boolean))]
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

const SETTINGS_NAMESPACE = 'paste-to-path'
const SETTINGS_MAX_BODY_BYTES = 64 * 1024

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = req.headers?.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostUrl.hostname)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function settingsView(descriptor) {
  return {
    ns: String(descriptor.ns),
    schema: descriptor.schema,
    value: descriptor.value,
    ...(descriptor.base === undefined ? {} : { base: descriptor.base }),
    ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
    ...(descriptor.secrets === undefined ? {} : {
      secrets: descriptor.secrets.map((secret) => ({ path: [...secret.path], set: secret.set })),
    }),
    revision: descriptor.revision,
  }
}

function settingsFailure(error) {
  const message = String(error?.message ?? error)
  return {
    ok: false,
    code: error?.code === 'SETTINGS_CONFLICT' || error?.name === 'SettingsConflictError'
      ? 'settings-conflict'
      : 'settings-rejected',
    message,
  }
}

async function readSettingsBody(req) {
  const body = await readBody(req, SETTINGS_MAX_BODY_BYTES, true)
  if (body.length === 0) return {}
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new RequestError(400, 'invalid JSON body')
  }
}

function settingsDescriptor(settings) {
  return settings
    .describe({ redactSecrets: true })
    .find((descriptor) => String(descriptor.ns) === SETTINGS_NAMESPACE)
}

function settingsRoutes(settings) {
  const guard = (req, res) => {
    if (!isLoopbackRequest(req)) {
      json(res, 403, { error: 'loopback requests only' })
      return false
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: `method not allowed: ${req.method ?? ''}` }, { allow: 'POST' })
      return false
    }
    return true
  }

  return [
    {
      name: 'paste-to-path-settings-describe',
      kind: 'exact',
      path: '/paste-to-path/settings/describe',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const descriptor = settingsDescriptor(settings)
        if (descriptor === undefined) {
          json(res, 200, { ok: false, code: 'settings-not-registered', message: 'paste-to-path settings are not registered' })
          return
        }
        json(res, 200, {
          ok: true,
          value: {
            namespaces: [settingsView(descriptor)],
            writable: settings.writable !== false,
          },
        })
      },
    },
    {
      name: 'paste-to-path-settings-mutate',
      kind: 'exact',
      path: '/paste-to-path/settings/mutate',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const body = await readSettingsBody(req)
          if (body === null || typeof body !== 'object' || body.ns !== SETTINGS_NAMESPACE || !Array.isArray(body.ops)) {
            throw new RequestError(400, 'malformed settings request')
          }
          const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
          await settings.mutate(SETTINGS_NAMESPACE, body.ops, expectedRevision)
          const descriptor = settingsDescriptor(settings)
          if (descriptor === undefined) throw new Error('paste-to-path settings were disposed after the update')
          json(res, 200, { ok: true, value: settingsView(descriptor) })
        } catch (error) {
          if (error instanceof RequestError) {
            json(res, error.status, { ok: false, code: 'settings-rejected', message: error.message })
            return
          }
          json(res, 200, settingsFailure(error))
        }
      },
    },
  ]
}

export function apply(ctx, rawConfig = {}) {
  const entryConfig = resolveConfig(rawConfig)
  const settings = ctx.settings.register('paste-to-path', Config, {
    base: entryConfig,
  })
  let config = settings.get()
  settings.watch((next) => {
    config = {
      ...next,
      nativeImageExtensions: normalizeImageExtensions(next.nativeImageExtensions),
    }
  })
  const defaultFallbackDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tmp-paste')
  const registry = new Map()

  const routes = [
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

  for (const route of [...routes, ...settingsRoutes(ctx.settings)]) ctx.webServer.register(route)
  ctx.effect?.(() => () => registry.clear(), 'dsh-paste-to-path: attachment registry')
}
