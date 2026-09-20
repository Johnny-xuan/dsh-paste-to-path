# dsh-paste-to-path

> **最终版本：在 DSH Native 与经典 P2P 附件之间选择。**

[English](../README.md) | 简体中文

`dsh-paste-to-path` 最初诞生于 DSH Web composer 只接收少量图片格式的时期。它为图片、PDF、Office 文档、压缩包、代码和其他文件提供了统一的路径附件 Dock。

现在，DSH `0.1.5+` 已经原生提供通用文件附件，包括后台上传、统一附件区、持久化存储、Agent 可读取路径和 Sidebar 预览。

这意味着 P2P 最初要补的产品缺口已经消失。`0.0.7` 是本项目的最终兼容版本。

它只保留两个面向用户的选择：

1. **接管 DSH 原生附件系统**——恢复完整的经典 P2P 路径附件流程。
2. **长文本转附件**——把很长的纯文本粘贴转换成 `.txt` 附件。

默认配置刻意选择新版体验：

```text
接管 DSH 原生附件系统：关闭
长文本转附件：          开启
```

因此，文件和图片默认全部走 DSH Native。P2P 不会注册自己的 Picker 和 Dock，也不会吞掉文件粘贴或拖放事件。

## 两种模式

| 接管开关 | 普通文件与图片 | 长文本粘贴 |
| --- | --- | --- |
| 关闭（默认） | DSH Native 负责选择、粘贴、拖放、上传、卡片、持久化和 Agent 路径 | 生成 `.txt`，进入 DSH 官方附件管线 |
| 开启 | 经典 P2P 负责选择、粘贴、拖放、路径 Dock、Host 存储和路径引用 | 进入经典 P2P 路径附件管线 |

这是二选一的附件所有权，不是两套系统同时竞争。接管关闭时，浏览器提供的文件会完整留给 DSH；接管开启时，经典 P2P 才拥有整套附件交互。

## 为什么项目要退役

P2P 最初坚持把两件事拆开：

```text
让文件进入会话
        ≠
理解文件内容
```

插件把文件保存在 DSH Host 上，通过路径引用交给 Agent，再由 Agent 根据实际可用的图片、文档、压缩包或文件系统工具选择读取方式。它不包装模型能力，也不把用户绑在某一个 vision 工具上。

DSH 官方现在采用了相同的核心思路，而且实现了更完整的持久化生命周期。继续默认维护第二套附件系统只会产生重复 UI、竞争 paste/drop 事件，并让生命周期能力倒退。

因此，最终正确形态是：**Native 默认，经典 P2P 仅在用户明确选择时接管。**

## 安装

```bash
dsh plugin --profile web add dsh-paste-to-path
```

然后重启：

```bash
dsh web
```

最终版本适配：

```text
DeepSeek Harness >= 0.1.5-rc.1 且 < 0.2.0
```

仍在维护旧版 DSH、需要原始通用附件补丁的用户，可以固定历史版本：

```bash
dsh plugin --profile web add dsh-paste-to-path@0.0.6
```

## 配置

在 DSH `0.1.6+` 中，打开已安装插件详情页，并配置 `paste-to-path` Loader row。在 DSH `0.1.5` 中，相同开关仍显示在旧版可配置插件设置页。

profile 默认值：

```yaml
- insert:
    - id: paste-to-path
      name: dsh-paste-to-path
      config:
        takeOverNativeAttachments: false
        longTextAsAttachment: true
        longTextThreshold: 8000
```

设置界面仍然只有两个主要选择；`longTextThreshold` 作为“长文本转附件”的子设置显示，默认值为 `8000` 个 JavaScript 字符，可以直接在插件设置页或 profile 配置中修改。

## Native 模式

接管关闭时，P2P 不处理：

- 普通文件或图片粘贴；
- 文件拖放；
- 文件选择；
- 附件卡片和预览；
- 上传、重试、持久化和 Agent 可读路径。

这些全部归 DSH Native。

当纯文本达到阈值时，插件只创建一个浏览器 `File`，再通过 DSH 官方 Conversation 附件状态机添加它。之后的上传、卡片、重试、持久化和只读路径都由 DSH 负责。

如果官方附件准入无法启动，插件不会阻止原始 paste 事件，文本仍会正常进入输入框。

## 经典 P2P 接管模式

打开接管后，会恢复历史工作流：

```text
粘贴 / 拖入 / 选择
          ↓
保存到 DSH Host
          ↓
P2P Attachment Dock + reference chip
          ↓
发送简短英文路径说明
          ↓
Agent 根据实际工具自行读取
```

经典模式仍支持任意文件、图片缩略图、限制范围内的文本编辑、Host 路径关联，以及为 [Issue #2](https://github.com/Johnny-xuan/dsh-paste-to-path/issues/2) 实现的 localhost-only Windows Explorer 剪贴板后备。

它被保留是为了用户选择和历史兼容，不再推荐新安装优先于 DSH Native 使用。

## 安全与隐私

Native 模式下，附件存储与传输完全由 DSH 官方管线负责。

经典接管模式下：

- 上传文件只保存在用户自己的 DSH Host；
- 插件路由要求通过 DSH Web 身份验证；
- 平台支持时，保存副本使用私有文件权限；
- 远程客户端不能读取 Windows Host 剪贴板；
- 首次模型请求只包含路径说明，不包含文件字节；
- 后续工具行为取决于用户自己的 Agent 工具栈。

## 项目状态

`0.0.7` 是 `dsh-paste-to-path` 的最后一个版本。仓库和历史 npm 包会继续保留，但不再计划后续版本；本项目不会再与 DSH 官方附件架构竞争，也不会继续重造未来的附件系统。

这个 workaround 之所以可以退役，是因为平台终于解决了底层问题。这是一个插件最好的结局。
