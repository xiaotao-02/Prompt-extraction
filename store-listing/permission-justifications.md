# Permission Justifications

> 表单字段对应：Privacy practices → Permission justifications。
> 每个权限在表单上是一个独立的小输入框；下方每段都已经控制在 ~1000 字符以内，可直接复制粘贴到对应字段。
> 中文与英文都准备了两个版本，建议把英文版填到"主语言"，中文版填到 zh_CN locale。

---

## 1. `contextMenus`

**EN**
The extension adds right-click items on `<img>` / `<video>` ("Add to reference" composes in the panel; "Extract prompt directly" runs extraction immediately with the same URL rules). Masked images and similar use a fallback pair with the same titles. Separately it adds "Capture region to reference" on page-like contexts when the site's menu blocks the usual image flow.

**ZH**
扩展在 `<img>` / `<video>` 上提供右键项「添加到参考」（并入面板 compose）与「直接反推提示词」（立即走视觉反推，等同面板内「生成提示词」），并在遮罩图等场景通过兜底菜单提供**同名两项**。**另在网页/帧等上下文提供「截取区域添加到参考」。**无此权限将无法在网页上完成主要工作流。

---

## 2. `storage`

**EN**
Used exclusively to persist the user's own settings on their own device:
- model provider API keys (entered by the user in the Options page)
- the user's preferred output style (natural language / SD tags / Midjourney)
- the last 100 prompt-extraction results, kept locally so the user can re-copy or restore an earlier version
No data is transmitted off-device by virtue of this permission. `chrome.storage.sync` is used so the user's API key entered on one of their machines is available on their other Chrome instances logged into the same Google account.

**ZH**
仅用于在用户自己的设备上持久化用户自己输入的内容：
- 用户在「设置」中填入的各家供应商 API Key
- 用户的输出风格偏好（中文段落 / 英文段落 / SD tag / Midjourney）
- 最近 100 条提示词结果，便于复制和按版本恢复
此权限本身不会把任何数据传到外部。`chrome.storage.sync` 仅在同一 Google 账号的多台浏览器之间加密同步用户自己的设置。

---

## 3. `scripting`

**EN**
Required for `chrome.scripting.executeScript` when the service worker must programmatically inject the same bundled content script into the active tab (for example if the tab predates the install/update, or if declarative injection did not attach). Separately, a lightweight declarative content script runs at `document_idle` on matched pages so the extension can listen for right-click preparation and handle panel messages — **this does not display the visible result UI by itself**. The Shadow-DOM floating panel is created only after the user initiates extraction (context menu or recall flow), not on every page load.

**ZH**
用于在后台需要时通过 `chrome.scripting.executeScript` 向当前标签页**程序化注入**与 manifest 相同的内容脚本（例如页面在扩展安装/更新前就打开、或声明式注入未附着等兜底场景）。与此同时，匹配站点在 `document_idle` 会加载**轻量**声明式内容脚本，用于右键探测与面板消息 —— **仅凭脚本加载不会在页面上展示结果界面**。半透明结果浮动面板仅在用户发起「添加到参考」、面板内反推或从库中召回到页面等操作后才创建，而非每次打开网页就自动出现。

---

## 4. `activeTab`

**EN**
Works with `scripting` so tab-scoped work follows Chrome's pattern for responding to explicit user gestures. It also gates `chrome.tabs.captureVisibleTab`: when you start rectangle capture from the toolbar popup / shortcut / extension context menu item, the service worker snaps the visible area of **that tab only**, crops your selection locally, forwards it as JPEG to the floating panel pipeline, then discards the full snapshot (`activeTab`-aligned behavior).

**ZH**
与 `scripting` 配合，使程序化注入等行为符合 Chrome 所要求的「在用户显式手势所及的标签页上工作」模式。**同时，`activeTab` 也用于授权 `chrome.tabs.captureVisibleTab`**：当你从扩展工具栏弹窗、快捷键或页面右键扩展菜单触发「截取区域」时，后台仅对当前活动网页标签页截取可见区画面、在用户框选的矩形本地裁剪为小尺寸 JPEG、`PANEL_APPEND_REFERENCE` 后立即丢弃整张快照大图，不向无关标签页或未参与交互的标签页偷拍。

---

## 5. `clipboardWrite`

**EN**
Used only by explicit "Copy" actions: the result panel, toolbar popup, and Settings/Prompt Library copy buttons write generated or selected prompt text so the user can paste it elsewhere. The clipboard is never modified without a direct user click.

**ZH**
仅用于用户明确点击「复制」时：结果面板、工具栏弹窗，以及设置/提示词库中的复制按钮，将生成或选中的提示词写入剪贴板。**不会在无用户点击的情况下静默写入**。

---

## 6. `clipboardRead`

**EN**
Used only in the Options "Setup guide": when the user clicks the control to paste a JSON configuration from the clipboard into the import field. The extension does not read the clipboard in the background or on web pages.

**ZH**
仅在「设置 → 配置指南」中，当用户点击「**从剪贴板粘贴**」时读取剪贴板文本以填入 JSON 配置导入框。扩展**不会在后台静默读取**，也不会在普通网页上下文中读取剪贴板。

---

## 7. Host permission `<all_urls>`

**EN**
The extension's core promise is "right-click the image you are looking at". Because users may be on any website, the context menu and in-page UI must work on arbitrary origins. A lightweight content script loads with the page (`document_idle`) to support right-click detection and messaging; **loading that script does not send page data anywhere**. The extension does NOT bulk-scrape DOM, cookies, or browsing history.

On user action only, it:
- resolves the URL or pixels for the specific media under the user's click
- fetches that one image resource and sends it only to the vision-LLM endpoint configured in Options

No narrower host pattern covers "every site where a user might right‑click an image"; `<all_urls>` is therefore the minimum viable match list for this product.

**ZH**
扩展承诺在任意站点上「右键当前所看的图」都能用，因此右键入口与页内能力必须覆盖任意来源。声明式内容脚本随页面在 `document_idle` **轻量加载**，用于右键探测与消息通道 —— **仅加载脚本不等于上传或扫描网页内容**。扩展**不会**批量采集 DOM、Cookie 或浏览历史。

仅在用户操作后：
- 解析用户所点位置对应的那一张图 / 媒体的 URL 或像素
- 仅下载这一份资源并发送到用户在「设置」中选定的视觉模型端点

没有更窄的 URL 模式能覆盖「用户可能在任意网站右键图片」；故 `<all_urls>` 是该产品形态下最小可行的主机权限。

---

## 8. Remote code

**No remote code is loaded or executed.** The extension does not use `eval`, `new Function`, dynamic `import()` of remote URLs, or `<script>` tags pointing to remote origins. All JavaScript executed by the extension is the JavaScript shipped inside the .crx itself, generated by Vite from the source tree.
