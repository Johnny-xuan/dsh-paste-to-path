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
    var config = {
      longTextAsAttachment: true,
      longTextThreshold: 8000,
      maxBytes: 25 * 1024 * 1024,
      editableTextMaxBytes: 1024 * 1024,
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

    function consume(event, target, files) {
      var active = _ctx && activeSession(_ctx)
      if (!active) return false
      var snapshot = active.input.state.getSnapshot()
      var base = {
        draft: snapshot.draft,
        rev: snapshot.draftRev,
        start: target.selectionStart ?? snapshot.draft.length,
        end: target.selectionEnd ?? target.selectionStart ?? snapshot.draft.length,
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      schedule(active.sessionId, () => routeFiles(active, target, base, files))
      return true
    }

    function longTextFile(text) {
      var stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
      return new File([text], `pasted-text-${stamp}.txt`, { type: 'text/plain;charset=utf-8' })
    }

    function onPaste(event) {
      if (!isComposer(event.target)) return
      var files = filesOfPaste(event)
      if (files.length > 0) {
        consume(event, event.target, files)
        return
      }
      if (!config.longTextAsAttachment) return
      var text = event.clipboardData?.getData('text/plain') || ''
      if (text.length >= config.longTextThreshold) consume(event, event.target, [longTextFile(text)])
    }

    function onDragEnter(event) {
      if (!carriesFiles(event) || !currentComposer()) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    function onDragOver(event) {
      if (!carriesFiles(event) || !currentComposer()) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    function onDrop(event) {
      if (!carriesFiles(event)) return
      var target = isComposer(event.target) ? event.target : currentComposer()
      if (!target) return
      var files = filesOfDrop(event)
      if (files.length > 0) consume(event, target, files)
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
                  jsx.jsx('div', { className: 'dsh-p2p-sub', children: `${formatBytes(item.bytes)} · ${item.category} · ${item.path}` }),
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
                      children: editing ? 'Collapse' : 'Edit',
                    }),
                  canOpenPath &&
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dsh-p2p-button',
                      disabled: opening,
                      title: 'Open with the default application on the DSH host',
                      onClick: openPath,
                      children: opening ? 'Opening…' : 'Open',
                    }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dsh-p2p-button dsh-p2p-remove',
                    title: 'Remove from this message (keep the local file)',
                    'aria-label': `Remove attachment ${item.name}`,
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
                  ? jsx.jsx('div', { children: 'Loading text attachment…' })
                  : jsx.jsx('textarea', {
                      value: content,
                      disabled: saving,
                      onChange: (event) => setContent(event.target.value),
                      'aria-label': `Edit ${item.name}`,
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
                      children: 'Cancel',
                    }),
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dsh-p2p-button',
                      disabled: loading || saving,
                      onClick: save,
                      children: saving ? 'Saving…' : 'Save',
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

    function installStyle() {
      var tag = document.querySelector('style[data-plugin="dsh-paste-to-path"]')
      if (tag) return () => {}
      tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-paste-to-path'
      tag.textContent = css
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    function loadConfig() {
      fetch('/paste-to-path/config')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`config failed (${res.status})`))))
        .then((value) => {
          config = { ...config, ...value }
        })
        .catch((error) => console.error('[dsh-paste-to-path] config unavailable', error))
    }

    function apply(ctx) {
      _ctx = ctx
      var disposeStyle = installStyle()
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
      loadConfig()
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
    exports.inject = ['sessions', 'conversation', 'slots', 'inputTriggers', 'connection', 'workspaces']
    return module.exports
  },
})
