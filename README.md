# dsh-paste-to-path

> **Final release: choose DSH Native or classic P2P attachments.**

English | [简体中文](./docs/README.zh.md)

`dsh-paste-to-path` originally gave DeepSeek Harness a universal attachment Dock when the Web composer accepted only a small image whitelist. DSH `0.1.5+` now ships its own generic-file pipeline with background upload, persistence, one attachment rail, model-readable paths, and Sidebar previews.

That closes the gap this plugin was created to fill. Version `0.0.7` is the final compatibility release.

It keeps exactly two user-facing choices:

1. **Take over DSH Native attachments** — restore the complete classic P2P path-backed workflow.
2. **Long text as attachment** — turn a very long plain-text paste into a `.txt` attachment.

The default is deliberately modern:

```text
Take over DSH Native attachments: off
Long text as attachment:          on
```

Files and images therefore use DSH Native by default. P2P does not register its picker or Dock and does not consume file paste or drop events.

## The two modes

| Takeover | Ordinary files and images | Long pasted text |
| --- | --- | --- |
| Off (default) | DSH Native owns picker, paste, drop, upload, cards, persistence, and model paths | Converted to a `.txt` file and admitted through the DSH Native attachment pipeline |
| On | Classic P2P owns picker, paste, drop, path Dock, Host storage, and path references | Converted through the classic P2P path-backed pipeline |

This is exclusive ownership, not two competing attachment systems. When takeover is off, browser-provided files are left completely untouched for DSH. When takeover is on, classic P2P owns the entire attachment interaction.

## Why the project is retiring

The original design separated two concerns:

```text
getting a file into the conversation
                    ≠
understanding the file's contents
```

P2P saved a file on the DSH Host, inserted a path reference, and let the Agent choose an available image, document, archive, or filesystem tool. It did not wrap model capabilities or bind users to one vision stack.

DSH now follows the same core model for generic files, with a stronger durable implementation. Maintaining a second default attachment system would create duplicate UI, competing paste/drop handlers, and weaker lifecycle behavior. The correct final state is therefore Native by default, with classic P2P available only by explicit choice.

## Installation

```bash
dsh plugin --profile web add dsh-paste-to-path
```

Then restart DSH:

```bash
dsh web
```

This final release targets:

```text
DeepSeek Harness >= 0.1.5-rc.1 and < 0.2.0
```

Users maintaining pre-native-attachment DSH installations should pin the historical release:

```bash
dsh plugin --profile web add dsh-paste-to-path@0.0.6
```

## Configuration

On DSH `0.1.6+`, open the plugin's installed-bundle page and configure the `paste-to-path` row. On DSH `0.1.5`, the same controls remain available through the older configurable-plugin settings surface.

The profile defaults are:

```yaml
- insert:
    - id: paste-to-path
      name: dsh-paste-to-path
      config:
        takeOverNativeAttachments: false
        longTextAsAttachment: true
        longTextThreshold: 8000
```

The settings UI keeps the two primary choices and nests `longTextThreshold` under long-text conversion. It defaults to `8000` JavaScript characters and can be changed directly from the plugin settings page or in the profile configuration.

## Native mode

With takeover off, P2P does not handle:

- ordinary file or image paste;
- drag and drop;
- file selection;
- attachment cards or previews;
- file upload, retry, persistence, or model-facing paths.

All of those remain native DSH responsibilities.

For a qualifying long text paste, the plugin creates a browser `File` and admits it through DSH's public Conversation attachment state machine. DSH then owns its upload, card, retry, durable storage, and read-only model path.

If native admission cannot start, the plugin does not prevent the paste, so the original text remains available to the composer.

## Classic P2P takeover

Enabling takeover restores the historical workflow:

```text
paste / drop / choose
          ↓
save on DSH Host
          ↓
P2P attachment Dock + reference chip
          ↓
send a short English path instruction
          ↓
Agent chooses an available tool
```

This mode still supports arbitrary files, image thumbnails, text editing within the configured size limit, Host-path linking, and the localhost-only Windows Explorer clipboard fallback introduced for [Issue #2](https://github.com/Johnny-xuan/dsh-paste-to-path/issues/2).

Classic mode is retained for preference and compatibility, not recommended over DSH Native for new installations.

## Security and privacy

In Native mode, attachment storage and transport are entirely owned by DSH.

In classic takeover mode:

- uploaded files stay on the user's DSH Host;
- plugin routes require the authenticated DSH Web connection;
- stored copies use private file permissions where the platform supports them;
- remote clients cannot read the Windows Host clipboard;
- the first model request contains a path instruction, not the file bytes;
- later tool behavior is governed by the user's own Agent tool stack.

## Project status

`0.0.7` is the final release of `dsh-paste-to-path`. The repository and historical packages remain available, but no further releases are planned: the project will not compete with or reimplement future DSH attachment architecture.

The workaround became optional because the platform fixed the underlying problem. That is the best possible ending for this plugin.
