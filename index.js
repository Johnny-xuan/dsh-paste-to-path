// dsh-paste-to-path — host half.
//
// Clipboard/drop bytes are stored before DSH can admit them as native image
// content. The browser keeps only an opaque reference plus an absolute path.

import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-paste-to-path'
export const inject = ['webServer', 'settings']

const DEFAULTS = Object.freeze({
  longTextAsAttachment: true,
  longTextThreshold: 8000,
  maxBytes: 25 * 1024 * 1024,
  editableTextMaxBytes: 1024 * 1024,
  pathTextAsAttachment: true,
  windowsClipboardFallback: true,
})

export const Config = z.object({
  longTextAsAttachment: z.boolean().default(DEFAULTS.longTextAsAttachment),
  longTextThreshold: z.natural().min(1).default(DEFAULTS.longTextThreshold),
  maxBytes: z.natural().min(1).default(DEFAULTS.maxBytes),
  editableTextMaxBytes: z.natural().min(1).default(DEFAULTS.editableTextMaxBytes),
  pathTextAsAttachment: z.boolean().default(DEFAULTS.pathTextAsAttachment),
  windowsClipboardFallback: z.boolean().default(DEFAULTS.windowsClipboardFallback),
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
    pathTextAsAttachment: config.pathTextAsAttachment !== false,
    windowsClipboardFallback: config.windowsClipboardFallback !== false,
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

async function readJson(req, maxBytes = 16 * 1024) {
  const buffer = await readBody(req, maxBytes)
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new RequestError(400, 'invalid JSON body')
  }
}

export function normalizePastedPath(value) {
  let candidate = String(value ?? '').trim()
  if (candidate.length >= 2) {
    const quote = candidate[0]
    if ((quote === '"' || quote === "'") && candidate.at(-1) === quote) candidate = candidate.slice(1, -1).trim()
  }
  if (candidate === '' || candidate.length > 4096 || candidate.includes('\0')) {
    throw new RequestError(400, 'invalid local path')
  }
  if (/^file:/i.test(candidate)) {
    try {
      candidate = fileURLToPath(candidate)
    } catch {
      throw new RequestError(400, 'invalid file URL')
    }
  }
  if (!isAbsolute(candidate)) throw new RequestError(400, 'local path must be absolute on the DSH Host')
  return candidate
}

async function registerExistingPath(registry, sessionId, value) {
  const requested = normalizePastedPath(value)
  let path
  let metadata
  try {
    path = await realpath(requested)
    metadata = await stat(path)
  } catch {
    throw new RequestError(404, 'local path does not exist on the DSH Host')
  }
  if (!metadata.isFile()) throw new RequestError(400, 'local path must name a regular file')
  const name = safeFileName(basename(path))
  const category = categoryOf(name)
  const id = randomUUID()
  const attachment = {
    id,
    sessionId,
    path,
    name,
    category,
    mediaType: '',
    bytes: metadata.size,
    editable: false,
    linked: true,
  }
  registry.set(id, attachment)
  return attachment
}

function isDirectLoopbackRequest(req) {
  const address = req.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = firstHeader(req.headers.host)
  if (host === '') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase()
  } catch {
    return false
  }
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]') return false
  const origin = firstHeader(req.headers.origin)
  if (origin === '') return true
  try {
    return new URL(origin).host === new URL(`http://${host}`).host
  } catch {
    return false
  }
}

const WINDOWS_FILE_DROP_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$paths = @([System.Windows.Forms.Clipboard]::GetFileDropList())
ConvertTo-Json -Compress -InputObject $paths
`.trim()

export function readWindowsFileClipboard() {
  if (process.platform !== 'win32') throw new RequestError(501, 'Windows file clipboard is unavailable on this Host')
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_FILE_DROP_SCRIPT],
      { encoding: 'utf8', maxBuffer: 64 * 1024, timeout: 5000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          rejectPromise(new RequestError(502, 'could not read the Windows file clipboard'))
          return
        }
        try {
          const parsed = JSON.parse(stdout.trim() || '[]')
          const paths = Array.isArray(parsed) ? parsed : [parsed]
          const filtered = paths.filter((value) => typeof value === 'string' && value.trim() !== '').slice(0, 32)
          if (filtered.length === 0) throw new RequestError(404, 'Windows file clipboard is empty')
          resolvePromise(filtered)
        } catch (parseError) {
          rejectPromise(parseError instanceof RequestError ? parseError : new RequestError(502, 'invalid Windows clipboard response'))
        }
      },
    )
  })
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
          pathTextAsAttachment: config.pathTextAsAttachment,
          windowsClipboardFallback: config.windowsClipboardFallback,
        })
      },
    },
    {
      name: 'paste-to-path-windows-clipboard',
      kind: 'exact',
      path: '/paste-to-path/windows-clipboard',
      handler: async (req, res) => {
        try {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' }, { allow: 'POST' })
          if (!config.windowsClipboardFallback) throw new RequestError(403, 'Windows clipboard fallback is disabled')
          if (!isDirectLoopbackRequest(req)) throw new RequestError(403, 'Windows clipboard access requires direct localhost')
          const sessionId = decodedHeader(req, 'x-session-id')
          if (sessionId === '') throw new RequestError(400, 'x-session-id is required')
          const paths = await readWindowsFileClipboard()
          const attachments = []
          for (const path of paths) attachments.push(await registerExistingPath(registry, sessionId, path))
          return json(res, 200, { attachments })
        } catch (error) {
          const status = error instanceof RequestError ? error.status : 500
          return json(res, status, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      name: 'paste-to-path-from-path',
      kind: 'exact',
      path: '/paste-to-path/from-path',
      handler: async (req, res) => {
        try {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' }, { allow: 'POST' })
          const sessionId = decodedHeader(req, 'x-session-id')
          if (sessionId === '') throw new RequestError(400, 'x-session-id is required')
          const body = await readJson(req)
          if (body === null || typeof body !== 'object' || typeof body.path !== 'string') {
            throw new RequestError(400, 'path is required')
          }
          return json(res, 200, await registerExistingPath(registry, sessionId, body.path))
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
          const buffer = await readBody(req, config.maxBytes, true)
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
