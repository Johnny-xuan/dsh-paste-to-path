import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function browserPasteHarness() {
  let definition
  let uploadCount = 0
  let insertedCount = 0
  const card = {}
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
  }
  let source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  source = source.replace(
    '    exports.apply = apply\n',
    "    exports.__test = { composerForTarget, onPaste, setContext: (value) => { _ctx = value } }\n    exports.apply = apply\n",
  )
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(definition, 'client module registered')
  const client = definition.factory(() => ({}))
  assert.ok(client.__test, 'test hook injected into client module')

  const snapshot = { phase: 'plain', draft: '', draftRev: 1, occurrences: [] }
  const input = { state: { getSnapshot: () => snapshot }, notify() {} }
  const actx = {
    bail() {
      insertedCount += 1
      return true
    },
  }
  client.__test.setContext({
    sessions: {
      list: { getSnapshot: () => ({ current: 'session-1', byId: { 'session-1': { cwd: '' } } }) },
      scope: () => actx,
    },
    conversation: { input: { for: () => input } },
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
  async function flush() {
    await new Promise((resolve) => setImmediate(resolve))
  }

  return {
    client,
    composer,
    referenceChip,
    pasteEvent,
    flush,
    counts: () => ({ uploadCount, insertedCount }),
  }
}

test('captures another pasted file when a reference chip is already the event target', async () => {
  const harness = await browserPasteHarness()

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
