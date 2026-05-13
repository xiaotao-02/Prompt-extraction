# 图片提示词提取器 · Image Prompt Extractor

一个 Chrome 扩展：在任意网页 **右键点击图片 → 提取图片提示词**，调用视觉大模型反推出可用于 AI 绘画的高质量提示词（支持中文段落 / 英文段落 / Stable Diffusion 标签 / Midjourney 风格）。

## 特性

- **右键即用**：右键任意 `<img>`，弹出浮动结果面板
- **多模型可选**：
  - OpenAI GPT-4o / GPT-4o-mini
  - Anthropic Claude 3.5
  - Google Gemini 2.0 Flash
  - 智谱 GLM-4V（含免费 `glm-4v-flash`）
  - 通义千问 Qwen-VL-Max
  - 硅基流动 SiliconFlow（含 **DeepSeek-VL2** 等开源模型）
  - 任意 OpenAI 协议兼容的自定义端点
- **四种输出风格**：自然语言中/英文、SD tag、Midjourney
- **可编辑 + 版本历史**：浮动面板和 popup 内都能直接修改提示词，自动按版本保存，可一键恢复任一历史版本
- **对话式 AI 调整**：用一句话告诉插件"改得更电影感 / 翻译成英文 / 加 8k masterpiece"，模型会基于现有提示词重写并自动存为新版本
- **本地历史记录**：popup 弹窗内查看、复制、删除最近 100 条
- **跨设备同步配置**：通过 `chrome.storage.sync` 同步 API Key 与偏好
- **自动更新检测**：定期检查新版本，工具栏红点提示 + 桌面通知 + 一键更新
- **隐私友好**：API Key 仅保存在本地浏览器，扩展不连接任何第三方服务器

## 技术栈

- Manifest V3
- Vite 6 + @crxjs/vite-plugin
- React 18 + TypeScript
- Tailwind CSS v4
- Shadow DOM 注入页面，杜绝样式污染

## 安装与开发

> 需要 Node 18+。

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run dev

# 生产构建
npm run build

# 打包为 zip 上传 Chrome 商店
npm run zip
```

### 加载到 Chrome

1. 执行 `npm run build`，生成 `dist/` 目录
2. 打开 `chrome://extensions`
3. 右上角开启 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择 `dist/` 目录

## 使用步骤

1. 安装扩展后，点击工具栏图标 → 右上角 ⚙ 进入 **设置**
2. 选择一家模型供应商，填入 API Key（推荐先用 **智谱 `glm-4v-flash`**，免费且国内可直连）
3. 在 **联通性测试** 区点击「运行测试」，确认调用成功
4. 在任意网页 **右键图片 → 🎨 提取图片提示词**
5. 等待数秒，页面右下角弹出结果面板，点 **复制** 即可用于绘图

## 关于 DeepSeek

DeepSeek 官方 `api.deepseek.com` 的 chat / reasoner 接口 **暂不支持图像输入**。如果你想用 DeepSeek 系列做视觉识别，请：

- 在「设置」选择 **硅基流动 SiliconFlow**
- 模型选择 `deepseek-ai/deepseek-vl2`
- 到 [硅基流动控制台](https://cloud.siliconflow.cn/account/ak) 申请 Key

## 目录结构

```
src/
  background/      # service worker：右键菜单 / API 调度 / 存储
  content/         # 注入页面的 Shadow DOM 浮动面板
  popup/           # 工具栏弹窗（历史记录）
  options/         # 设置页（多模型配置）
  lib/
    api/           # 多模型 API 适配层
    providers.ts   # 模型供应商元数据
    storage.ts     # chrome.storage 封装
    image.ts       # 图片下载 + base64
    types.ts
  styles/          # Tailwind 全局样式
  manifest.config.ts
public/icons/      # 自动生成
scripts/           # 图标生成 / zip 打包
```

## 自动发布（CI）

仓库已配置 GitHub Actions（`.github/workflows/auto-release.yml`），**每次 push 到 `main` 分支都会自动发布一次新版**，流程如下：

1. 自动 bump `package.json` 中的 `version`（默认升 patch；commit 信息包含 `[minor]` 升 minor，包含 `[major]` 或 `BREAKING CHANGE` 升 major）
2. `npm run build` + `npm run zip` 生成 `dist-zip/image-prompt-extractor-vX.Y.Z.zip`
3. 把 bump 后的 `package.json` / `package-lock.json` 推回 main，并打上 `vX.Y.Z` tag
4. 创建 GitHub Release，自动从两次 release 之间的 commits 生成 release notes，并把 zip 作为附件上传

跳过发版：在 commit message 里加 `[skip release]` 即可（机器人自己产生的 `chore(release):` commit 也会被自动跳过，不会循环触发）。

> 用户那侧的扩展默认更新源就是这个仓库，因此 Release 一旦发出，所有装了插件的用户在下一次定时检查（默认 24 小时一次）或手动点「立即检查」时就会收到更新。

## 自动更新

扩展内置了一个轻量更新检查机制，**默认更新源已配置为本仓库** [`xiaotao-02/Prompt-extraction`](https://github.com/xiaotao-02/Prompt-extraction)，安装后无需手动填写即可收到 Release 更新通知。

1. 如需切换更新源，可打开 **设置 → 自动更新**，在「更新源」中填入：
   - GitHub 仓库简写：`owner/repo`（自动转换为 `https://api.github.com/repos/<owner>/<repo>/releases/latest`），或
   - 完整 GitHub 仓库地址（`https://github.com/owner/repo[.git]`，会被识别并转换为同一接口），或
   - 自定义 JSON URL，返回结构如下：
     ```json
     {
       "version": "0.2.0",
       "name": "v0.2.0",
       "downloadUrl": "https://example.com/extension.zip",
       "releaseUrl": "https://example.com/release/0.2.0",
       "releaseNotes": "更新说明",
       "publishedAt": "2026-05-13T00:00:00Z"
     }
     ```
2. 后台 service worker 通过 `chrome.alarms` 按设定频率（默认每 24 小时）请求更新源，与 manifest 中的 `version` 比较；若发现新版：
   - 工具栏图标右下角出现紫色 `NEW` 角标
   - popup 顶部显示更新横幅
   - 系统弹出桌面通知（可在设置中关掉）
3. 点击「一键更新」时：
   - 通过 **Chrome 网上应用店** 安装的扩展会调用 `chrome.runtime.requestUpdateCheck()` 触发原生更新并自动重载
   - **开发者模式**（加载 `dist/` 目录）的扩展无法被脚本覆盖，会自动打开发布页让你下载新 zip，并提示你到 `chrome://extensions` 重新加载
4. 你随时可以「忽略此版本」，下次发布更高的版本号时会再次提示。

## 常见问题

**Q：为什么有些网站的图片报"下载图片失败"？**
A：少数站点对图片做了 hotlink 防盗链或 Referer 校验。可右键"在新标签页打开图片"再重新提取。

**Q：图片太大失败？**
A：扩展内置 8MB 上限。可右键"图片另存为"压缩后，或使用图片缩略图链接。

**Q：可以批量提取吗？**
A：当前版本聚焦单张图右键体验；后续会加多选 / 当前页一键扫描功能。
