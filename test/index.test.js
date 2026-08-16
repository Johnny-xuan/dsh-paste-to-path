import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { apply, categoryOf, resolveConfig, safeFileName } from '../index.js'

const INITIAL_CONFIG = Object.freeze({
  longTextAsAttachment: true,
  longTextThreshold: 8000,
  nativeImageExtensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
  maxBytes: 25 * 1024 * 1024,
  editableTextMaxBytes: 1024 * 1024,
})

function response() {
  return {
    headersSent: false,
    writableEnded: false,
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
      this.headersSent = true
    },
    end(body = '') {
      this.body = body
      this.writableEnded = true
    },
  }
}

function request(method, headers = {}, chunks = []) {
  const req = Readable.from(chunks)
  req.method = method
  req.headers = { host: '127.0.0.1', ...headers }
  req.socket = { remoteAddress: '127.0.0.1' }
  return req
}

function harness(overrides = {}) {
  const routes = new Map()
  let value = resolveConfig({ ...INITIAL_CONFIG, ...overrides })
  let revision = 0
  let user = {}
  const watchers = new Set()
  const settings = {
    writable: true,
    register(namespace, schema, options) {
      assert.equal(namespace, 'paste-to-path')
      assert.deepEqual(options?.base, value)
      return {
        get: () => value,
        watch(callback) {
          watchers.add(callback)
          return () => watchers.delete(callback)
        },
      }
    },
    describe() {
      return [{
        ns: 'paste-to-path',
        schema: {},
        value,
        base: INITIAL_CONFIG,
        user,
        revision,
      }]
    },
    async mutate(namespace, ops, expectedRevision) {
      assert.equal(namespace, 'paste-to-path')
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        const error = new Error(`settings conflict: expected ${expectedRevision}, actual ${revision}`)
        error.code = 'SETTINGS_CONFLICT'
        throw error
      }
      const next = { ...value }
      const nextUser = { ...user }
      for (const op of ops) {
        assert.deepEqual(op.path?.length, 1)
        const field = op.path[0]
        if (op.op === 'set') {
          next[field] = op.value
          nextUser[field] = op.value
        } else if (op.op === 'unset') {
          delete nextUser[field]
          next[field] = INITIAL_CONFIG[field]
        } else {
          throw new Error(`unsupported test op: ${op.op}`)
        }
      }
      value = resolveConfig(next)
      user = nextUser
      revision += 1
      for (const watcher of watchers) watcher(value)
    },
  }
  const ctx = {
    settings,
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    effect() {},
  }
  apply(ctx, value)
  routes.updateSettings = (patch) => {
    value = resolveConfig({ ...value, ...patch })
    for (const watcher of watchers) watcher(value)
  }
  return routes
}

async function call(handler, req) {
  const res = response()
  await handler(req, res)
  return { status: res.status, headers: res.headers, body: JSON.parse(res.body) }
}

test('classifies by extension first and media type as fallback', () => {
  assert.equal(categoryOf('shot.png', 'application/octet-stream'), 'images')
  assert.equal(categoryOf('clipboard', 'image/png'), 'images')
  assert.equal(categoryOf('notes.md', 'text/plain'), 'text')
  assert.equal(categoryOf('bundle.unknown', 'application/octet-stream'), 'misc')
})

test('sanitizes names without throwing away unicode labels', () => {
  assert.equal(safeFileName('../产品 截图.png', 'image/png'), '产品 截图.png')
  assert.equal(safeFileName('', 'image/jpeg'), 'paste.jpg')
  assert.equal(safeFileName('..', 'text/plain'), 'paste.txt')
})

test('requires explicit, valid configuration and preserves the chosen long-text threshold', () => {
  const config = resolveConfig({
    ...INITIAL_CONFIG,
    longTextAsAttachment: false,
    longTextThreshold: 1200,
    editableTextMaxBytes: 12,
  })
  assert.equal(config.longTextAsAttachment, false)
  assert.equal(config.longTextThreshold, 1200)
  assert.equal(config.maxBytes, 25 * 1024 * 1024)
  assert.equal(config.editableTextMaxBytes, 12)
  assert.deepEqual(config.nativeImageExtensions, ['png', 'jpg', 'jpeg', 'webp', 'gif'])
  assert.throws(() => resolveConfig({ ...INITIAL_CONFIG, longTextThreshold: 0 }))
  assert.deepEqual(
    resolveConfig({ ...INITIAL_CONFIG, nativeImageExtensions: ['.BMP', 'bmp', ' custom '] }).nativeImageExtensions,
    ['bmp', 'custom'],
  )
  assert.throws(() => resolveConfig({ longTextThreshold: 1200 }))
})

test('bundled patch provides the initial settings base instead of runtime fallbacks', async () => {
  const [host, client, patch] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../client.js', import.meta.url), 'utf8'),
    readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(host, /8000/)
  assert.doesNotMatch(client, /longTextThreshold:\s*8000/)
  assert.match(patch, /longTextThreshold: 8000/)
  assert.match(patch, /nativeImageExtensions:\s*\n\s*- png\s*\n\s*- jpg\s*\n\s*- jpeg\s*\n\s*- webp\s*\n\s*- gif/)
  assert.match(host, /paste-to-path\/settings\/describe/)
  assert.match(host, /paste-to-path\/settings\/mutate/)
})

test('public package metadata describes the first release and excludes development files', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.version, '0.0.5')
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.publishConfig?.access, 'public')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-attachment'))
  assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-settings-plugins'))
  assert.ok(pkg.peerDependencies?.['@deepseek-ai/dsh-settings'])
  assert.ok(pkg.dependencies?.['@deepseek-ai/schemastery'])
  assert.ok(pkg.files.includes('README.md'))
  assert.ok(pkg.files.includes('README.zh.md'))
  assert.ok(!pkg.files.some((entry) => entry.startsWith('test')))
})

