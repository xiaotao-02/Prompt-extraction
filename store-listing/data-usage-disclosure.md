# Data usage disclosure（数据用途披露表填写指引）

> Chrome Web Store 后台「Privacy practices → User data」表单，需要勾选数据类别 + 勾选用途 + 三条声明。
> 下面是**针对本扩展**的标准答案，照填即可一遍过审。

---

## I collect or use the following user data

按 Chrome Web Store 表单的分类，**勾选**以下**三项**（与控制台中的 **Authentication information**、**Personal communications**、**Web content** / **Website content** 等名称对应），**不要**勾其他与下表不一致的类别：

- [x] **Authentication information**
  - 解释：用户在 Options 页中输入的各家模型供应商 API Key。
  - 用途：仅用于发送给用户在 Options 页中亲自选定的那家供应商，以授权 API 调用。

- [x] **Personal communications**
  - 解释：用户在「对话式调整」中输入的自然语言指令（例如"翻译成英文"），以及反推得到的提示词文本。
  - 用途：作为模型的 prompt 的一部分，发送给用户选定的供应商。

- [x] **Web content**（若后台仅显示 **Website content**，选与「用户主动指向的网页媒体」对应的那一项；勿选「整页/站点级内容」语义）
  - 解释：用户右键并选择菜单项后，扩展仅针对**该次操作所指向的那一张图 / 一段视频相关资源**（URL 或像素），下载这一份并发送给用户选定的视觉模型供应商。**不**采集整页 HTML、全文或站点爬虫式内容。

**不要**勾选以下项（确保和实际行为一致）：

- [ ] Personally identifiable information
- [ ] Health information
- [ ] Financial and payment information
- [ ] Location
- [ ] User activity（浏览记录、点击轨迹）
- [ ] 任何表示「收集整站或整页浏览内容 / 非用户单次指向的媒体」之类、与本扩展不符的类别（若与 **Web content**/**Website content** 在表单中合并为同一勾选项，则只勾上一节中说明的那一项，不要额外勾成「整站内容」）

> **与代码对齐**：`clipboardRead` 仅在设置页用户点击「从剪贴板粘贴」时读取剪贴板，用于本地配置导入，不向开发者服务器上传；商店「User data」分类通常无需单独为剪贴板再勾一类 —— 以 Dev Console 当前列表为准；若出现明确的 **Clipboard** 类且要求声明，补充一句「仅用户主动触发的设置导入，不上传」即可。

---

## I certify the following

把后台底部的三条 certification 全部勾上：

- [x] **I do not sell or transfer user data to third parties, outside of the approved use cases**
- [x] **I do not use or transfer user data for purposes that are unrelated to my item's single purpose**
- [x] **I do not use or transfer user data to determine creditworthiness or for lending purposes**

---

## "Approved use cases" 解释（可填到 Justification 文本框中）

**EN**
The extension transmits the user's API key, the image they right-click, the prompt result, and any conversational refine instruction **only to the single vision-LLM endpoint that the user has chosen in the Options page** (e.g. https://api.openai.com/v1, https://api.anthropic.com/v1, https://generativelanguage.googleapis.com/v1beta, https://api.siliconflow.cn/v1, https://open.bigmodel.cn/api/paas/v4, https://dashscope.aliyuncs.com/compatible-mode/v1, or a user-supplied custom OpenAI-compatible endpoint). This transmission is required for the extension's single purpose — turning an image into an AI-painting prompt — and the destination is fully controlled by the user. The extension developer operates no backend and never receives any of this data.

The only additional outbound traffic is an anonymous `GET https://api.github.com/repos/xiaotao-02/Prompt-extraction/releases/latest` issued **only when the user clicks the "Check for updates" button** in Options.

**ZH**
扩展会把"用户的 API Key、用户主动右键的那张图、模型返回的提示词文本、用户在对话式调整中输入的指令"**仅发送到用户在 Options 页面中亲自选定的那一个视觉模型端点**（例如 OpenAI、Anthropic、Gemini、智谱、阿里 Qwen、SiliconFlow、数科隆达，或用户自填的自定义 OpenAI 兼容端点）。这一传输是扩展核心用途"图片 → 提示词"所必需的，且目标地址完全由用户掌握。扩展开发者本身不运营任何后端，也永远收不到这些数据。

唯一的额外外部请求是：用户**主动点击「检查更新」按钮时**，向 `https://api.github.com/repos/xiaotao-02/Prompt-extraction/releases/latest` 发起一次匿名 GET 请求，仅读取版本号与 release notes。
