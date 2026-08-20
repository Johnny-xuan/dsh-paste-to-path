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
    var DEFAULT_CONFIG = Object.freeze({
      longTextAsAttachment: true,
      longTextThreshold: 8000,
      maxBytes: 25 * 1024 * 1024,
      editableTextMaxBytes: 1024 * 1024,
      pathTextAsAttachment: true,
      windowsClipboardFallback: true,
    })
    var config = { ...DEFAULT_CONFIG }
    var configScope = null
    var localeTranslate = null
    var LOCALE_NS = 'paste-to-path'
    var zh = Object.freeze({
      'upload.failed': '无法保存 {count} 个附件：{reason}',
      'upload.failedWithKept': '无法保存 {count} 个附件；已保留另外 {kept} 个：{reason}',
      'insert.failed': '附件已保存，但无法添加到当前草稿：{path}',
      'processing.failed': '附件处理失败：{reason}',
      'request.failed': '操作失败：{reason}',
      'attachment.saved': '附件已保存：{name}',
      'attachment.choose': '选择附件',
      'attachment.chooseTitle': '从设备选择任意格式的附件',
      'clipboard.unavailable': '浏览器没有提供这个文件。请使用回形针按钮选择文件，或将文件拖入输入框。',
      'preview.title': '预览 {name}',
      'preview.close': '关闭图片预览',
      'action.collapse': '收起',
      'action.edit': '编辑',
      'action.openTitle': '使用 DSH Host 的默认应用打开',
      'action.opening': '正在打开…',
      'action.open': '打开',
      'action.removeTitle': '从本次消息中移除（保留本地文件）',
      'action.removeAria': '移除附件 {name}',
      'editor.loading': '正在加载文本附件…',
      'editor.aria': '编辑 {name}',
      'action.cancel': '取消',
      'action.saving': '正在保存…',
      'action.save': '保存',
      'category.images': '图片',
      'category.text': '文本',
      'category.code': '代码',
      'category.docs': '文档',
      'category.archive': '压缩包',
      'category.misc': '文件',
      'settings.saveFailed': '设置保存失败。',
      'settings.positiveInteger': '请输入正整数。',
      'settings.resetFailed': '设置重置失败。',
      'settings.title': '粘贴到路径',
      'settings.description': '管理路径附件的大小限制和长文本行为。',
      'settings.longText': '将长文本粘贴转换为附件',
      'settings.pathText': '将本机绝对路径粘贴转换为附件',
      'settings.pathTextHint': '仅当该路径确实存在于 DSH Host 时生效；远程浏览器中的设备路径不会映射到 Host。',
      'settings.windowsClipboard': '本机 Windows Explorer 剪贴板后备',
      'settings.windowsClipboardHint': '仅在直接 localhost 连接中读取 Windows FileDropList；远程连接不会访问 Host 剪贴板。',
      'settings.threshold': '长文本阈值（字符）',
      'settings.thresholdHint': '达到此长度的文本会保存为 .txt 附件。',
      'settings.maxBytes': '单个附件大小上限（字节）',
      'settings.editableTextMaxBytes': '可编辑文本大小上限（字节）',
      'settings.reset': '恢复 profile 默认值',
      'settings.readOnly': '当前设置为只读。',
    })
    var en = Object.freeze({
      'upload.failed': 'Could not save {count} attachment(s): {reason}',
      'upload.failedWithKept': 'Could not save {count} attachment(s); kept {kept} other attachment(s): {reason}',
      'insert.failed': 'Attachment was saved but could not be added to the current draft: {path}',
      'processing.failed': 'Attachment processing failed: {reason}',
      'request.failed': 'Operation failed: {reason}',
      'attachment.saved': 'Attachment saved: {name}',
      'attachment.choose': 'Choose attachments',
      'attachment.chooseTitle': 'Choose attachments of any file type from this device',
      'clipboard.unavailable': 'The browser did not expose this file. Use the paperclip button or drag the file into the composer.',
      'preview.title': 'Preview {name}',
      'preview.close': 'Close image preview',
      'action.collapse': 'Collapse',
      'action.edit': 'Edit',
      'action.openTitle': 'Open with the default application on the DSH host',
      'action.opening': 'Opening…',
      'action.open': 'Open',
      'action.removeTitle': 'Remove from this message (keep the local file)',
      'action.removeAria': 'Remove attachment {name}',
      'editor.loading': 'Loading text attachment…',
      'editor.aria': 'Edit {name}',
      'action.cancel': 'Cancel',
      'action.saving': 'Saving…',
      'action.save': 'Save',
      'category.images': 'images',
      'category.text': 'text',
      'category.code': 'code',
      'category.docs': 'documents',
      'category.archive': 'archives',
      'category.misc': 'files',
      'settings.saveFailed': 'The setting could not be saved.',
      'settings.positiveInteger': 'Enter a positive integer.',
      'settings.resetFailed': 'The settings could not be reset.',
      'settings.title': 'Paste to Path',
      'settings.description': 'Manage path-backed attachment limits and long-text behavior.',
      'settings.longText': 'Turn long pasted text into an attachment',
      'settings.pathText': 'Turn pasted absolute Host paths into attachments',
      'settings.pathTextHint': 'Only applies when the path exists on the DSH Host; a remote browser device path does not map to the Host.',
      'settings.windowsClipboard': 'Local Windows Explorer clipboard fallback',
      'settings.windowsClipboardHint': 'Reads the Windows FileDropList only over a direct localhost connection; remote clients never access the Host clipboard.',
      'settings.threshold': 'Long-text threshold (characters)',
      'settings.thresholdHint': 'Text at or above this length is stored as a .txt attachment.',
      'settings.maxBytes': 'Maximum attachment size (bytes)',
      'settings.editableTextMaxBytes': 'Maximum editable text size (bytes)',
      'settings.reset': 'Reset to profile defaults',
      'settings.readOnly': 'Settings are read-only.',
    })

    function fallbackTranslate(key, params = {}) {
      var template = en[key] || key
      return template.replace(/\{([^}]+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))
    }

    function tr(key, params) {
      return localeTranslate ? localeTranslate(key, params) : fallbackTranslate(key, params)
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
      .dsh-p2p-settings-field input[type=number]{box-sizing:border-box;width:100%;max-width:420px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);padding:5px 8px;font:inherit}
      .dsh-p2p-settings-field input:disabled{opacity:.55;cursor:not-allowed}
      .dsh-p2p-settings-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
      .dsh-p2p-settings-check{display:flex;align-items:center;gap:7px;cursor:pointer}
      .dsh-p2p-settings-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}
      .dsh-p2p-settings-status{color:var(--dsw-alias-label-tertiary);font-size:12px}
      .dsh-p2p-picker{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);height:28px;width:28px;padding:0;border-radius:7px;display:grid;place-items:center;cursor:pointer}
      .dsh-p2p-picker:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
      .dsh-p2p-picker:disabled{opacity:.45;cursor:default}
      .dsh-p2p-picker-input{display:none}
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
        if (file) files.push(file)
      }
      if (files.length === 0 && data.files) {
        files = Array.from(data.files).filter(Boolean)
      }
      return files
    }

    function filesOfDrop(event) {
      var files = event.dataTransfer?.files
      return files ? Array.from(files).filter(Boolean) : []
    }

    function unquotePath(value) {
      var candidate = value.trim()
      if (candidate.length < 2) return candidate
      var quote = candidate[0]
      return (quote === '"' || quote === "'") && candidate[candidate.length - 1] === quote
        ? candidate.slice(1, -1).trim()
        : candidate
    }

    function looksLikeHostPath(value) {
      return (
        /^file:/i.test(value) ||
        /^[a-z]:[\\/]/i.test(value) ||
        /^\\\\[^\\]+\\[^\\]+/.test(value) ||
        /^\/(?!\/)/.test(value)
      )
    }

    function pathLines(value) {
      return value
        .split(/\r?\n/)
        .map((line) => unquotePath(line))
        .filter((line) => line !== '' && !line.startsWith('#'))
    }

    function pathsOfPaste(event) {
      if (!config.pathTextAsAttachment) return null
      var data = event.clipboardData
      if (!data) return null
      var uriList = data.getData('text/uri-list') || ''
      if (uriList !== '') {
        var uris = pathLines(uriList)
        if (uris.length > 0 && uris.every(looksLikeHostPath)) return { paths: uris, text: data.getData('text/plain') || uriList }
      }
      var text = data.getData('text/plain') || ''
      if (text === '') return null
      var paths = pathLines(text)
      if (paths.length === 0 || !paths.every(looksLikeHostPath)) return null
      return { paths, text }
    }

    function signalsClipboardFiles(event) {
      var data = event.clipboardData
      if (!data) return false
      if (Array.from(data.types || []).includes('Files')) return true
      return Array.from(data.items || []).some((item) => item.kind === 'file')
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

    function linkHostPath(path, active) {
      return fetch('/paste-to-path/from-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': encodeURIComponent(active.sessionId),
        },
        body: JSON.stringify({ path }),
      }).then((res) =>
        res
          .json()
          .catch(() => ({}))
          .then((body) => {
            if (!res.ok) throw new Error(body.error || `path attachment failed (${res.status})`)
            if (typeof body.id !== 'string' || typeof body.path !== 'string') {
              throw new Error('path attachment returned an invalid attachment')
            }
            return body
          }),
      )
    }

    function readWindowsClipboard(active) {
      return fetch('/paste-to-path/windows-clipboard', {
        method: 'POST',
        headers: { 'X-Session-Id': encodeURIComponent(active.sessionId) },
      }).then((res) =>
        res
          .json()
          .catch(() => ({}))
          .then((body) => {
            if (!res.ok) throw new Error(body.error || `Windows clipboard failed (${res.status})`)
            if (!Array.isArray(body.attachments)) throw new Error('Windows clipboard returned invalid attachments')
            return body.attachments
          }),
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
        var reason = failures[0]?.message || failures[0]
        active.input.notify(
          'error',
          successful.length > 0
            ? tr('upload.failedWithKept', { count: failures.length, kept: successful.length, reason })
            : tr('upload.failed', { count: failures.length, reason }),
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
            active.input.notify('error', tr('insert.failed', { path: item.path }))
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

    function restorePlainText(active, target, base, text) {
      return whenWritable(active.input, () => {
        var snapshot = active.input.state.getSnapshot()
        var unchanged = snapshot.draftRev === base.rev && snapshot.draft === base.draft
        var next = unchanged
          ? snapshot.draft.slice(0, base.start) + text + snapshot.draft.slice(base.end)
          : snapshot.draft + text
        active.input.setDraft(next)
        requestAnimationFrame(() => {
          if (!target.isConnected || !isComposer(target)) return
          var end = unchanged ? base.start + text.length : next.length
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
          notify(sessionId, 'error', tr('processing.failed', { reason: error?.message || error }))
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

    async function routePaths(active, target, base, paths, originalText) {
      var settled = await Promise.allSettled(paths.map((path) => linkHostPath(path, active)))
      if (settled.some((result) => result.status === 'rejected')) {
        await restorePlainText(active, target, base, originalText)
        return
      }
      await insertUploaded(active, target, base, settled)
    }

    async function routeWindowsClipboard(active, target, base, fallbackFiles) {
      try {
        var attachments = await readWindowsClipboard(active)
        await insertUploaded(
          active,
          target,
          base,
          attachments.map((value) => ({ status: 'fulfilled', value })),
        )
      } catch (error) {
        if (fallbackFiles.length > 0) {
          await routeFiles(active, target, base, fallbackFiles)
          return
        }
        active.input.notify('error', tr('clipboard.unavailable'))
        console.error('[dsh-paste-to-path] Windows clipboard fallback unavailable', error)
      }
    }

    function captureInsertion(target) {
      var active = _ctx && activeSession(_ctx)
      if (!active) return null
      var snapshot = active.input.state.getSnapshot()
      return {
        active,
        base: {
          draft: snapshot.draft,
          rev: snapshot.draftRev,
          start: target.selectionStart ?? snapshot.draft.length,
          end: target.selectionEnd ?? target.selectionStart ?? snapshot.draft.length,
        },
      }
    }

    function consume(event, target, files) {
      var insertion = captureInsertion(target)
      if (!insertion) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      schedule(insertion.active.sessionId, () => routeFiles(insertion.active, target, insertion.base, files))
      return true
    }

    function consumePaths(event, target, payload) {
      var insertion = captureInsertion(target)
      if (!insertion) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      schedule(insertion.active.sessionId, () =>
        routePaths(insertion.active, target, insertion.base, payload.paths, payload.text),
      )
      return true
    }

    function consumeWindowsClipboard(event, target, files) {
      var insertion = captureInsertion(target)
      if (!insertion) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      schedule(insertion.active.sessionId, () =>
        routeWindowsClipboard(insertion.active, target, insertion.base, files),
      )
      return true
    }

    function longTextFile(text) {
      var stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
      return new File([text], `pasted-text-${stamp}.txt`, { type: 'text/plain;charset=utf-8' })
    }

    function onPaste(event) {
      if (!isComposer(event.target)) return
      var files = filesOfPaste(event)
      var pathPayload = pathsOfPaste(event)
      if (files.length > 0 && (files.some((file) => file.size > 0) || !pathPayload)) {
        consume(event, event.target, files)
        return
      }
      if (pathPayload) {
        consumePaths(event, event.target, pathPayload)
        return
      }
      if (config.windowsClipboardFallback && signalsClipboardFiles(event)) {
        consumeWindowsClipboard(event, event.target, files)
        return
      }
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

    function categoryLabel(category, t) {
      var key = `category.${category}`
      return t(key) === key ? t('category.misc') : t(key)
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

    function AttachmentCard({ item, input, inputActions, canOpenPath, t }) {
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
            setError(t('request.failed', { reason: reason.message || String(reason) }))
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
            notify(item.sessionId, 'info', t('attachment.saved', { name: item.name }))
          },
          (reason) => {
            setError(t('request.failed', { reason: reason.message || String(reason) }))
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
            setError(t('request.failed', { reason: reason.message || String(reason) }))
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
                    title: t('preview.title', { name: item.name }),
                    'aria-label': t('preview.title', { name: item.name }),
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
                  jsx.jsx('div', {
                    className: 'dsh-p2p-sub',
                    children: `${formatBytes(item.bytes)} · ${categoryLabel(item.category, t)} · ${item.path}`,
                  }),
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
                      children: editing ? t('action.collapse') : t('action.edit'),
                    }),
                  canOpenPath &&
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dsh-p2p-button',
                      disabled: opening,
                      title: t('action.openTitle'),
                      onClick: openPath,
                      children: opening ? t('action.opening') : t('action.open'),
                    }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dsh-p2p-button dsh-p2p-remove',
                    title: t('action.removeTitle'),
                    'aria-label': t('action.removeAria', { name: item.name }),
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
                  ? jsx.jsx('div', { children: t('editor.loading') })
                  : jsx.jsx('textarea', {
                      value: content,
                      disabled: saving,
                      onChange: (event) => setContent(event.target.value),
                      'aria-label': t('editor.aria', { name: item.name }),
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
                      children: t('action.cancel'),
                    }),
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dsh-p2p-button',
                      disabled: loading || saving,
                      onClick: save,
                      children: saving ? t('action.saving') : t('action.save'),
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
              labels: { dialog: t('preview.title', { name: item.name }), close: t('preview.close') },
              onClose: () => setPreviewing(false),
            }),
        ],
      })
    }

    function AttachmentDock({ sessionId, input, inputActions, t }) {
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
          jsx.jsx(AttachmentCard, { item, input, inputActions, canOpenPath, t }, item.id),
        ),
      })
    }

    function AttachmentPicker({ sessionId, input, t }) {
      var picker = React.useRef(null)
      var disabled = !isWritable(input)

      function choose(event) {
        var files = Array.from(event.target.files || []).filter(Boolean)
        event.target.value = ''
        if (files.length === 0) return
        var target = currentComposer()
        var insertion = target && captureInsertion(target)
        if (!target || !insertion || insertion.active.sessionId !== sessionId) return
        schedule(sessionId, () => routeFiles(insertion.active, target, insertion.base, files))
      }

      return jsx.jsxs(React.Fragment, {
        children: [
          jsx.jsx('button', {
            type: 'button',
            className: 'dsh-p2p-picker',
            disabled,
            title: t('attachment.chooseTitle'),
            'aria-label': t('attachment.choose'),
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => picker.current?.click(),
            children: jsx.jsx('svg', {
              width: 16,
              height: 16,
              viewBox: '0 0 16 16',
              fill: 'none',
              'aria-hidden': 'true',
              children: jsx.jsx('path', {
                d: 'M5.2 8.9 9.6 4.5a2.1 2.1 0 0 1 3 3l-5.7 5.7a3.4 3.4 0 0 1-4.8-4.8l5.5-5.5',
                stroke: 'currentColor',
                strokeWidth: 1.4,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }),
            }),
          }),
          jsx.jsx('input', {
            ref: picker,
            className: 'dsh-p2p-picker-input',
            type: 'file',
            multiple: true,
            tabIndex: -1,
            onChange: choose,
          }),
        ],
      })
    }

    function PasteToPathSettingsCard({ scope, t }) {
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
      var [maxBytes, setMaxBytes] = React.useState('')
      var [editableTextMaxBytes, setEditableTextMaxBytes] = React.useState('')
      var [error, setError] = React.useState('')

      React.useEffect(() => {
        if (Number.isSafeInteger(settings?.longTextThreshold)) setThreshold(String(settings.longTextThreshold))
      }, [settings?.longTextThreshold])
      React.useEffect(() => {
        if (Number.isSafeInteger(settings?.maxBytes)) setMaxBytes(String(settings.maxBytes))
      }, [settings?.maxBytes])
      React.useEffect(() => {
        if (Number.isSafeInteger(settings?.editableTextMaxBytes)) {
          setEditableTextMaxBytes(String(settings.editableTextMaxBytes))
        }
      }, [settings?.editableTextMaxBytes])

      function write(field, value) {
        setError('')
        Promise.resolve(scope.set(field, value)).catch((reason) => {
          console.error('[dsh-paste-to-path] could not save setting', reason)
          setError(t('settings.saveFailed'))
        })
      }

      function writeNumber(field, text) {
        var value = Number(text)
        if (!Number.isSafeInteger(value) || value < 1) {
          setError(t('settings.positiveInteger'))
          return
        }
        if (settings?.[field] === value) return
        write(field, value)
      }

      function reset() {
        setError('')
        Promise.all([
          scope.unset('longTextAsAttachment'),
          scope.unset('longTextThreshold'),
          scope.unset('maxBytes'),
          scope.unset('editableTextMaxBytes'),
          scope.unset('pathTextAsAttachment'),
          scope.unset('windowsClipboardFallback'),
        ]).catch((reason) => {
          console.error('[dsh-paste-to-path] could not reset settings', reason)
          setError(t('settings.resetFailed'))
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
                  jsx.jsx('span', { className: 'dsh-p2p-settings-title', children: t('settings.title') }),
                  jsx.jsx('span', {
                    className: 'dsh-p2p-settings-description',
                    children: t('settings.description'),
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
                      t('settings.longText'),
                    ],
                  }),
                  jsx.jsxs('label', {
                    className: 'dsh-p2p-settings-check',
                    children: [
                      jsx.jsx('input', {
                        type: 'checkbox',
                        checked: settings.pathTextAsAttachment,
                        disabled: !writable,
                        onChange: (event) => write('pathTextAsAttachment', event.target.checked),
                      }),
                      t('settings.pathText'),
                    ],
                  }),
                  jsx.jsx('span', {
                    className: 'dsh-p2p-settings-hint',
                    children: t('settings.pathTextHint'),
                  }),
                  jsx.jsxs('label', {
                    className: 'dsh-p2p-settings-check',
                    children: [
                      jsx.jsx('input', {
                        type: 'checkbox',
                        checked: settings.windowsClipboardFallback,
                        disabled: !writable,
                        onChange: (event) => write('windowsClipboardFallback', event.target.checked),
                      }),
                      t('settings.windowsClipboard'),
                    ],
                  }),
                  jsx.jsx('span', {
                    className: 'dsh-p2p-settings-hint',
                    children: t('settings.windowsClipboardHint'),
                  }),
                  jsx.jsxs('label', {
                    className: 'dsh-p2p-settings-field',
                    children: [
                      t('settings.threshold'),
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
                        children: t('settings.thresholdHint'),
                      }),
                    ],
                  }),
                  jsx.jsxs('label', {
                    className: 'dsh-p2p-settings-field',
                    children: [
                      t('settings.maxBytes'),
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
                      t('settings.editableTextMaxBytes'),
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
                    children: t('settings.reset'),
                  }),
                  !writable && jsx.jsx('span', { className: 'dsh-p2p-settings-status', children: t('settings.readOnly') }),
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

    function acceptConfig(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return
      config = { ...config, ...value }
    }

    function loadConfig() {
      return fetch('/paste-to-path/config')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`config failed (${res.status})`))))
        .then((value) => {
          if (configScope?.getSnapshot()?.status !== 'ready') acceptConfig(value)
        })
        .catch((error) => console.error('[dsh-paste-to-path] config unavailable', error))
    }

    function apply(ctx) {
      _ctx = ctx
      var disposeStyle = installStyle()
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-paste-to-path: dictionaries')
      localeTranslate = ctx.locale.bind(LOCALE_NS)
      configScope = ctx.settingsScope.bind({ namespace: 'paste-to-path' })
      var synchronizeConfig = () => {
        var snapshot = configScope?.getSnapshot()
        if (snapshot?.status !== 'ready' || snapshot.value === undefined) return
        acceptConfig(snapshot.value)
      }
      var disposeConfig = configScope.subscribe(synchronizeConfig)
      synchronizeConfig()
      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            id: 'paste-to-path',
            key: 'paste-to-path',
            locale: LOCALE_NS,
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
            locale: LOCALE_NS,
          },
          AttachmentDock,
        ),
      )
      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.left',
            id: 'paste-to-path-picker',
            order: 20,
            registrant: 'dsh-paste-to-path',
            locale: LOCALE_NS,
          },
          AttachmentPicker,
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
            disposeConfig()
            disposeSource()
            disposeStyle()
            queues.clear()
            listeners.clear()
            bySession.clear()
            byId.clear()
            for (var url of previewUrls) URL.revokeObjectURL(url)
            previewUrls.clear()
            config = { ...DEFAULT_CONFIG }
            configScope = null
            localeTranslate = null
            _ctx = null
          },
          'dsh-paste-to-path: path-backed attachments',
        )
      }
    }

    exports.apply = apply
    exports.inject = [
      'sessions',
      'conversation',
      'slots',
      'inputTriggers',
      'connection',
      'locale',
      'workspaces',
      'settingsScope',
    ]
    return module.exports
  },
})