test('browser registers a collapsible settings card with editable native extensions', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const guidance = source.slice(source.indexOf('function modelText'), source.indexOf('function referenceFor'))
  assert.match(source, /Inspect it using an available image-reading method\./)
  assert.match(guidance, /Text attachment:/)
  assert.match(guidance, /Code attachment:/)
  assert.match(guidance, /Document attachment:/)
  assert.match(guidance, /Archive attachment:/)
  assert.match(guidance, /File attachment:/)
  assert.doesNotMatch(guidance, /[\u3400-\u9fff]/)
  assert.doesNotMatch(source, /createDraftImages|\/paste-to-path\/model-capability/)
  assert.doesNotMatch(source, /\/paste-to-path\/config/)
  assert.doesNotMatch(source, /longTextThreshold:\s*8000/)
  assert.match(source, /settings\.plugin\.item/)
  assert.match(source, /createBridgeScope\('paste-to-path'\)/)
  assert.match(source, /settings bridge is unavailable/)
  assert.match(source, /dsh-p2p-settings-header/)
  assert.match(source, /aria-expanded/)
  assert.match(source, /nativeImageExtensions/)
  assert.match(source, /type: 'text'/)
  assert.match(source, /交给 DSH 原生处理的图片后缀/)
  assert.doesNotMatch(source, /nativeImageFormats/)
  assert.match(source, /'image\/png': 'png'/)
  assert.match(source, /'image\/jpeg': 'jpeg'/)
  assert.match(source, /partition\.pathBacked, partition\.native\.length === 0/)
})

test('serves a loopback-only settings bridge with revision-fenced writes', async () => {
  const routes = harness()
  const described = await call(
    routes.get('/paste-to-path/settings/describe'),
    request('POST'),
  )
  assert.equal(described.status, 200)
  assert.equal(described.body.ok, true)
  assert.equal(described.body.value.namespaces[0].value.longTextThreshold, 8000)

  const mutated = await call(
    routes.get('/paste-to-path/settings/mutate'),
    request('POST', {}, [Buffer.from(JSON.stringify({
      ns: 'paste-to-path',
      expectedRevision: described.body.value.namespaces[0].revision,
      ops: [{ op: 'set', path: ['longTextThreshold'], value: 1200 }],
    }))]),
  )
  assert.equal(mutated.body.ok, true)
  assert.equal(mutated.body.value.value.longTextThreshold, 1200)

  const blockedRequest = request('POST')
  blockedRequest.socket = { remoteAddress: '10.0.0.4' }
  const blocked = await call(routes.get('/paste-to-path/settings/describe'), blockedRequest)
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.error, 'loopback requests only')
})

test('uploads into the workspace, exposes editable text, and permits clearing it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-paste-to-path-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const routes = harness({ editableTextMaxBytes: 1024 })
  const sessionId = 'session-test'
  const encodedSession = encodeURIComponent(sessionId)
  const upload = await call(
    routes.get('/paste-to-path'),
    request(
      'POST',
      {
        'x-session-id': encodedSession,
        'x-workspace': encodeURIComponent(root),
        'x-file-name': encodeURIComponent('粘贴内容.txt'),
        'content-type': 'text/plain;charset=utf-8',
      },
      [Buffer.from('hello attachment')],
    ),
  )
  assert.equal(upload.status, 200)
  assert.equal(upload.body.category, 'text')
  assert.equal(upload.body.editable, true)
  assert.equal(await readFile(upload.body.path, 'utf8'), 'hello attachment')
  const mode = (await stat(upload.body.path)).mode & 0o777
  if (process.platform === 'win32') assert.ok((mode & 0o200) !== 0)
  else assert.equal(mode, 0o600)
  assert.ok(upload.body.path.startsWith(join(await realpath(root), '.dsh', 'pastes', 'text')))

  const identity = {
    'x-session-id': encodedSession,
    'x-attachment-id': encodeURIComponent(upload.body.id),
  }
  const opened = await call(routes.get('/paste-to-path/content'), request('GET', identity))
  assert.equal(opened.status, 200)
  assert.deepEqual(opened.body, { content: 'hello attachment' })

  const cleared = await call(
    routes.get('/paste-to-path/content'),
    request('PATCH', { ...identity, 'content-type': 'text/plain', 'content-length': '0' }),
  )
  assert.equal(cleared.status, 200)
  assert.equal(cleared.body.bytes, 0)
  assert.equal(await readFile(upload.body.path, 'utf8'), '')
})

test('rejects cross-session edit and applies live size-limit settings to uploads', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-paste-to-path-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const routes = harness()
  routes.updateSettings({ maxBytes: 4 })
  const oversized = await call(
    routes.get('/paste-to-path'),
    request(
      'POST',
      {
        'x-session-id': 'session-test',
        'x-workspace': encodeURIComponent(root),
        'x-file-name': 'large.bin',
        'content-type': 'application/octet-stream',
      },
      [Buffer.from('12345')],
    ),
  )
  assert.equal(oversized.status, 413)

  const uploaded = await call(
    routes.get('/paste-to-path'),
    request(
      'POST',
      {
        'x-session-id': 'session-test',
        'x-workspace': encodeURIComponent(root),
        'x-file-name': 'a.txt',
        'content-type': 'text/plain',
      },
      [Buffer.from('ok')],
    ),
  )
  const denied = await call(
    routes.get('/paste-to-path/content'),
    request('GET', {
      'x-session-id': 'another-session',
      'x-attachment-id': uploaded.body.id,
    }),
  )
  assert.equal(denied.status, 404)
})
