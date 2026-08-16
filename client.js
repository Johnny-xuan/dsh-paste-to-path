// dsh-paste-to-path — browser half.
//
// Binary/long-text paste becomes a path-backed reference chip plus a managed
// card above the composer. DSH's reference codec expands each chip to plain
// path text inside the ordinary submit transaction.

window.__ModuleLoader__.load({
  id: 'dsh-paste-to-path',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var jsx = require('react/jsx-runtime')
    var attachmentUi = require('@deepseek-ai/dsh-client-ui-attachment')
    var _ctx = null
    var queues = new Map()
    var byId = new Map()
    var bySession = new Map()
    var listeners = new Map()
    var previewUrls = new Set()
    var EMPTY_ITEMS = Object.freeze([])
    var config = null
    var configScope = null
    var configUnavailableLogged = false
    var NATIVE_IMAGE_EXTENSION_BY_MEDIA_TYPE = Object.freeze({
      'image/png': 'png',
      'image/jpeg': 'jpeg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    })
    var SETTINGS_FIELDS = Object.freeze([
      'longTextAsAttachment',
      'longTextThreshold',
      'nativeImageExtensions',
      'maxBytes',
      'editableTextMaxBytes',
    ])
    var SETTINGS_BRIDGE = '/paste-to-path/settings'

    function createSettingsSnapshot(initial) {
      var value = initial
      var listeners = new Set()
      return {
        get: () => value,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        set(next) {
          value = next
          for (var listener of listeners) listener()
        },
      }
    }

    function createBridgeScope(namespace) {
      var snapshot = createSettingsSnapshot({
        status: 'loading',
        value: undefined,
        base: undefined,
        user: undefined,
        revision: undefined,
        writable: false,
      })
      var tail = Promise.resolve()
      var disposed = false

      function enqueue(operation) {
        if (disposed) return Promise.resolve()
        var task = tail.then(() => disposed ? undefined : operation())
        tail = task.catch(() => undefined)
        return task
      }

      async function post(path, body) {
        var response = await fetch(`${SETTINGS_BRIDGE}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!response.ok) throw new Error(`settings bridge HTTP ${response.status}`)
        var result = await response.json()
        if (!result || typeof result.ok !== 'boolean') throw new Error('malformed settings bridge response')
        return result
      }

      function accept(view, writable) {
        var current = snapshot.get()
        snapshot.set({
          ...current,
          status: 'ready',
          value: view.value,
          base: view.base,
          user: view.user,
          revision: view.revision,
          writable: writable === undefined ? current.writable : writable,
        })
      }

      async function read() {
        try {
          var result = await post('/describe', {})
          var view = result.ok
            ? result.value?.namespaces?.find((entry) => entry.ns === namespace)
            : undefined
          if (view === undefined) {
            snapshot.set({ ...snapshot.get(), status: 'unavailable', writable: result.ok ? result.value.writable : false })
            return
          }
          accept(view, result.value.writable)
        } catch {
          snapshot.set({ ...snapshot.get(), status: 'unavailable' })
        }
      }

      async function write(op) {
        var current = snapshot.get()
        var result
        try {
          result = await post('/mutate', {
            ns: namespace,
            ops: [op],
            ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
          })
        } catch (error) {
          await read()
          throw error
        }
        if (!result.ok) {
          await read()
          throw new Error(result.message || 'settings update rejected')
        }
        accept(result.value, undefined)
      }

      var scope = {
        getSnapshot: () => snapshot.get(),
        subscribe: (listener) => snapshot.subscribe(listener),
        load: () => enqueue(read),
        set: (field, value) => enqueue(() => write({ op: 'set', path: [field], value })),
        unset: (field) => enqueue(() => write({ op: 'unset', path: [field] })),
        dispose() {
          disposed = true
        },
      }
      scope.load()
      return scope
    }

    var css = `
      .dsh-p2p-dock{box-sizing:border-box;width:calc(100% - 64px);max-width:748px;margin:0 auto;display:flex;flex-direction:column;gap:6px}
      .dsh-p2p-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-tip);border-radius:12px;padding:8px 10px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px}
      .dsh-p2p-main{display:flex;align-items:center;gap:9px;min-width:0}
      .dsh-p2p-icon{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;flex:none;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary);font-size:15px}
      .dsh-p2p-thumbnail{width:42px;height:42px;border:0;border-radius:9px;padding:0;overflow:hidden;cursor:zoom-in;flex:none;background:var(--dsw-alias-interactive-bg-hover)}
      .dsh-p2p-thumbnail img{width:100%;height:100%;object-fit:cover;display:block}
      .dsh-p2p-meta{min-width:0;flex:1}
      .dsh-p2p-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
      .dsh-p2p-sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary);font-size:12px}
      .dsh-p2p-actions{display:flex;align-items:center;gap:4px;flex:none}
      .dsh-p2p-button{height:26px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0 8px;font:inherit}
      .dsh-p2p-button:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
      .dsh-p2p-button:disabled{opacity:.45;cursor:default}
      .dsh-p2p-remove{font-size:18px;padding:0;width:26px}
      .dsh-p2p-editor{display:flex;flex-direction:column;gap:7px;margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
      .dsh-p2p-editor textarea{box-sizing:border-box;width:100%;min-height:150px;max-height:320px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);padding:8px 10px;font:12px/18px var(--ds-font-family-code);outline:none}
      .dsh-p2p-editor textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
      .dsh-p2p-editor-row{display:flex;justify-content:flex-end;gap:6px}
      .dsh-p2p-error{color:var(--dsw-alias-state-error-primary);font-size:12px}
      .dsh-p2p-settings-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}
      .dsh-p2p-settings-card:hover{border-color:var(--dsw-alias-label-dimmed)}
      .dsh-p2p-settings-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
      .dsh-p2p-settings-header{appearance:none;width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}
      .dsh-p2p-settings-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
      .dsh-p2p-settings-head-text{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0}
      .dsh-p2p-settings-title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
      .dsh-p2p-settings-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
      .dsh-p2p-settings-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
      .dsh-p2p-settings-chevron-open{transform:rotate(180deg)}
      .dsh-p2p-settings-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:12px 0 8px}
      .dsh-p2p-settings-fields{display:grid;gap:12px}
      .dsh-p2p-settings-field{display:grid;gap:4px;font-size:13px}
      .dsh-p2p-settings-field input[type=number],.dsh-p2p-settings-field input[type=text]{box-sizing:border-box;width:100%;max-width:420px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);padding:5px 8px;font:inherit}
      .dsh-p2p-settings-field input:disabled{opacity:.55;cursor:not-allowed}
      .dsh-p2p-settings-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
      .dsh-p2p-settings-check{display:flex;align-items:center;gap:7px;cursor:pointer}
      .dsh-p2p-settings-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}
      .dsh-p2p-settings-actions button{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
      .dsh-p2p-settings-discard{border-color:var(--dsw-alias-border-l2)!important;background:transparent;color:var(--dsw-alias-label-secondary)}
      .dsh-p2p-settings-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
      .dsh-p2p-settings-actions button:disabled{opacity:.4;cursor:default}
      .dsh-p2p-settings-status{color:var(--dsw-alias-label-tertiary);font-size:12px}
      .dsh-p2p-settings-pending{flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
    `

    function sessionItems(sessionId) {
      return bySession.get(sessionId) || EMPTY_ITEMS
    }

    function publish(sessionId, items) {
      bySession.set(sessionId, items)
      var group = listeners.get(sessionId)
      if (group) for (var listener of group) listener()
    }

    function addItem(item) {
      byId.set(item.id, item)
      publish(item.sessionId, [...sessionItems(item.sessionId), item])
    }

    function subscribe(sessionId, listener) {
      var group = listeners.get(sessionId)
      if (!group) listeners.set(sessionId, (group = new Set()))
      group.add(listener)
      return () => {
        group.delete(listener)
        if (group.size === 0) listeners.delete(sessionId)
      }
    }

    function filesOfPaste(event) {
      var data = event.clipboardData
      if (!data) return []
      var files = []
      var items = data.items || []
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind !== 'file') continue
        var file = items[i].getAsFile()
        if (file && file.size > 0) files.push(file)
      }
      if (files.length === 0 && data.files) {
        files = Array.from(data.files).filter((file) => file && file.size > 0)
      }
      return files
    }

    function filesOfDrop(event) {
      var files = event.dataTransfer?.files
      return files ? Array.from(files).filter((file) => file && file.size > 0) : []
    }

    function nativeImageExtensions(file) {
      var mediaType = String(file?.type || '').split(';', 1)[0].trim().toLowerCase()
      var fileName = String(file?.name || '').toLowerCase()
      var extension = fileName.match(/\.([a-z0-9][a-z0-9._-]*)$/)?.[1]
      var byMediaType = NATIVE_IMAGE_EXTENSION_BY_MEDIA_TYPE[mediaType]
      return [...new Set([extension, byMediaType].filter(Boolean))]
    }

    function isNativeImage(file) {
      var extensions = nativeImageExtensions(file)
      var allowed = config?.nativeImageExtensions
      return Array.isArray(allowed) && extensions.some((extension) => allowed.includes(extension))
    }

    function partitionFiles(files) {
      var native = []
      var pathBacked = []
      for (var i = 0; i < files.length; i++) {
        if (isNativeImage(files[i])) native.push(files[i])
        else pathBacked.push(files[i])
      }
      return { native, pathBacked }
    }

    function dataTransferHasNativeImage(dataTransfer) {
      var files = dataTransfer?.files
      if (files?.length > 0) return Array.from(files).some(isNativeImage)
      var items = dataTransfer?.items || []
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind !== 'file') continue
        if (isNativeImage({ type: items[i].type })) return true
      }
      return false
    }

    function carriesFiles(event) {
      return Array.from(event.dataTransfer?.types || []).includes('Files')
    }

    function isComposer(el) {
      return Boolean(
        el &&
          el.nodeType === 1 &&
          el.tagName === 'TEXTAREA' &&
          el.hasAttribute('data-phase') &&
          el.closest('[data-composer-card]') &&
          !el.disabled &&
          !el.readOnly,
      )
    }

    function currentComposer() {
      var candidates = document.querySelectorAll('[data-composer-card] textarea[data-phase]')
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i]
        if (!isComposer(el)) continue
        var rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) return el
      }
      return null
    }

    function activeSession(ctx) {
      try {
        var snapshot = ctx.sessions.list.getSnapshot()
        var sessionId = snapshot.current
        var actx = sessionId ? ctx.sessions.scope(sessionId) : null
        if (!sessionId || !actx) return null
        var input = ctx.conversation.input.for(actx)
        if (!input?.state?.getSnapshot) return null
        return {
          sessionId,
          actx,
          input,
          workspace: typeof snapshot.byId?.[sessionId]?.cwd === 'string' ? snapshot.byId[sessionId].cwd : '',
        }
      } catch (error) {
        console.error('[dsh-paste-to-path] cannot resolve active session', error)
        return null
      }
    }

    function inputForSession(sessionId) {
      try {
        var actx = _ctx?.sessions?.scope?.(sessionId)
        return actx ? _ctx.conversation.input.for(actx) : null
      } catch {
        return null
      }
    }

    function notify(sessionId, level, message) {
      inputForSession(sessionId)?.notify(level, message)
    }

    function fallbackName(file) {
      if (file.name) return file.name
      var byType = {
        'image/png': 'pasted-image.png',
        'image/jpeg': 'pasted-image.jpg',
        'image/gif': 'pasted-image.gif',
        'image/webp': 'pasted-image.webp',
        'image/heic': 'pasted-image.heic',
        'image/heif': 'pasted-image.heif',
        'image/svg+xml': 'pasted-image.svg',
        'application/pdf': 'pasted-document.pdf',
        'text/plain': 'pasted-text.txt',
      }
      return byType[file.type] || 'pasted-file.bin'
    }

    function uploadFile(file, active) {
      var fileName = fallbackName(file)
      var headers = {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(fileName),
        'X-Session-Id': encodeURIComponent(active.sessionId),
      }
      if (active.workspace) headers['X-Workspace'] = encodeURIComponent(active.workspace)
      return file.arrayBuffer().then((buffer) =>
        fetch('/paste-to-path', { method: 'POST', headers, body: buffer }).then((res) =>
          res
            .json()
            .catch(() => ({}))
            .then((body) => {
              if (!res.ok) throw new Error(body.error || `paste upload failed (${res.status})`)
              if (typeof body.id !== 'string' || typeof body.path !== 'string') {
                throw new Error('paste upload returned an invalid attachment')
              }
              if (body.category === 'images' && file.type.startsWith('image/')) {
                body.previewUrl = URL.createObjectURL(file)
                previewUrls.add(body.previewUrl)
              }
              return body
            }),
        ),
      )
    }

    function modelText(item) {
      if (!item) throw new Error('paste-to-path attachment is no longer available')
      if (item.category === 'images') {
        return `Image attachment: ${item.path}\nInspect it using an available image-reading method.`
      }
      if (item.category === 'text') {
        return `Text attachment: ${item.path}\nRead it as needed; its contents are not included in this message.`
      }
      if (item.category === 'code') {
        return `Code attachment: ${item.path}\nRead it as needed; its contents are not included in this message.`
      }
      if (item.category === 'docs') {
        return `Document attachment: ${item.path}\nRead it using an appropriate tool for this file format.`
      }
      if (item.category === 'archive') {
        return `Archive attachment: ${item.path}\nInspect or extract it using an appropriate tool for this file format.`
      }
      return `File attachment: ${item.path}\nInspect it using an appropriate tool for this file format.`
    }

    function referenceFor(item) {
      return {
        source: 'paste-to-path',
        ref: item.id,
        label: `📎 ${item.name}`,
        clipboardText: modelText(item),
      }
    }

    function isWritable(snapshot) {
      return snapshot.phase === 'plain' || snapshot.phase === 'claimed'
    }

    function whenWritable(input, action) {
      if (isWritable(input.state.getSnapshot())) {
        return Promise.resolve().then(action)
      }
      return new Promise((resolve, reject) => {
        var dispose = input.state.subscribe(() => {
          if (!isWritable(input.state.getSnapshot())) return
          dispose()
          try {
            action()
            resolve()
          } catch (error) {
            reject(error)
          }
        })
      })
    }

    function insertUploaded(active, target, base, settled) {
      var successful = []
      var failures = []
      for (var result of settled) {
        if (result.status === 'fulfilled') successful.push(result.value)
        else failures.push(result.reason)
      }
      if (failures.length > 0) {
        var kept = successful.length > 0 ? `; ${successful.length} other attachment(s) were kept` : ''
        active.input.notify(
          'error',
          `${failures.length} pasted attachment(s) could not be saved${kept}: ${failures[0]?.message || failures[0]}`,
        )
      }
      if (successful.length === 0) return Promise.resolve()
      return whenWritable(active.input, () => {
        for (var index = 0; index < successful.length; index++) {
          var item = successful[index]
          addItem(item)
          var snapshot = active.input.state.getSnapshot()
          var unchanged = index === 0 && snapshot.draftRev === base.rev && snapshot.draft === base.draft
          var span = unchanged
            ? { start: base.start, end: base.end, draftRev: snapshot.draftRev }
            : { start: snapshot.draft.length, end: snapshot.draft.length, draftRev: snapshot.draftRev }
          var applied = active.actx.bail(active.actx, 'slash/input-insert-reference', {
            reference: referenceFor(item),
            span,
          })
          if (applied !== true) {
            active.input.notify('error', `Attachment was saved but could not be added to the current draft: ${item.path}`)
          }
        }
        requestAnimationFrame(() => {
          var current = activeSession(_ctx)
          if (!current || current.sessionId !== active.sessionId || !target.isConnected || !isComposer(target)) return
          var end = target.value.length
          target.focus({ preventScroll: true })
          target.setSelectionRange(end, end)
        })
      })
    }

    function schedule(sessionId, task) {
      var previous = queues.get(sessionId) || Promise.resolve()
      var next = previous
        .catch(() => {})
        .then(task)
        .catch((error) => {
          notify(sessionId, 'error', `Attachment processing failed: ${error?.message || error}`)
          console.error('[dsh-paste-to-path] attachment task failed', error)
        })
      queues.set(sessionId, next)
      next.then(() => {
        if (queues.get(sessionId) === next) queues.delete(sessionId)
      })
    }

    async function routeFiles(active, target, base, files) {
      var settled = await Promise.allSettled(files.map((file) => uploadFile(file, active)))
      await insertUploaded(active, target, base, settled)
    }

    function processFiles(event, target, files, intercept) {
      var active = _ctx && activeSession(_ctx)
      if (!active) return false
      var snapshot = active.input.state.getSnapshot()
      var base = {
        draft: snapshot.draft,
        rev: snapshot.draftRev,
        start: target.selectionStart ?? snapshot.draft.length,
        end: target.selectionEnd ?? target.selectionStart ?? snapshot.draft.length,
      }
      if (intercept) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      schedule(active.sessionId, () => routeFiles(active, target, base, files))
      return true
    }

    function longTextFile(text) {
      var stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
      return new File([text], `pasted-text-${stamp}.txt`, { type: 'text/plain;charset=utf-8' })
    }

    function onPaste(event) {
      if (!isComposer(event.target)) return
      if (config === null) return
      var files = filesOfPaste(event)
      if (files.length > 0) {
        var partition = partitionFiles(files)
        if (partition.pathBacked.length === 0) return
        processFiles(event, event.target, partition.pathBacked, partition.native.length === 0)
        return
      }
      if (!config.longTextAsAttachment) return
      var text = event.clipboardData?.getData('text/plain') || ''
      if (text.length >= config.longTextThreshold) processFiles(event, event.target, [longTextFile(text)], true)
    }

    function onDragEnter(event) {
      if (config === null || !carriesFiles(event) || !currentComposer()) return
      if (dataTransferHasNativeImage(event.dataTransfer)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    function onDragOver(event) {
      if (config === null || !carriesFiles(event) || !currentComposer()) return
      if (dataTransferHasNativeImage(event.dataTransfer)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    function onDrop(event) {
      if (!carriesFiles(event)) return
      var target = isComposer(event.target) ? event.target : currentComposer()
      if (!target) return
      if (config === null) return
      var files = filesOfDrop(event)
      if (files.length === 0) return
      var partition = partitionFiles(files)
      if (partition.pathBacked.length === 0) return
      processFiles(event, target, partition.pathBacked, partition.native.length === 0)
    }

    function removeReference(sessionId, ref, input, inputActions) {
      var ranges = input.occurrences
        .filter((occurrence) => occurrence.source === 'paste-to-path' && occurrence.ref === ref)
        .map((occurrence) => ({ start: occurrence.offset, end: occurrence.offset + 1 }))
        .sort((a, b) => b.start - a.start)
      if (ranges.length === 0) return
      var draft = input.draft
      for (var range of ranges) {
        if (draft[range.end] === ' ') range.end += 1
        draft = draft.slice(0, range.start) + draft.slice(range.end)
      }
      inputActions.setDraft(draft)
    }

    function categoryIcon(category) {
      if (category === 'images') return '▧'
      if (category === 'text' || category === 'code') return '≡'
      if (category === 'archive') return '⌑'
      return '◇'
    }

    function categoryLabel(category) {
      if (category === 'images') return '图片'
      if (category === 'docs') return '文档'
      if (category === 'text') return '文本'
      if (category === 'code') return '代码'
      if (category === 'archive') return '压缩包'
      return '文件'
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    function contentRequest(item, method, body) {
      return fetch('/paste-to-path/content', {
        method,
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
          'X-Attachment-Id': encodeURIComponent(item.id),
          'X-Session-Id': encodeURIComponent(item.sessionId),
        },
        ...(body === undefined ? {} : { body }),
      }).then((res) =>
        res
          .json()
          .catch(() => ({}))
          .then((payload) => {
            if (!res.ok) throw new Error(payload.error || `attachment request failed (${res.status})`)
            return payload
          }),
      )
    }

    function AttachmentCard({ item, input, inputActions, canOpenPath }) {
      var [editing, setEditing] = React.useState(false)
      var [loading, setLoading] = React.useState(false)
      var [saving, setSaving] = React.useState(false)
      var [opening, setOpening] = React.useState(false)
      var [previewing, setPreviewing] = React.useState(false)
      var [previewFailed, setPreviewFailed] = React.useState(false)
      var [content, setContent] = React.useState('')
      var [error, setError] = React.useState('')

      function openEditor() {
        setEditing(true)
        setLoading(true)
        setError('')
        contentRequest(item, 'GET').then(
          (payload) => {
            setContent(payload.content || '')
            setLoading(false)
          },
          (reason) => {
            setError(reason.message || String(reason))
            setLoading(false)
          },
        )
      }

      function save() {
        setSaving(true)
        setError('')
        contentRequest(item, 'PATCH', content).then(
          (payload) => {
            item.bytes = payload.bytes
            setSaving(false)
            setEditing(false)
            publish(item.sessionId, [...sessionItems(item.sessionId)])
            notify(item.sessionId, 'info', `Attachment saved: ${item.name}`)
          },
          (reason) => {
            setError(reason.message || String(reason))
            setSaving(false)
          },
        )
      }

      function openPath() {
        setOpening(true)
        setError('')
        _ctx.workspaces.openPath(item.path).then(
          () => setOpening(false),
          (reason) => {
            setError(reason.message || String(reason))
            setOpening(false)
          },
        )
      }

      var hasPreview = item.category === 'images' && item.previewUrl && !previewFailed

      return jsx.jsxs('div', {
        className: 'dsh-p2p-card',
        children: [
          jsx.jsxs('div', {
            className: 'dsh-p2p-main',
            children: [
              hasPreview
                ? jsx.jsx('button', {
                    type: 'button',
                    className: 'dsh-p2p-thumbnail',
                    title: `Preview ${item.name}`,
                    'aria-label': `Preview ${item.name}`,
                    onClick: () => setPreviewing(true),
                    children: jsx.jsx('img', {
                      src: item.previewUrl,
                      alt: item.name,
                      onError: () => setPreviewFailed(true),
                    }),
                  })
                : jsx.jsx('div', { className: 'dsh-p2p-icon', 'aria-hidden': true, children: categoryIcon(item.category) }),
              jsx.jsxs('div', {
                className: 'dsh-p2p-meta',
                children: [
                  jsx.jsx('div', { className: 'dsh-p2p-name', title: item.path, children: item.name }),
                  jsx.jsx('div', { className: 'dsh-p2p-sub', children: `${formatBytes(item.bytes)} · ${categoryLabel(item.category)} · ${item.path}` }),
                ],
              }),
              jsx.jsxs('div', {
                className: 'dsh-p2p-actions',
                children: [
                  item.editable &&
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dsh-p2p-button',
                      disabled: loading || saving,
                      onClick: editing ? () => setEditing(false) : openEditor,
                      children: editing ? '收起' : '编辑',
                    }),
                  canOpenPath &&
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dsh-p2p-button',
                      disabled: opening,
                      title: '使用 DSH 主机上的默认应用打开',
                      onClick: openPath,
                      children: opening ? '打开中…' : '打开',
                    }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dsh-p2p-button dsh-p2p-remove',
                    title: '从此消息移除（保留本地文件）',
                    'aria-label': `移除附件 ${item.name}`,
                    onClick: () => removeReference(item.sessionId, item.id, input, inputActions),
                    children: '×',
                  }),
                ],
              }),
            ],
          }),
          editing &&
            jsx.jsxs('div', {
              className: 'dsh-p2p-editor',
              'data-paste-to-path-editor': true,
              children: [
                loading
                  ? jsx.jsx('div', { children: '正在加载文本附件…' })
                  : jsx.jsx('textarea', {
                      value: content,
                      disabled: saving,
                      onChange: (event) => setContent(event.target.value),
                      'aria-label': `编辑 ${item.name}`,
                    }),
                error && jsx.jsx('div', { className: 'dsh-p2p-error', children: error }),
                jsx.jsxs('div', {
                  className: 'dsh-p2p-editor-row',
                  children: [
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dsh-p2p-button',
                      disabled: saving,
                      onClick: () => setEditing(false),
                      children: '取消',
                    }),
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dsh-p2p-button',
                      disabled: loading || saving,
                      onClick: save,
                      children: saving ? '保存中…' : '保存',
                    }),
                  ],
                }),
              ],
            }),
          error && !editing && jsx.jsx('div', { className: 'dsh-p2p-error', children: error }),
          previewing && hasPreview &&
            jsx.jsx(attachmentUi.ImageLightbox, {
              src: item.previewUrl,
              alt: item.name,
              labels: { dialog: `Preview ${item.name}`, close: 'Close image preview' },
              onClose: () => setPreviewing(false),
            }),
        ],
      })
    }

    function AttachmentDock({ sessionId, input, inputActions }) {
      var connection = _ctx.connection
      var hostDescription = React.useSyncExternalStore(
        React.useCallback((listener) => connection.hostDescription.subscribe(listener), [connection]),
        React.useCallback(() => connection.hostDescription.getSnapshot(), [connection]),
        () => undefined,
      )
      var canOpenPath = connection.isLoopback && hostDescription?.canOpenPath === true
      var items = React.useSyncExternalStore(
        React.useCallback((listener) => subscribe(sessionId, listener), [sessionId]),
        React.useCallback(() => sessionItems(sessionId), [sessionId]),
        () => EMPTY_ITEMS,
      )
      var activeRefs = new Set(
        input.occurrences
          .filter((occurrence) => occurrence.source === 'paste-to-path')
          .map((occurrence) => occurrence.ref),
      )
      var visible = items.filter((item) => activeRefs.has(item.id))
      if (visible.length === 0) return null
      return jsx.jsx('div', {
        className: 'dsh-p2p-dock',
        children: visible.map((item) =>
          jsx.jsx(AttachmentCard, { item, input, inputActions, canOpenPath }, item.id),
        ),
      })
    }

    function PasteToPathSettingsCard({ scope }) {
      var snapshot = React.useSyncExternalStore(
        React.useCallback((listener) => scope.subscribe(listener), [scope]),
        React.useCallback(() => scope.getSnapshot(), [scope]),
        React.useCallback(() => scope.getSnapshot(), [scope]),
      )
      var settings = snapshot.value
      var ready = snapshot.status === 'ready' && settings !== undefined
      var writable = ready && snapshot.writable
      var [open, setOpen] = React.useState(false)
      var [threshold, setThreshold] = React.useState('')
      var [extensions, setExtensions] = React.useState('')
      var [maxBytes, setMaxBytes] = React.useState('')
      var [editableTextMaxBytes, setEditableTextMaxBytes] = React.useState('')
      var [error, setError] = React.useState('')

      React.useEffect(() => {
        if (Number.isSafeInteger(settings?.longTextThreshold)) setThreshold(String(settings.longTextThreshold))
      }, [settings?.longTextThreshold])
      React.useEffect(() => {
        if (Array.isArray(settings?.nativeImageExtensions)) setExtensions(settings.nativeImageExtensions.join(', '))
      }, [settings?.nativeImageExtensions])
      React.useEffect(() => {
        if (Number.isSafeInteger(settings?.maxBytes)) setMaxBytes(String(settings.maxBytes))
      }, [settings?.maxBytes])
      React.useEffect(() => {
        if (Number.isSafeInteger(settings?.editableTextMaxBytes)) setEditableTextMaxBytes(String(settings.editableTextMaxBytes))
      }, [settings?.editableTextMaxBytes])

      function write(field, value) {
        setError('')
        Promise.resolve(scope.set(field, value)).catch((reason) => {
          console.error('[dsh-paste-to-path] 保存设置失败', reason)
          setError('设置保存失败，请检查输入。')
        })
      }

      function writeNumber(field, text) {
        var value = Number(text)
        if (!Number.isSafeInteger(value) || value < 1) {
          setError('请输入正整数。')
          return
        }
        if (settings?.[field] === value) return
        write(field, value)
      }

      function writeExtensions(text) {
        var next = [...new Set(text.split(/[，,\s]+/).map((entry) => entry.trim().toLowerCase().replace(/^\.+/, '')).filter(Boolean))]
        write('nativeImageExtensions', next)
      }

      function reset() {
        setError('')
        Promise.all(SETTINGS_FIELDS.map((field) => scope.unset(field))).catch((reason) => {
          console.error('[dsh-paste-to-path] 恢复默认设置失败', reason)
          setError('恢复默认设置失败，请重试。')
        })
      }

      if (!ready) return null

      return jsx.jsxs('li', {
        className: open ? 'dsh-p2p-settings-card dsh-p2p-settings-card-open' : 'dsh-p2p-settings-card',
        children: [
          jsx.jsxs('button', {
            type: 'button',
            className: 'dsh-p2p-settings-header',
            'aria-expanded': open,
            onClick: () => setOpen((value) => !value),
            children: [
              jsx.jsxs('span', {
                className: 'dsh-p2p-settings-head-text',
                children: [
                  jsx.jsx('span', { className: 'dsh-p2p-settings-title', children: '粘贴到路径' }),
                  jsx.jsx('span', {
                    className: 'dsh-p2p-settings-description',
                    children: '配置长文本附件，以及交给 DSH 原生处理的图片后缀。',
                  }),
                ],
              }),
              jsx.jsx('svg', {
                className: open ? 'dsh-p2p-settings-chevron dsh-p2p-settings-chevron-open' : 'dsh-p2p-settings-chevron',
                width: 16,
                height: 16,
                viewBox: '0 0 16 16',
                fill: 'none',
                'aria-hidden': 'true',
                children: jsx.jsx('path', {
                  d: 'M4 6l4 4 4-4',
                  stroke: 'currentColor',
                  strokeWidth: 1.5,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                }),
              }),
            ],
          }),
          open && jsx.jsxs('div', {
            className: 'dsh-p2p-settings-body',
            children: [
              jsx.jsxs('div', {
                className: 'dsh-p2p-settings-fields',
                children: [
                  jsx.jsxs('label', {
                    className: 'dsh-p2p-settings-check',
                    children: [
                      jsx.jsx('input', {
                        type: 'checkbox',
                        checked: settings.longTextAsAttachment,
                        disabled: !writable,
                        onChange: (event) => write('longTextAsAttachment', event.target.checked),
                      }),
                      '将长文本保存为附件',
                    ],
                  }),
                  jsx.jsxs('label', {
                    className: 'dsh-p2p-settings-field',
                    children: [
                      '长文本阈值（字符）',
                      jsx.jsx('input', {
                        type: 'number',
                        min: 1,
                        step: 1,
                        value: threshold,
                        disabled: !writable || !settings.longTextAsAttachment,
                        onChange: (event) => setThreshold(event.target.value),
                        onBlur: () => writeNumber('longTextThreshold', threshold),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                        },
                      }),
                      jsx.jsx('span', {
                        className: 'dsh-p2p-settings-hint',
                        children: '达到此字符数的文本会保存为 .txt 附件。',
                      }),
                    ],
                  }),
                  jsx.jsxs('label', {
                    className: 'dsh-p2p-settings-field',
                    children: [
                      '交给 DSH 原生处理的图片后缀',
                      jsx.jsx('input', {
                        type: 'text',
                        value: extensions,
                        disabled: !writable,
                        placeholder: '例如：png, jpg, webp, gif',
                        onChange: (event) => setExtensions(event.target.value),
                        onBlur: () => writeExtensions(extensions),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                        },
                      }),
                      jsx.jsx('span', {
                        className: 'dsh-p2p-settings-hint',
                        children: '用逗号或空格分隔后缀；匹配的文件会绕过插件，保留 DSH 原生图片预览和模型图片输入。',
                      }),
                    ],
                  }),
                  jsx.jsxs('label', {
                    className: 'dsh-p2p-settings-field',
                    children: [
                      '单个附件大小上限（字节）',
                      jsx.jsx('input', {
                        type: 'number',
                        min: 1,
                        step: 1,
                        value: maxBytes,
                        disabled: !writable,
                        onChange: (event) => setMaxBytes(event.target.value),
                        onBlur: () => writeNumber('maxBytes', maxBytes),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                        },
                      }),
                    ],
                  }),
                  jsx.jsxs('label', {
                    className: 'dsh-p2p-settings-field',
                    children: [
                      '可编辑文本大小上限（字节）',
                      jsx.jsx('input', {
                        type: 'number',
                        min: 1,
                        step: 1,
                        value: editableTextMaxBytes,
                        disabled: !writable,
                        onChange: (event) => setEditableTextMaxBytes(event.target.value),
                        onBlur: () => writeNumber('editableTextMaxBytes', editableTextMaxBytes),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                        },
                      }),
                    ],
                  }),
                ],
              }),
              jsx.jsxs('div', {
                className: 'dsh-p2p-settings-actions',
                children: [
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dsh-p2p-button',
                    disabled: !writable,
                    onClick: reset,
                    children: '恢复 profile 默认值',
                  }),
                  !writable && jsx.jsx('span', { className: 'dsh-p2p-settings-status', children: '当前设置为只读。' }),
                  error && jsx.jsx('span', { className: 'dsh-p2p-error', children: error }),
                ],
              }),
            ],
          }),
        ],
      })
    }

    function installStyle() {
      var tag = document.querySelector('style[data-plugin="dsh-paste-to-path"]')
      if (tag) return () => {}
      tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-paste-to-path'
      tag.textContent = css
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    function apply(ctx) {
      _ctx = ctx
      var disposeStyle = installStyle()
      configScope = createBridgeScope('paste-to-path')
      ctx.effect(
        () => {
          function synchronizeConfig() {
            var snapshot = configScope.getSnapshot()
            if (snapshot.status === 'ready') {
              config = snapshot.value
              configUnavailableLogged = false
              return
            }
            config = null
            if (snapshot.status === 'unavailable' && !configUnavailableLogged) {
              configUnavailableLogged = true
              console.error('[dsh-paste-to-path] settings bridge is unavailable; paste-to-path interception is disabled')
            }
          }
          var dispose = configScope.subscribe(synchronizeConfig)
          synchronizeConfig()
          return () => {
            dispose()
            config = null
            configScope.dispose()
            configScope = null
          }
        },
        'dsh-paste-to-path: settings mirror',
      )
      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            id: 'paste-to-path',
            order: 30,
            inject: () => ({ scope: configScope }),
          },
          PasteToPathSettingsCard,
        ),
      )
      var disposeSource = ctx.inputTriggers.registerSource({
        trigger: '@',
        name: 'paste-to-path',
        order: 1000,
        candidates: async () => [],
        onPick: () => undefined,
        codec: {
          clipboardText: (ref) => modelText(byId.get(ref)),
          serialize: async (ref, signal) => {
            if (signal.aborted) throw signal.reason || new Error('attachment serialization aborted')
            return modelText(byId.get(ref))
          },
        },
      })
      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.dock',
            id: 'paste-to-path-attachments',
            order: 5,
            registrant: 'dsh-paste-to-path',
          },
          AttachmentDock,
        ),
      )
      document.addEventListener('paste', onPaste, true)
      document.addEventListener('dragenter', onDragEnter, true)
      document.addEventListener('dragover', onDragOver, true)
      document.addEventListener('drop', onDrop, true)
      if (typeof ctx.effect === 'function') {
        ctx.effect(
          () => () => {
            document.removeEventListener('paste', onPaste, true)
            document.removeEventListener('dragenter', onDragEnter, true)
            document.removeEventListener('dragover', onDragOver, true)
            document.removeEventListener('drop', onDrop, true)
            disposeSource()
            disposeStyle()
            queues.clear()
            listeners.clear()
            bySession.clear()
            byId.clear()
            for (var url of previewUrls) URL.revokeObjectURL(url)
            previewUrls.clear()
            _ctx = null
          },
          'dsh-paste-to-path: path-backed attachments',
        )
      }
    }

    exports.apply = apply
    exports.inject = ['sessions', 'conversation', 'slots', 'inputTriggers', 'connection', 'remote', 'settingsScope', 'workspaces']
    return module.exports
  },
})
