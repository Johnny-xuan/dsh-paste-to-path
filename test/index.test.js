import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { apply, categoryOf, Config, resolveConfig, safeFileName } from '../index.js'

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
  let value = resolveConfig(overrides)
  const base = value
  const watchers = new Set()
  function publish(next) {
    const previous = value
    value = resolveConfig(next)
    for (const watcher of watchers) watcher(value, previous)
  }
  const ctx = {
    settings: {
      writable: true,
      register(namespace, schema, options) {
        assert.equal(namespace, 'paste-to-path')
        assert.equal(schema, Config)
        assert.deepEqual(options?.base, value)
        return {
          get: () => value,
          watch(callback) {
            watchers.add(callback)
            return () => watchers.delete(callback)
          },
          async update(patch) {
            publish({ ...value, ...patch })
          },
          async replace(section) {
            publish({ ...base, ...section })
          },
        }
      },
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    effect() {},
  }
  apply(ctx, overrides)
  routes.updateSettings = (patch) => {
    publish({ ...value, ...patch })
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

test('keeps partial configuration compatible and normalizes invalid numeric values', () => {
  const config = resolveConfig({
    longTextAsAttachment: false,
    longTextThreshold: 1200,
    maxBytes: 0,
    editableTextMaxBytes: 12,
  })
  assert.equal(config.longTextAsAttachment, false)
  assert.equal(config.longTextThreshold, 1200)
  assert.equal(config.maxBytes, 25 * 1024 * 1024)
  assert.equal(config.editableTextMaxBytes, 12)
  assert.deepEqual(Config({ longTextThreshold: 1200 }), {
    longTextAsAttachment: true,
    longTextThreshold: 1200,
    maxBytes: 25 * 1024 * 1024,
    editableTextMaxBytes: 1024 * 1024,
  })
})

test('public package metadata describes the first release and excludes development files', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.version, '0.0.1')
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.publishConfig?.access, 'public')
  assert.equal(pkg.repository?.url, 'git+https://github.com/Johnny-xuan/dsh-paste-to-path.git')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-attachment'))
  assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-locale'))
  assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-settings-plugins'))
  assert.ok(pkg.peerDependencies?.['@deepseek-ai/dsh-settings'])
  assert.ok(pkg.dependencies?.['@deepseek-ai/schemastery'])
  assert.ok(pkg.files.includes('README.md'))
  assert.ok(pkg.files.includes('README.zh.md'))
  assert.ok(!pkg.files.some((entry) => entry.startsWith('test')))
})

test('browser keeps every attachment on the path-backed rail and exposes a resilient settings UI', async () => {
  const [host, source] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../client.js', import.meta.url), 'utf8'),
  ])
  const guidance = source.slice(source.indexOf('function modelText'), source.indexOf('function referenceFor'))
  const zhBlock = source.slice(source.indexOf('var zh ='), source.indexOf('var en ='))
  const enBlock = source.slice(source.indexOf('var en ='), source.indexOf('function fallbackTranslate'))
  const localeKeys = (block) => [...block.matchAll(/^\s+'([^']+)':/gm)].map((match) => match[1]).sort()
  const pasteHandler = source.slice(source.indexOf('function onPaste'), source.indexOf('function onDragEnter'))
  const dropHandler = source.slice(source.indexOf('function onDrop'), source.indexOf('function removeReference'))
  assert.match(source, /Inspect it using an available image-reading method\./)
  assert.match(guidance, /Text attachment:/)
  assert.match(guidance, /Code attachment:/)
  assert.match(guidance, /Document attachment:/)
  assert.match(guidance, /Archive attachment:/)
  assert.match(guidance, /File attachment:/)
  assert.doesNotMatch(guidance, /[\u3400-\u9fff]/)
  assert.deepEqual(localeKeys(zhBlock), localeKeys(enBlock))
  assert.ok(localeKeys(zhBlock).length >= 30)
  assert.match(source, /ctx\.locale\.register\(LOCALE_NS, \{ zh, en \}\)/)
  assert.match(source, /locale: LOCALE_NS/)
  assert.match(source, /children: t\('settings\.title'\)/)
  assert.match(source, /children: editing \? t\('action\.collapse'\) : t\('action\.edit'\)/)
  assert.match(source, /tr\('processing\.failed'/)
  assert.match(pasteHandler, /files\.length > 0[\s\S]*consume\(event, event\.target, files\)/)
  assert.match(dropHandler, /files\.length > 0\) consume\(event, target, files\)/)
  assert.match(source, /createConfigScope\(\)/)
  assert.match(source, /settings\.plugin\.item/)
  assert.match(source, /Reset to profile defaults/)
  assert.match(source, /\/paste-to-path\/config/)
  assert.match(host, /ctx\.settings\.register\('paste-to-path', Config/)
  assert.doesNotMatch(source, /createDraftImages|\/paste-to-path\/model-capability/)
  assert.doesNotMatch(source, /nativeImageExtensions|partitionFiles|NATIVE_IMAGE|isNativeImage/)
  assert.doesNotMatch(source, /createBridgeScope|SETTINGS_BRIDGE|settings bridge|settingsScope\.bind/)
  assert.doesNotMatch(host, /nativeImageExtensions|\/paste-to-path\/settings\/(?:describe|mutate)/)
})

test('serves live settings through a loopback settings surface and safe configuration fallback', async () => {
  const routes = harness({ longTextThreshold: 1200 })
  const initial = await call(routes.get('/paste-to-path/config'), request('GET'))
  assert.equal(initial.status, 200)
  assert.deepEqual(initial.body, {
    longTextAsAttachment: true,
    longTextThreshold: 1200,
    maxBytes: 25 * 1024 * 1024,
    editableTextMaxBytes: 1024 * 1024,
  })

  routes.updateSettings({ longTextAsAttachment: false, maxBytes: 4 })
  const updated = await call(routes.get('/paste-to-path/config'), request('GET'))
  assert.equal(updated.body.longTextAsAttachment, false)
  assert.equal(updated.body.maxBytes, 4)

  const settings = await call(routes.get('/paste-to-path/settings'), request('GET'))
  assert.equal(settings.status, 200)
  assert.equal(settings.body.value.maxBytes, 4)
  assert.equal(settings.body.writable, true)

  const changed = await call(
    routes.get('/paste-to-path/settings'),
    request(
      'PATCH',
      { 'content-type': 'application/json' },
      [Buffer.from(JSON.stringify({ field: 'longTextThreshold', value: 2400 }))],
    ),
  )
  assert.equal(changed.status, 200)
  assert.equal(changed.body.value.longTextThreshold, 2400)

  const reset = await call(routes.get('/paste-to-path/settings'), request('DELETE'))
  assert.equal(reset.status, 200)
  assert.equal(reset.body.value.longTextThreshold, 1200)
  assert.equal(reset.body.value.maxBytes, 25 * 1024 * 1024)

  const remoteRequest = request('GET')
  remoteRequest.socket = { remoteAddress: '10.0.0.4' }
  const blocked = await call(routes.get('/paste-to-path/settings'), remoteRequest)
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.error, 'local settings access only')
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
