# Privacy Policy / 隐私政策

> 适用产品 / Applies to: **Prompt Extracto** Chrome 浏览器扩展
> 最近更新 / Last updated: 2026-05-15
> 联系方式 / Contact: xiaotao666.1@gmail.com

---

## 中文版

### 一、我们是谁

Prompt Extracto 是一个开源 Chrome 浏览器扩展，源代码与构建产物公开发布在 GitHub 仓库
[xiaotao-02/Prompt-extraction](https://github.com/xiaotao-02/Prompt-extraction) 。
本扩展由独立开发者 xiaotao-02 维护，**不归属于任何商业公司**，**不存在任何后端服务器**。

### 二、我们处理哪些数据，为什么处理

| 数据类别 | 是否收集 | 处理目的 | 存储位置 | 是否离开你的设备 |
|---|---|---|---|---|
| 模型 API Key（OpenAI / Anthropic / Gemini / 智谱 / Qwen / SiliconFlow / 数科隆达 / 自定义端点） | 是 | 调用对应供应商的视觉大模型完成"提示词反推" | `chrome.storage.sync`（由浏览器加密同步至同一 Google 账号） | 仅以 `Authorization` / `x-api-key` / 查询参数形式发送给**你在设置页中亲自选择的那一家供应商**；扩展开发者本身收不到 |
| 你右键的图片内容（含动图首帧 / 视频当前帧抓取后的 JPEG） | 是 | 作为视觉模型的输入 | 内存中临时存在，不写入磁盘 | 仅发送给你在设置页中亲自选择的那一家供应商 |
| 你在当前网页上拖拽选取矩形后的**可见视口截图**（由扩展裁剪成小尺寸 JPEG） | 是 | 当你的站点劫持原生右键、无法走「右键→添加到参考」时，作为替代的参考图来源；随后在面板中与图片链路透传到同一供应商 | 内存中短暂存在，`tabs.captureVisibleTab` 整张快照经裁剪后即丢弃大图 | **仅当您通过工具栏弹窗、快捷键、或页面右键菜单主动发起区域截取**时才发生；裁剪结果仅发送给您选择的那一家视觉模型供应商 |
| 提示词结果与版本历史 | 是 | 在浮动面板和工具栏弹窗中展示、可复制、可恢复历史版本 | `chrome.storage.local`（仅本地） | 否 |
| 用户在"对话式调整"中输入的指令 | 是 | 作为模型的 prompt 一部分 | 内存中临时存在 | 仅发送给你选择的供应商 |
| 偏好设置（输出风格、语言、活跃供应商等） | 是 | 用户体验持久化 | `chrome.storage.sync` | 否（仅在你登录的同一 Google 账号的浏览器之间同步） |
| 任何形式的"匿名遥测 / 埋点 / 崩溃上报 / 用户行为分析" | **否** | — | — | — |

### 三、数据流向（必须明确披露）

本扩展**不存在自有后端**。当你触发"提取提示词"时，数据流如下：

```
你的浏览器
  ↓  HTTPS 直连
你在设置页中选择的"那一家"模型供应商（例如 https://api.openai.com/v1）
```

**扩展开发者无法看到任何 API 调用、图片、提示词结果、API Key。** 一切传输由 Chrome 浏览器自身完成，端点 URL 完全由用户在「设置」页面控制（包括用户输入的"自定义 OpenAI 兼容端点"）。

各官方供应商的隐私政策：

- OpenAI: <https://openai.com/policies/privacy-policy/>
- Anthropic: <https://www.anthropic.com/legal/privacy>
- Google (Gemini): <https://policies.google.com/privacy>
- 智谱 AI: <https://open.bigmodel.cn/dev/api/protocol/serviceagreement>
- 阿里云百炼 (Qwen): <https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-privacy-policy>
- SiliconFlow 硅基流动: <https://siliconflow.cn/zh-cn/privacy-policy>
- 数科隆达：以该网关运营方公开的隐私条款为准，使用前请自行评估
- 自定义端点：由用户自行承担披露责任

### 四、我们额外的"网络请求"

为了支持「设置 → 检查更新」功能，扩展会在**用户主动点击该按钮时**向以下 GitHub 公开 API 发起一次匿名 HTTPS 请求：

```
GET https://api.github.com/repos/xiaotao-02/Prompt-extraction/releases/latest
```

仅读取最新版本号与 release notes，不携带任何 API Key、图片或个人信息。

### 五、权限说明

| 权限 | 用途 |
|---|---|
| `contextMenus` | 在你右键图片 / 视频 / 动图时显示「添加到参考」「直接反推提示词」；在正常页面上下文还提供「截取区域添加到参考」（适用于自定义右键的站点）；「直接反推」或面板内点击「生成提示词」后再调用模型 |
| `storage` | 本地保存 API Key、偏好、历史记录 |
| `scripting` + `activeTab` | 在需要时由后台向当前标签页程序化注入扩展内容脚本（例如兜底注入）；声明式脚本随页面轻量加载，用于右键探测与消息。**`activeTab` 亦用于在用户从弹窗快捷键/菜单发起的流程中截取当前标签页可视区域快照并裁剪**。可见的结果浮动面板仅在用户发起「添加到参考」「区域截取」或面板内反推等操作后出现 |
| `clipboardWrite` | 你点「复制」时把提示词等文本写入剪贴板（含面板、弹窗、设置/库中的复制操作） |
| `clipboardRead` | 仅在「设置 → 配置指南」中，当你点击「从剪贴板粘贴」时读取剪贴板文本；**不会在后台或网页里静默读取** |
| `host_permissions: <all_urls>` | 支持在任意站点使用右键与页内能力；声明式脚本随页加载仅用于监听与消息，**不会像爬虫一样上传整页内容**；仅在您操作后才会读取/发送您所指的那一张图相关的数据 |

### 六、儿童隐私

本扩展不面向 13 岁以下儿童，也不会刻意收集任何儿童个人信息。

### 七、数据删除

- 删除所有本地数据：在 Chrome 中卸载扩展即可。
- 删除同步数据：卸载扩展并到 [chrome://settings/syncSetup](chrome://settings/syncSetup) 中清空"扩展程序"的同步项。

### 八、变更通知

本政策的任何修改都会以 commit 形式更新本文件，并在 GitHub Release notes 中标注。重大变更会在扩展内通过提示告知。

### 九、联系我们

任何隐私相关问题，请发送邮件至 **xiaotao666.1@gmail.com** 或在 GitHub 仓库 [xiaotao-02/Prompt-extraction](https://github.com/xiaotao-02/Prompt-extraction) 提 issue。

---

## English Version

### 1. Who we are

Prompt Extracto is an open-source Chrome browser extension. Source code and release artifacts are publicly available at
[xiaotao-02/Prompt-extraction](https://github.com/xiaotao-02/Prompt-extraction).
The extension is maintained by an independent developer, xiaotao-02. **There is no commercial entity behind it and no backend server is operated by the developer.**

### 2. What data we handle and why

| Data | Collected? | Purpose | Storage | Leaves your device? |
|---|---|---|---|---|
| Model API key (OpenAI / Anthropic / Gemini / Zhipu / Qwen / SiliconFlow / Shukelongda / custom endpoint) | Yes | Authenticate calls to the visual model provider you choose to perform "prompt reverse-extraction" | `chrome.storage.sync` (encrypted by Chrome and synced to your Google account) | Only sent — as `Authorization` / `x-api-key` / query parameter — to the **single provider you selected** in the options page. The extension developer never receives it |
| The image you right-click (including the first frame of GIF/APNG/animated WebP and the current frame of `<video>`, captured to JPEG) | Yes | Input to the visual model | In-memory only, not written to disk | Sent only to the provider you selected |
| A **JPEG crop of the visible tab** from the rectangle you drag (full-tab snapshot captured then cropped/discarded immediately) | Yes | Fallback reference image when sites replace the native context menu — same pipeline afterward | Held briefly in memory; the full snapshot is cropped and not retained once processed | Only when **you explicitly start region capture** (toolbar popup, shortcut, or page context menu item); cropped pixels are sent only to the vision provider you selected |
| Generated prompts and version history | Yes | Displayed in the in-page panel and toolbar popup, copy/restore by user | `chrome.storage.local` (local only) | No |
| Your text instructions in "conversational refine" | Yes | Part of the prompt sent to the model | In-memory only | Sent only to the provider you selected |
| Preferences (output style, language, active provider, etc.) | Yes | Persist user preferences | `chrome.storage.sync` | No (only synced across browsers logged into the same Google account) |
| Any form of telemetry, analytics, crash reports, or behavior tracking | **No** | — | — | — |

### 3. Data flow (full disclosure required by Chrome Web Store)

The extension has **no backend of its own**. When you trigger "Extract Prompt", the data flow is:

```
Your browser
  ↓  HTTPS direct
The provider you chose in the Options page (e.g. https://api.openai.com/v1)
```

**The extension developer cannot see any API call, image, prompt result, or API key.** All traffic is performed by Chrome itself, and endpoint URLs are fully controlled by you (including any "custom OpenAI-compatible endpoint" you enter).

Privacy policies of the supported providers:

- OpenAI: <https://openai.com/policies/privacy-policy/>
- Anthropic: <https://www.anthropic.com/legal/privacy>
- Google (Gemini): <https://policies.google.com/privacy>
- Zhipu AI: <https://open.bigmodel.cn/dev/api/protocol/serviceagreement>
- Alibaba Cloud Bailian (Qwen): <https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-privacy-policy>
- SiliconFlow: <https://siliconflow.cn/zh-cn/privacy-policy>
- Shukelongda: refer to the gateway operator's published policy; evaluate before use.
- Custom endpoint: disclosure is the responsibility of the user.

### 4. Additional outbound traffic

To support the "Settings → Check for updates" feature, the extension makes a single anonymous HTTPS request to the following GitHub public API **only when you click the button**:

```
GET https://api.github.com/repos/xiaotao-02/Prompt-extraction/releases/latest
```

It reads only the latest version number and release notes. No API key, image, or personal data is sent.

### 5. Permission justifications

| Permission | Purpose |
|---|---|
| `contextMenus` | Adds **“Add to reference”** and **“Extract prompt directly”** on `<img>/<video>` with masked-image fallback entries; adds **“Capture region to reference”** on generic page contexts |
| `storage` | Save API keys, preferences and history locally |
| `scripting` + `activeTab` | Fallback programmatic injection plus a declarative lightweight content script at `document_idle`; **`activeTab` also allows `captureVisibleTab` for the rectangle-screenshot flow you start from the toolbar popup/hotkey**. The floating result panel appears only after you initiate an action |
| `clipboardWrite` | Write prompts or selected text to the clipboard when the user clicks a copy control (panel, popup, options / library) |
| `clipboardRead` | Read clipboard text only when the user explicitly asks to paste a JSON configuration from the clipboard in Settings → Setup guide |
| `host_permissions: <all_urls>` | The user may use the extension on any website; content scripts may load with the page for listeners/messaging, but page-wide scraping or non-targeted upload is not performed |

### 6. Children's privacy

The extension is not directed to children under 13 and does not knowingly collect personal data from children.

### 7. Data deletion

- Local data: uninstall the extension in Chrome.
- Synced data: uninstall the extension and clear "Extensions" sync at [chrome://settings/syncSetup](chrome://settings/syncSetup).

### 8. Changes

Any change to this policy will be committed to this file and noted in the corresponding GitHub Release notes. Material changes will additionally be surfaced inside the extension UI.

### 9. Contact

For any privacy-related questions, email **xiaotao666.1@gmail.com** or open an issue at [xiaotao-02/Prompt-extraction](https://github.com/xiaotao-02/Prompt-extraction).
