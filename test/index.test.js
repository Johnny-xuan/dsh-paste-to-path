import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { apply, categoryOf, resolveConfig, safeFileName } from '../index.js'

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
  req.headers = headers
  return req
}

function harness(config) {
  const routes = new Map()
  const ctx = {
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    effect() {},
  }
  apply(ctx, config)
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

test('normalizes invalid numeric config and keeps explicit text opt-out', () => {
  const config = resolveConfig({
    longTextAsAttachment: false,
    longTextThreshold: -1,
    maxBytes: 0,
    editableTextMaxBytes: 12,
  })
  assert.equal(config.longTextAsAttachment, false)
  assert.equal(config.longTextThreshold, 8000)
  assert.equal(config.maxBytes, 25 * 1024 * 1024)
  assert.equal(config.editableTextMaxBytes, 12)
})

test('public package metadata describes the first release and excludes development files', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.version, '0.0.1')
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.publishConfig?.access, 'public')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-attachment'))
  assert.ok(pkg.files.includes('README.md'))
  assert.ok(pkg.files.includes('README.zh.md'))
  assert.ok(!pkg.files.some((entry) => entry.startsWith('test')))
})

test('browser attachment guidance is concise English and avoids the native image rail', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const guidance = source.slice(source.indexOf('function modelText'), source.indexOf('function referenceFor'))
  assert.match(source, /Inspect it using an available image-reading method\./)
  assert.match(guidance, /Text attachment:/)
  assert.match(guidance, /Code attachment:/)
  assert.match(guidance, /Document attachment:/)
  assert.match(guidance, /Archive attachment:/)
  assert.match(guidance, /File attachment:/)
  assert.doesNotMatch(guidance, /[\u3400-\u9fff]/)
  assert.doesNotMatch(source, /[\u3400-\u9fff]/)
  assert.doesNotMatch(source, /createDraftImages|\/paste-to-path\/model-capability/)
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
  assert.equal((await stat(upload.body.path)).mode & 0o777, 0o600)
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

test('rejects cross-session edit and oversized upload', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-paste-to-path-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const routes = harness({ maxBytes: 4 })
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
