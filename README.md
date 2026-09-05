# dsh-paste-to-path

> **A universal attachment dock for DSH.**

English | [简体中文](https://github.com/Johnny-xuan/dsh-paste-to-path/blob/main/docs/README.zh.md)

`dsh-paste-to-path` adds a general-purpose attachment Dock to the DSH Web composer.

Paste, drop, or choose images, PDFs, Word and Excel documents, archives, code, logs, and other files, then review and manage them together before sending.

<p align="center">
  <img src="https://raw.githubusercontent.com/Johnny-xuan/dsh-paste-to-path/main/assets/demo.png" alt="dsh-paste-to-path attachment dock" width="100%">
</p>

<p align="center"><em>Images, PDFs, archives, and other formats share one attachment Dock.</em></p>

The DSH `0.1.2-rc.1` Web composer has a native image attachment path, but PDFs, Office documents, archives, and other formats do not have the same model-independent entry point. Even an image may fail when the selected model does not support image input or the active adapter is text-only.

`dsh-paste-to-path` does not extend the model's native content types. It takes a simpler route:

```text
File
  ↓
DSH Host
  ↓
Local path
  ↓
Agent
  ↓
Your own tools
```

Send images to your own vision tool, PDFs to a document reader, and archives to shell or extraction tools.

The plugin owns **attachment intake, management, and path delivery**. Your Agent tool stack decides how to read the file.

---

## Path flow at a glance

<p align="center">
  <img src="https://raw.githubusercontent.com/Johnny-xuan/dsh-paste-to-path/main/assets/dsh-paste-to-path-poster-4k.png" alt="How dsh-paste-to-path works" width="100%">
</p>

<p align="center"><em>The file is saved on the DSH Host, then its path is given to the Agent.</em></p>

---

## What it does

### Universal attachment Dock

Paste, drop, or choose a file and an attachment card appears above the composer. The plugin's paperclip button accepts any file type and routes it through this Dock rather than DSH's native image rail.

Each card shows the file name, size, category, and path. You can remove it before sending.

Images also have thumbnails and lightbox previews.

---

### File-manager clipboard support

The plugin catches every real `File` object exposed by the browser, including empty files. It can also turn a pasted `file:` URI or absolute path into a card when that path already exists on the DSH Host.

Path conversion is transactional: every candidate path must exist on the DSH Host. If any candidate is unavailable, the original clipboard text is pasted normally without an attachment error or a partial conversion.

Browsers do not consistently expose non-image files copied from Windows Explorer, Finder, or Linux file managers. If the paste event contains neither file bytes nor a usable Host path, an ordinary web page cannot reconstruct the hidden OS clipboard entry. To address [Issue #2](https://github.com/Johnny-xuan/dsh-paste-to-path/issues/2), the plugin reads Explorer's `FileDropList` at this point when DSH runs on a local Windows Host through a direct `localhost` connection; remote clients never access the Host clipboard. In other cases, use the plugin's paperclip button or drag and drop. A path from a remote browser's device is not a path on the DSH Host.

---

### One flow for many file types

Images, PDFs, Office documents, code, logs, archives, and other binary files all use the same attachment flow:

```text
File → Save on Host → Path reference → Agent
```

You do not need a separate model-input protocol for every file type.

---

### Turn long pasted text into an attachment

Normal text still pastes normally.

When pasted content crosses the configured threshold, the plugin can save it as a `.txt` file instead of putting tens of thousands of characters directly into the composer.

The default threshold is `8000` characters.

---

### Edit text files before sending

Text and code attachments can be edited directly in the Dock when they are below the configured size limit.

The default limit is 1 MiB.

---

### Open files with the system application

For a local DSH deployment, the authenticated `session.openWorkspacePath` Remote API can open an attachment with the system's default application.

---

## Installation

Install into a DSH Web profile:

```bash
dsh plugin --profile web add dsh-paste-to-path
```

You can also install the current GitHub branch directly:

```bash
dsh plugin --profile web add github:Johnny-xuan/dsh-paste-to-path
```

Restart DSH after installation:

```bash
dsh web
```

The package includes a `dsh.bundle` manifest, so the required loader patch is loaded with the plugin.

---

## How it works

When you paste, drop, or choose a file, the plugin catches it and saves a private copy on the DSH Host:

```text
<workspace>/.dsh/pastes/<category>/
```

The composer does not contain the file's contents. It keeps an attachment reference instead.

If you paste an absolute path that already exists on the DSH Host, the plugin links that existing file instead of copying it. Linked files are never editable from the Dock.

When you send the message, DSH's reference codec expands that reference into a short path instruction:

```text
Paste / drop file
        │
        ▼
Save on DSH Host
        │
        ▼
Attachment Dock
shows the file card
        │
        ▼
Send message
        │
        ▼
reference codec
creates a path instruction
        │
        ▼
Agent receives the path
        │
        ▼
Uses an available tool to read it
```

The implementation uses DSH's extension mechanisms:

- `conversation.input.dock`
- `conversation.input.left`
- input-trigger reference codec
- `settingsScope`

No DSH core modification is required.

---

## What the Agent receives

The plugin does not put file bytes in the initial model request.

For example, a PDF expands to:

```text
Document attachment: /absolute/path/to/report.pdf
Read it using an appropriate tool for this file format.
```

An image expands similarly:

```text
Image attachment: /absolute/path/to/image.png
Inspect it using an available image-reading method.
```

Text, code, archives, and other formats receive equivalent path instructions.

The instructions do not require a particular tool. The Agent decides what to do next from the tools that are actually available in the current session.

---

## Bring your own tools

`dsh-paste-to-path` does not parse file contents.

Connect whichever tools fit your Agent environment, for example:

- images → your own `read_image` or vision tool
- PDF / Word / Excel → document readers
- scans → OCR
- code / logs → shell or filesystem tools
- ZIP / TAR → archive extractors

The plugin does not install these tools or assume that the current model has their capabilities.

Any compatible tool that can access the file path on the DSH Host can read the stored attachment.

If the Agent has no suitable tool, the file still enters the Dock and is saved on the Host, but the Agent cannot understand its contents.

---

## Why paths

In DSH's native attachment path, supported file formats and model capabilities are closely related.

In DSH `0.1.2-rc.1`, the native Web image intake accepts:

- PNG
- JPEG
- WebP
- GIF

Other MIME types do not enter the same native image path.

An image that passes the format check may still fail if it reaches a model without image input or a text-only adapter.

`dsh-paste-to-path` separates two concerns:

```text
Give the file to the Agent
```

and:

```text
Understand the file's contents
```

The plugin handles only the first.

The file becomes an ordinary file on the Host. The Agent's tool layer handles the second.

---

## Configuration

Default configuration is provided by `cordis.patch.yml`:

```yaml
- insert:
    - id: paste-to-path
      name: dsh-paste-to-path
      config:
        capturePaste: true
        captureDrop: true
        showPicker: true
        showDock: true
        longTextAsAttachment: true
        longTextThreshold: 8000
        pathTextAsAttachment: true
        windowsClipboardFallback: true
        maxBytes: 26214400
        editableTextMaxBytes: 1048576
```

| Option | Default | Description |
| --- | --- | --- |
| `capturePaste` | `true` | Register the paste listener for files, Host paths, and long text |
| `captureDrop` | `true` | Register the file drag-and-drop listeners |
| `showPicker` | `true` | Register the paperclip entry in `conversation.input.left` |
| `showDock` | `true` | Register the path-attachment Dock in `conversation.input.dock` |
| `longTextAsAttachment` | `true` | Save long pasted text as a `.txt` attachment |
| `longTextThreshold` | `8000` | Character threshold for long-text conversion |
| `pathTextAsAttachment` | `true` | Link pasted absolute paths that exist on the DSH Host |
| `windowsClipboardFallback` | `true` | Read Explorer's FileDropList on a direct localhost Windows Host when the browser hides file bytes |
| `maxBytes` | 25 MiB | Maximum size of one attachment |
| `editableTextMaxBytes` | 1 MiB | Maximum text-file size editable in the Dock |

All ten values are available under **Settings → Plugins → Paste to Path**. Version `0.0.5` uses DSH's official third-party settings scope; changes are persisted through DSH settings and apply immediately. Turning off one of the first four options unregisters that listener or slot instead of leaving an inactive handler behind. The reset button returns all ten values to the profile defaults shown above.

The attachment Dock, notifications, and settings card follow DSH's **Language** preference and include English and Simplified Chinese. The path instructions serialized for the Agent remain stable English protocol text and do not change with the UI language.

If a Web UI does not have a writable settings scope, configure the `paste-to-path` entry in that profile's `cordis.patch.yml`. Attachment handling remains active with the Host-provided configuration even when the settings card is read-only.

### Coexisting with another upload plugin

The default remains the complete Paste to Path experience. If another plugin should own drag/drop and the paperclip while Paste to Path keeps clipboard intake and its path Dock, use:

```yaml
capturePaste: true
captureDrop: false
showPicker: false
showDock: true
```

Set `capturePaste: false` as well when the other plugin should own paste. Core path storage, session isolation, reference serialization, route authentication, and lifecycle cleanup remain active; only the selected browser listeners and UI slots are released.

---

## File storage

With a workspace, attachments are stored under:

```text
<workspace>/.dsh/pastes/<category>/
```

Without a workspace, storage falls back to:

```text
$DSH_HOME/tmp-paste/<category>/
```

Files copied into plugin storage use permissions:

```text
0600
```

An existing Host path pasted as an attachment is linked in place. The plugin does not copy it, change its permissions, or allow Dock editing of the original file.

Removing an attachment from the Dock removes only its reference from the current draft. It does not delete the file from disk.

The path therefore remains valid for undo, re-send, or later reference.

---

## Privacy

Files chosen, dropped, or exposed as browser `File` objects are uploaded to your own DSH Host and saved on its local filesystem. Existing Host paths are only linked in place.

On DSH `0.1.2-rc.1`, every plugin HTTP route uses DSH's browser authentication and Host/Origin trust checks. Attachment records are isolated by session, and route registrations are removed with the plugin's Cordis lifecycle.

The plugin itself does not:

- upload files directly to a model provider
- upload files to a third-party file service
- parse file contents during upload

The initial model request contains only the file path and a short instruction.

If the Agent later uses another tool or external service to process the file, that tool's own behavior and configuration apply.

---

## Design boundary

`dsh-paste-to-path` owns only this part:

```text
File
  ↓
Attachment Dock
  ↓
Host filesystem
  ↓
Path reference
```

This part:

```text
Path
  ↓
Vision / PDF Reader / OCR / Shell / ...
```

belongs to the Agent's tool layer.

The plugin therefore does not:

- modify or replace a model adapter
- pretend that the model supports vision
- bind the workflow to a fixed vision, OCR, or document tool
- parse attachment contents during transport
- create a native DSH `image` content block

---

## Compatibility

Version `0.0.5` targets and is tested with:

```text
DeepSeek Harness 0.1.2-rc.1
```

It supports the Lexical composer, `useInput` slot stores, length-aware reference occurrences, authenticated Web routes, Cordis-owned route disposal, and the current Remote path-opening API. Version `0.0.4` remains the published compatibility line for DSH `0.1.0-rc.6` through `0.1.0-rc.8`.

DSH is currently a developer preview. Changes to its extension interfaces may require a corresponding plugin update.
