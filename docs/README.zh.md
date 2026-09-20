# dsh-paste-to-path

> **A universal attachment dock for DSH.**

[English](../README.md) | 简体中文

> [!IMPORTANT]
> **最终版本 — v0.0.7**
>
> DSH 官方现在已经提供通用文件附件管线，P2P 最初要补齐的兼容性缺口已经消失。因此 `0.0.7` 是本项目的最后一个版本，不再计划后续发布。
>
> 普通文件与图片默认由 DSH Native 接管；只有明确希望使用经典路径附件流程时，才需要打开 **接管 DSH 原生附件系统**。长文本转附件仍可独立使用。

下文保留经典 P2P 工作方式的完整说明；这些能力会在开启接管后生效。

`dsh-paste-to-path` 给 DSH Web composer 增加了一个通用附件 Dock。

你可以直接粘贴、拖入或选择图片、PDF、Word、Excel、压缩包、代码、日志以及其他文件，在发送前统一查看和管理它们。

<p align="center">
  <img src="https://raw.githubusercontent.com/Johnny-xuan/dsh-paste-to-path/main/assets/demo.png" alt="dsh-paste-to-path attachment dock" width="100%">
</p>

<p align="center"><em>图片、PDF、压缩包等不同格式，都可以放进同一个附件 Dock。</em></p>

DSH `0.1.2-rc.1` 的 Web composer 提供原生图片附件链路，但 PDF、Office 文档、压缩包以及其他格式仍没有同样独立于模型能力的入口；即使是图片，在不支持图像输入的模型或 text-only adapter 下，也可能无法直接发送。

`dsh-paste-to-path` 不去扩展模型原生的 content 类型，而是走另一条更简单的路径：

```text
文件
  ↓
DSH Host
  ↓
本地路径
  ↓
Agent
  ↓
你自己接入的工具
```

图片可以交给你自己接入的 vision 工具，PDF 可以交给文档读取工具，压缩包可以用 shell 或解压工具处理。

插件负责的是**附件接收、管理和路径传递**；文件具体怎么读取，由你的 Agent 工具栈决定。

---

## 路径流程概览

<p align="center">
  <img src="https://raw.githubusercontent.com/Johnny-xuan/dsh-paste-to-path/main/assets/dsh-paste-to-path-poster-4k.png" alt="dsh-paste-to-path 工作方式" width="100%">
</p>

<p align="center"><em>文件先保存到 DSH Host，再把路径交给 Agent。</em></p>

---

## 能做什么

### 通用附件 Dock

粘贴、拖入或选择文件后，输入框上方会出现对应的附件卡片。插件提供的回形针按钮接受任意格式，不进入 DSH 原生的图片专用附件栏。

每张卡片会显示文件名、大小、类型和路径，并且可以在发送前移除。

图片还支持缩略图和灯箱预览。

---

### 文件管理器剪贴板支持

只要浏览器确实提供了 `File` 对象，插件就会接住它，包括空文件。浏览器如果提供 `file:` URI 或绝对路径，并且该路径确实存在于 DSH Host，插件也可以直接把它变成附件卡片。

路径转换是事务性的：候选路径必须全部存在于 DSH Host。只要其中一个不可用，插件就会把剪贴板原文作为普通文本粘贴，不显示附件错误，也不会只转换一部分。

