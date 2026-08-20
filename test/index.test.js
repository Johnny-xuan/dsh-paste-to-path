import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { apply, categoryOf, Config, normalizePastedPath, resolveConfig, safeFileName } from '../index.js'

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
    pathTextAsAttachment: false,
    windowsClipboardFallback: false,
  })
  assert.equal(config.longTextAsAttachment, false)
  assert.equal(config.longTextThreshold, 1200)
  assert.equal(config.maxBytes, 25 * 1024 * 1024)
  assert.equal(config.editableTextMaxBytes, 12)
  assert.equal(config.pathTextAsAttachment, false)
  assert.equal(config.windowsClipboardFallback, false)
  assert.deepEqual(Config({ longTextThreshold: 1200 }), {
    longTextAsAttachment: true,
    longTextThreshold: 1200,
    maxBytes: 25 * 1024 * 1024,
    editableTextMaxBytes: 1024 * 1024,
    pathTextAsAttachment: true,
    windowsClipboardFallback: true,
  })
})

test('public package metadata targets the rc.7 settings contract and excludes development files', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.version, '0.0.2')
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
  assert.ok(!pkg.files.includes('README.zh.md'))
  assert.equal(pkg.peerDependencies?.['@deepseek-ai/dsh-client-ui-settings'], '>=0.1.0-rc.7 <0.2.0')
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
  assert.match(pasteHandler, /pathsOfPaste\(event\)/)
  assert.match(dropHandler, /files\.length > 0\) consume\(event, target, files\)/)
  assert.match(source, /ctx\.settingsScope\.bind\(\{ namespace: 'paste-to-path' \}\)/)
  assert.match(source, /settings\.plugin\.item/)
  assert.match(source, /key: 'paste-to-path'/)
  assert.match(source, /conversation\.input\.left/)
  assert.match(source, /type: 'file'/)
  assert.match(source, /Reset to profile defaults/)
  assert.match(source, /\/paste-to-path\/config/)
  assert.match(source, /\/paste-to-path\/from-path/)
  assert.match(source, /\/paste-to-path\/windows-clipboard/)
  assert.match(host, /ctx\.settings\.register\('paste-to-path', Config/)
  assert.doesNotMatch(source, /createDraftImages|\/paste-to-path\/model-capability/)
  assert.doesNotMatch(source, /nativeImageExtensions|partitionFiles|NATIVE_IMAGE|isNativeImage/)
  assert.doesNotMatch(source, /createConfigScope|\/paste-to-path\/settings/)
  assert.doesNotMatch(host, /nativeImageExtensions|\/paste-to-path\/settings/)
})

test('serves live effective configuration while official settings owns writes', async () => {
  const routes = harness({ longTextThreshold: 1200 })
  const initial = await call(routes.get('/paste-to-path/config'), request('GET'))
  assert.equal(initial.status, 200)
  assert.deepEqual(initial.body, {
    longTextAsAttachment: true,
    longTextThreshold: 1200,
    maxBytes: 25 * 1024 * 1024,
    editableTextMaxBytes: 1024 * 1024,
    pathTextAsAttachment: true,
    windowsClipboardFallback: true,
  })

  routes.updateSettings({ longTextAsAttachment: false, maxBytes: 4 })
  const updated = await call(routes.get('/paste-to-path/config'), request('GET'))
  assert.equal(updated.body.longTextAsAttachment, false)
  assert.equal(updated.body.maxBytes, 4)
  assert.equal(routes.has('/paste-to-path/settings'), false)
})

test('normalizes file URLs and rejects relative clipboard paths', () => {
  assert.equal(normalizePastedPath('"file:///tmp/report%20one.pdf"'), fileURLToPath('file:///tmp/report%20one.pdf'))
  assert.throws(() => normalizePastedPath('report.pdf'), /must be absolute/)
})

test('never exposes the Windows Host clipboard through a remote request', async () => {
  const routes = harness()
  const remote = request('POST', { 'x-session-id': 'session-test' })
  remote.socket = { remoteAddress: '100.64.0.2' }
  const result = await call(routes.get('/paste-to-path/windows-clipboard'), remote)
  assert.equal(result.status, 403)
  assert.equal(result.body.error, 'Windows clipboard access requires direct localhost')

  const proxied = request('POST', {
    host: 'johnnymacbook-pro.example.ts.net',
    origin: 'https://johnnymacbook-pro.example.ts.net',
    'x-session-id': 'session-test',
  })
  const proxiedResult = await call(routes.get('/paste-to-path/windows-clipboard'), proxied)
  assert.equal(proxiedResult.status, 403)
  assert.equal(proxiedResult.body.error, 'Windows clipboard access requires direct localhost')
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

test('links an existing Host file without copying it or granting edit access', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-paste-to-path-link-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'existing report.pdf')
  await writeFile(source, Buffer.from('pdf bytes'))
  const routes = harness()
  const linked = await call(
    routes.get('/paste-to-path/from-path'),
    request(
      'POST',
      { 'x-session-id': 'session-test', 'content-type': 'application/json' },
      [Buffer.from(JSON.stringify({ path: source }))],
    ),
  )
  assert.equal(linked.status, 200)
  assert.equal(linked.body.path, await realpath(source))
  assert.equal(linked.body.category, 'docs')
  assert.equal(linked.body.editable, false)
  assert.equal(linked.body.linked, true)

  const edit = await call(
    routes.get('/paste-to-path/content'),
    request('GET', {
      'x-session-id': 'session-test',
      'x-attachment-id': linked.body.id,
    }),
  )
  assert.equal(edit.status, 409)
})

test('accepts an empty file instead of leaking it into the native image intake', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-paste-to-path-empty-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const routes = harness()
  const uploaded = await call(
    routes.get('/paste-to-path'),
    request('POST', {
      'x-session-id': 'session-test',
      'x-workspace': encodeURIComponent(root),
      'x-file-name': 'empty.zip',
      'content-type': 'application/zip',
      'content-length': '0',
    }),
  )
  assert.equal(uploaded.status, 200)
  assert.equal(uploaded.body.bytes, 0)
  assert.equal(uploaded.body.category, 'archive')
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
