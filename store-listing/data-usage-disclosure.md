# Data usage disclosure（数据用途披露表填写指引）

> Chrome Web Store 后台「Privacy practices → User data」表单，需要勾选数据类别 + 勾选用途 + 三条声明。
> 下面是**针对本扩展**的标准答案，照填即可一遍过审。

---

## I collect or use the following user data

按 Chrome Web Store 表单的分类，**勾选**以下两项，**不要**勾其他：

- [x] **Authentication information**
  - 解释：用户在 Options 页中输入的各家模型供应商 API Key。
  - 用途：仅用于发送给用户在 Options 页中亲自选定的那家供应商，以授权 API 调用。

- [x] **Personal communications**
  - 解释：用户在「对话式调整」中输入的自然语言指令（例如"翻译成英文"），以及反推得到的提示词文本。
  - 用途：作为模型的 prompt 的一部分，发送给用户选定的供应商。

- [x] **Web content**（注意：这里勾选的是"用户**自己右键的那一张图片**"这种"用户主动指向的网页内容"，而不是"页面其他内容"）
  - 解释：用户主动右键并选择菜单项后，扩展会读取该图片 / 视频元素的 URL，下载这一份资源，并发送给用户选定的视觉模型供应商。

**不要**勾选以下项（确保和实际行为一致）：

- [ ] Personally identifiable information
- [ ] Health information
- [ ] Financial and payment information
- [ ] Location
- [ ] User activity（浏览记录、点击轨迹）
- [ ] Website content（"页面整体内容"含义；本扩展只读用户右键的那一个元素，不读其他 DOM）

> 备注：Chrome 表单里 "Web content" 与 "Website content" 是同一项（取决于 UI 版本），勾上即可。

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
