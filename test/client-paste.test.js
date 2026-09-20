import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function browserPasteHarness({ legacyCurrent = false } = {}) {
  let definition
  let uploadCount = 0
  let insertedCount = 0
  let nativeDraftCount = 0
  let nativeAddedCount = 0
  const card = { querySelector: () => composer }
  const attributes = new Map([
    ['contenteditable', 'true'],
    ['data-composer-input', 'true'],
    ['data-phase', 'claimed'],
  ])
  const composer = {
    nodeType: 1,
    tagName: 'DIV',
    disabled: false,
    readOnly: false,
    isConnected: true,
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name),
    closest: (selector) => (selector === '[data-composer-card]' ? card : null),
    focus() {},
    getBoundingClientRect: () => ({ width: 700, height: 52 }),
  }
  const referenceChip = {
    nodeType: 1,
    tagName: 'SPAN',
    parentElement: composer,
    closest: (selector) =>
      selector.includes('data-composer-input') ? composer : selector === '[data-composer-card]' ? card : null,
  }
  const selection = { removeAllRanges() {}, addRange() {} }
  const document = {
    querySelector: () => null,
    querySelectorAll: () => [composer],
    createElement: () => ({ dataset: {}, textContent: '' }),
    createRange: () => ({ selectNodeContents() {}, collapse() {} }),
    head: { appendChild() {} },
  }
  const sandbox = {
    window: {
      __ModuleLoader__: { load(value) { definition = value } },
      getSelection: () => selection,
    },
    document,
    requestAnimationFrame: (callback) => callback(),
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    fetch: async () => {
      uploadCount += 1
      return {
        ok: true,
        json: async () => ({
          id: `attachment-${uploadCount}`,
          path: `/tmp/image-${uploadCount}.png`,
          name: 'image.png',
          category: 'images',
          bytes: 1,
          editable: false,
        }),
      }
    },
    console,
    setTimeout,
    clearTimeout,
    File: class File {
      constructor(parts, name, options = {}) {
        this.parts = parts
        this.name = name
        this.type = options.type || ''
        this.size = parts.reduce((total, part) => total + String(part).length, 0)
      }
    },
  }
  let source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  source = source.replace(
    '    exports.apply = apply\n',
    "    exports.__test = { acceptConfig, composerForTarget, onPaste, onNativeFileInput, setContext: (value) => { _ctx = value } }\n    exports.apply = apply\n",
  )
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(definition, 'client module registered')
  const client = definition.factory(() => ({}))
  assert.ok(client.__test, 'test hook injected into client module')

  const snapshot = { phase: 'plain', draft: '', draftRev: 1, occurrences: [] }
  const input = {
    state: { getSnapshot: () => snapshot },
    notify() {},
    addAttachments(ids) {
      nativeAddedCount += ids.length
      return true
    },
  }
  const actx = {
    bail() {
      insertedCount += 1
      return true
    },
  }
  client.__test.setContext({
    sessions: {
      list: {
        getSnapshot: () => ({
          ...(legacyCurrent ? { current: 'session-1' } : {}),
          byId: { 'session-1': { id: 'session-1', cwd: '', retainedBy: { mainView: 1 } } },
        }),
      },
      scope: () => actx,
    },
    conversation: {
      input: { for: () => input },
      createDrafts: (_sessionId, files) =>
        files.map(() => ({ id: `native-${++nativeDraftCount}` })),
      releaseDraftAttachments() {},
    },
  })

  const file = {
    name: 'image.png',
    type: 'image/png',
    size: 1,
    arrayBuffer: async () => new ArrayBuffer(1),
  }
  function pasteEvent(target) {
    return {
      target,
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => file }],
        files: [file],
        types: ['Files'],
        getData: () => '',
      },
      prevented: false,
      stopped: false,
      preventDefault() { this.prevented = true },
      stopImmediatePropagation() { this.stopped = true },
    }
  }
  function textPasteEvent(target, text) {
    return {
      target,
      clipboardData: {
        items: [],
        files: [],
        types: ['text/plain'],
        getData: (type) => (type === 'text/plain' ? text : ''),
      },
      prevented: false,
      stopped: false,
      preventDefault() { this.prevented = true },
      stopImmediatePropagation() { this.stopped = true },
    }
  }
  function nativeFileChangeEvent() {
    const target = {
      nodeType: 1,
      tagName: 'INPUT',
      type: 'file',
      files: [file],
      value: '/fake/image.png',
      classList: { contains: () => false },
      closest: (selector) => (selector === '[data-composer-card]' ? card : null),
    }
    return {
      target,
      prevented: false,
      stopped: false,
      preventDefault() { this.prevented = true },
      stopImmediatePropagation() { this.stopped = true },
    }
  }
  async function flush() {
    await new Promise((resolve) => setImmediate(resolve))
  }

  return {
    client,
    composer,
    referenceChip,
    pasteEvent,
    textPasteEvent,
    nativeFileChangeEvent,
    flush,
    counts: () => ({ uploadCount, insertedCount }),
    nativeCounts: () => ({ nativeDraftCount, nativeAddedCount }),
  }
}

