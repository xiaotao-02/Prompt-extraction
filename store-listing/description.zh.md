**Prompt Extracto** 让你在任意网页上「右键图片 → 一键反推 AI 绘画提示词」。
不论是 PNG / JPEG、动图 GIF / APNG / 动画 WebP，还是嵌在 Twitter、Reddit、Discord 上的"假 GIF"视频元素，都能识别。

━━━━━━━━━━━━━━━━━━━━━━
✦ 主要特性
━━━━━━━━━━━━━━━━━━━━━━

▸ **右键即用**：右键任意 <img> / <video> / <canvas> / 内联 SVG / CSS 背景图都能识别
▸ **动图与视频原生支持**：
  • GIF / APNG / 动画 WebP 自动扁平化为静态首帧再送给视觉模型
  • <video> 元素（含 Twitter / Reddit / Discord 把 GIF 转成的 mp4 假 GIF）通过 canvas 抓取当前播放帧
  • Canvas、内联 SVG、CSS background-image / mask-image 也都能识别
▸ **多模型可选**（在「设置」中自行选择）：
  • OpenAI GPT-4o / GPT-4o-mini
  • Anthropic Claude 3.5
  • Google Gemini 2.0 Flash
  • 智谱 GLM-4V（含免费的 glm-4v-flash）
  • 通义千问 Qwen-VL-Max
  • 硅基流动 SiliconFlow（含 DeepSeek-VL2 等开源模型）
  • 任意 OpenAI 协议兼容的自定义端点
▸ **四种输出风格**：自然语言中文段落 / 英文段落 / Stable Diffusion tag / Midjourney 风格
▸ **可编辑 + 版本历史**：浮动面板和 popup 内都能直接修改提示词，自动按版本保存，可一键恢复任一历史版本
▸ **对话式 AI 调整**：用一句话告诉插件"改得更电影感 / 翻译成英文 / 加 8k masterpiece"，模型会基于现有提示词重写并自动存为新版本
▸ **本地历史记录**：popup 弹窗内查看、复制、删除最近 100 条
▸ **跨设备同步**：通过 Chrome 自带的 storage.sync 同步 API Key 与偏好

━━━━━━━━━━━━━━━━━━━━━━
✦ 使用三步走
━━━━━━━━━━━━━━━━━━━━━━

1. 安装后点击工具栏图标 → 右上角 ⚙ 进入「设置」
2. 选择一家模型供应商，填入你自己的 API Key
   （推荐先用智谱 glm-4v-flash，免费且国内可直连）
3. 在任意网页右键图片 → 「提取图片提示词」，等待数秒，
   页面右下角弹出结果面板，点「复制」即可粘贴到你的 AI 绘画工具

━━━━━━━━━━━━━━━━━━━━━━
✦ 隐私与数据传输（请务必阅读）
━━━━━━━━━━━━━━━━━━━━━━

✓ 本扩展不存在任何属于开发者的后端服务器，不收集任何遥测数据
✓ 你的 API Key 仅保存在本地浏览器（chrome.storage），并通过 Chrome 自带的同步机制在你的同一 Google 账号设备间加密同步
✓ 你右键的图片只在你点击菜单后才会被发送，且**只发送给你在「设置」中亲自选择的那一家模型供应商**
✓ 完整隐私政策：https://raw.githubusercontent.com/xiaotao-02/Prompt-extraction/main/PRIVACY.md

━━━━━━━━━━━━━━━━━━━━━━
✦ 开源
━━━━━━━━━━━━━━━━━━━━━━

源码 100% 开源（MIT 协议）：
https://github.com/xiaotao-02/Prompt-extraction

欢迎在 GitHub 提 issue / PR。

━━━━━━━━━━━━━━━━━━━━━━
✦ 常见问题
━━━━━━━━━━━━━━━━━━━━━━

Q：为什么部分网站图片报"下载图片失败"？
A：少数站点对图片做了 Referer 防盗链。可右键"在新标签页打开图片"再重新提取。

Q：图片太大失败？
A：扩展内置 8MB 上限，动图 / 视频帧已经在送出前自动缩到最长边 1280~1536px。

Q：Twitter / X 的 GIF 没反应？
A：这些"GIF"其实是 <video> 元素，请直接在视频画面上右键，菜单文案会是"提取视频帧 / 动图提示词"。

Q：DeepSeek 能用吗？
A：DeepSeek 官方 chat 接口暂不支持图像输入。请改选「硅基流动 SiliconFlow」+ 模型 deepseek-ai/deepseek-vl2。