Windows Explorer、Finder 和 Linux 文件管理器复制非图片文件时，不同浏览器暴露的剪贴板内容并不一致。如果粘贴事件既没有文件字节，也没有可用的 Host 路径，普通网页无法从被浏览器隐藏的系统剪贴板格式中恢复文件。为处理 [Issue #2](https://github.com/Johnny-xuan/dsh-paste-to-path/issues/2)，本机 Windows Host 通过直接 `localhost` 使用时，插件会在这一步读取 Explorer 的 `FileDropList`；远程连接不会访问 Host 剪贴板。其他情况下请使用插件自己的回形针按钮或拖放。

---

### 多种文件使用同一套流程

图片、PDF、Office 文档、代码、日志、压缩包以及其他二进制文件，都走同一个附件流程：

```text
文件 → 保存到 Host → 路径引用 → Agent
```

不需要为每种文件类型单独设计一套模型输入协议。

---

### 长文本自动转成附件

普通文本仍然正常粘贴。

当粘贴内容超过设定阈值时，插件可以自动把它保存为 `.txt` 文件，而不是把几万字直接塞进输入框。

默认阈值是 `8000` 个字符。

---

### 发送前编辑文本文件

文本和代码附件在不超过配置的大小限制时，可以直接在 Dock 中修改。

默认上限为 1 MiB。

---

### 用系统应用打开文件

本机部署时，可以通过 DSH 已鉴权的 `session.openWorkspacePath` Remote API 使用系统默认程序打开附件。

---

## 安装

安装到 DSH Web profile：

```bash
dsh plugin --profile web add dsh-paste-to-path
```

也可以直接安装 GitHub 当前分支：

```bash
dsh plugin --profile web add github:Johnny-xuan/dsh-paste-to-path
```

安装完成后重新启动：

```bash
dsh web
```

包内包含 `dsh.bundle` manifest，所需的 loader patch 会随插件一起加载。

---

## 它是怎么工作的

当你粘贴、拖入或选择文件时，插件会先接住这个文件并在 DSH Host 保存一份私有副本：

```text
<workspace>/.dsh/pastes/<分类>/
```

输入框中不会直接塞入文件内容，而是保留一个附件引用。

如果粘贴的是已经存在于 DSH Host 的绝对路径，插件会直接引用原文件，不再复制；这类路径附件不能在 Dock 中编辑原文件。

发送消息时，DSH 的 reference codec 会把这个引用展开成一段简短的路径说明：

```text
粘贴 / 拖入文件
        │
        ▼
保存到 DSH Host
        │
        ▼
Attachment Dock
显示附件卡片
        │
        ▼
发送消息
        │
        ▼
reference codec
生成文件路径说明
        │
        ▼
Agent 收到路径
        │
        ▼
调用当前可用的工具读取
```

整个过程使用 DSH 自己提供的扩展机制：

- `conversation.input.dock`
- `conversation.input.left`
- input-trigger reference codec
- `settingsScope`

不需要修改 DSH 核心代码。

---

## Agent 实际收到什么

插件不会把文件字节直接放进首次模型请求。

例如，一个 PDF 会被展开成：

```text
Document attachment: /absolute/path/to/report.pdf
Read it using an appropriate tool for this file format.
```

图片则类似：

```text
Image attachment: /absolute/path/to/image.png
Inspect it using an available image-reading method.
```

文本、代码、压缩包和其他格式也会生成对应的路径说明。

这些说明不会指定某一个固定工具。Agent 会根据当前会话真正可用的工具决定下一步怎么处理。

---

## 使用你自己的工具

`dsh-paste-to-path` 本身不提供文件解析能力。

你可以按照自己的 Agent 环境接入任意工具，例如：

- 图片 → 自己配置的 `read_image`、vision 工具
- PDF / Word / Excel → 文档读取工具
- 扫描件 → OCR
- 代码 / 日志 → shell 或文件系统工具
- ZIP / TAR → 解压工具

插件不会安装这些工具，也不会假设当前模型具备这些能力。

只要工具能够访问 DSH Host 上的文件路径，就可以读取插件保存下来的附件。

如果当前 Agent 没有适合的工具，那么文件虽然已经成功进入 Dock 并保存到 Host，Agent 仍然无法理解它的内容。

---

## 为什么使用路径

DSH 原生附件链路里，文件格式和模型能力通常绑得比较紧。

在 DSH `0.1.2-rc.1` 中，原生 Web 图片入口接收：

- PNG
- JPEG
- WebP
- GIF

其他 MIME 类型不会进入同一套原生图片链路。

而通过格式检查的图片，如果最终进入一个不支持图像输入的模型或 text-only adapter，也仍然可能失败。

`dsh-paste-to-path` 把这两件事拆开：

```text
把文件交给 Agent
```

和：

```text
理解文件内容
```

插件只处理前一件事。

文件先变成 Host 上的普通文件，再由 Agent 的工具层负责第二步。

---

## 配置

`0.0.7` 只保留两个主要选择：

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| **接管 DSH 原生附件系统** | 关闭 | 开启后，文件、图片、粘贴、拖放、选择器和附件 Dock 全部走经典 P2P；关闭后，普通附件完全交给 DSH Native。 |
| **将长文本粘贴转换为附件** | 开启 | 把达到阈值的纯文本粘贴转换成 `.txt` 附件，可以配合任意一种附件管线使用。 |

长文本字符阈值是第二个选项的从属设置，默认值为 `8000`，仍可直接在插件设置页修改。

对应的 profile 默认配置为：

```yaml
- insert:
    - id: paste-to-path
      name: dsh-paste-to-path
      config:
        takeOverNativeAttachments: false
        longTextAsAttachment: true
        longTextThreshold: 8000
```

接管关闭时，P2P 不注册自己的文件选择器和 Dock，也不会拦截普通文件的粘贴与拖放。接管开启时，下文介绍的完整经典 P2P 工作流才会生效。

设置界面会跟随 DSH 的 **Language** 偏好，目前提供英文和简体中文；发送给 Agent 的路径说明仍保持稳定的英文协议文本。

---

## 文件存储

有 workspace 时，附件保存在：

```text
<workspace>/.dsh/pastes/<分类>/
```

没有 workspace 时回退到：

```text
$DSH_HOME/tmp-paste/<分类>/
```

复制到插件存储目录的文件权限为：

```text
0600
```

把已经存在于 Host 的路径粘贴成附件时，插件只原地引用：不会复制文件、修改其权限，也不会允许 Dock 编辑原文件。

从 Dock 中移除一个附件，只会移除当前草稿里的引用，不会删除磁盘上的文件。

这样在撤销、重新发送或重新引用附件时，原来的路径仍然有效。

---

## 隐私

通过选择、拖放或浏览器 `File` 对象进入的文件会上传到你自己的 DSH Host，并保存在 Host 的本地文件系统中；已经存在的 Host 路径只会被原地引用。

在经典接管模式下，插件所有 HTTP 路由都会经过 DSH 的浏览器鉴权与 Host/Origin 信任检查；附件记录按会话隔离，路由注册也由插件的 Cordis 生命周期负责回收。

插件本身不会：

- 把文件直接上传给模型供应商
- 上传到第三方文件服务
- 在上传阶段解析文件内容

首次模型请求中出现的只是文件路径和一条简短说明。

如果 Agent 后续调用其他工具或外部服务处理文件，则以对应工具自己的行为和配置为准。

---

## 设计边界

`dsh-paste-to-path` 只负责这一段：

```text
File
  ↓
Attachment Dock
  ↓
Host filesystem
  ↓
Path reference
```

至于：

```text
Path
  ↓
Vision / PDF Reader / OCR / Shell / ...
```

属于 Agent 的工具层。

因此插件不会：

- 修改或替换模型 adapter
- 伪装模型具备视觉能力
- 绑定固定的 vision / OCR / document 工具
- 在传输阶段解析附件内容
- 生成 DSH 原生 `image` content block

---

## 兼容性

最终版本 `0.0.7` 面向：

```text
DeepSeek Harness >= 0.1.5-rc.1 且 < 0.2.0
```

该版本已在 DSH `0.1.6-alpha.2` 上完成测试。仍在维护旧版 DSH、且没有官方通用文件附件能力的用户，可以固定使用 `dsh-paste-to-path@0.0.6`。

由于 DSH 官方已经接手并持续维护本项目最初补齐的附件架构，因此不再计划后续插件版本。