test('captures another pasted file when a reference chip is already the event target', async () => {
  const harness = await browserPasteHarness()
  harness.client.__test.acceptConfig({ takeOverNativeAttachments: true })

  const first = harness.pasteEvent(harness.composer)
  harness.client.__test.onPaste(first)
  await harness.flush()

  const second = harness.pasteEvent(harness.referenceChip)
  harness.client.__test.onPaste(second)
  await harness.flush()

  assert.deepEqual(
    { prevented: first.prevented, stopped: first.stopped },
    { prevented: true, stopped: true },
  )
  assert.deepEqual(
    { prevented: second.prevented, stopped: second.stopped },
    { prevented: true, stopped: true },
  )
  assert.deepEqual(harness.counts(), { uploadCount: 2, insertedCount: 2 })
})

test('keeps the legacy current-session projection compatible', async () => {
  const harness = await browserPasteHarness({ legacyCurrent: true })
  harness.client.__test.acceptConfig({ takeOverNativeAttachments: true })
  const event = harness.pasteEvent(harness.composer)
  harness.client.__test.onPaste(event)
  await harness.flush()

  assert.deepEqual(harness.counts(), { uploadCount: 1, insertedCount: 1 })
})

test('reroutes the native composer file input while takeover is enabled', async () => {
  const harness = await browserPasteHarness()
  harness.client.__test.acceptConfig({ takeOverNativeAttachments: true })
  const event = harness.nativeFileChangeEvent()
  harness.client.__test.onNativeFileInput(event)
  await harness.flush()

  assert.deepEqual(
    { prevented: event.prevented, stopped: event.stopped, inputValue: event.target.value },
    { prevented: true, stopped: true, inputValue: '' },
  )
  assert.deepEqual(harness.counts(), { uploadCount: 1, insertedCount: 1 })
})

test('leaves the native composer file input untouched when takeover is disabled', async () => {
  const harness = await browserPasteHarness()
  const event = harness.nativeFileChangeEvent()
  harness.client.__test.onNativeFileInput(event)
  await harness.flush()

  assert.deepEqual(
    { prevented: event.prevented, stopped: event.stopped, inputValue: event.target.value },
    { prevented: false, stopped: false, inputValue: '/fake/image.png' },
  )
  assert.deepEqual(harness.counts(), { uploadCount: 0, insertedCount: 0 })
})

test('leaves browser-provided files entirely to DSH Native by default', async () => {
  const harness = await browserPasteHarness()
  const event = harness.pasteEvent(harness.composer)
  harness.client.__test.onPaste(event)
  await harness.flush()

  assert.equal(event.prevented, false)
  assert.equal(event.stopped, false)
  assert.deepEqual(harness.counts(), { uploadCount: 0, insertedCount: 0 })
  assert.deepEqual(harness.nativeCounts(), { nativeDraftCount: 0, nativeAddedCount: 0 })
})

test('turns long plain text into one native DSH attachment without invoking P2P upload', async () => {
  const harness = await browserPasteHarness()
  harness.client.__test.acceptConfig({ longTextAsAttachment: true, longTextThreshold: 8 })
  const event = harness.textPasteEvent(harness.composer, '12345678')
  harness.client.__test.onPaste(event)

  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.deepEqual(harness.counts(), { uploadCount: 0, insertedCount: 0 })
  assert.deepEqual(harness.nativeCounts(), { nativeDraftCount: 1, nativeAddedCount: 1 })
})

test('resolves text inside a reference chip to its owning composer without capturing outside paste', async () => {
  const harness = await browserPasteHarness()
  const textNode = { nodeType: 3, parentElement: harness.referenceChip }
  assert.equal(harness.client.__test.composerForTarget(textNode), harness.composer)

  const outside = { nodeType: 1, tagName: 'DIV', closest: () => null }
  const event = harness.pasteEvent(outside)
  harness.client.__test.onPaste(event)
  await harness.flush()
  assert.equal(event.prevented, false)
  assert.equal(event.stopped, false)
  assert.deepEqual(harness.counts(), { uploadCount: 0, insertedCount: 0 })
})
