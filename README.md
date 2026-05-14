# Prompt Extracto

一个 Chrome 扩展：在任意网页 **右键点击图片 / 动图 / 视频 → 提取提示词**，调用视觉大模型反推出可用于 AI 绘画的高质量提示词（支持中文段落 / 英文段落 / Stable Diffusion 标签 / Midjourney 风格）。

## 特性

- **右键即用**：右键任意 `<img>` / `<video>` / `<canvas>` / 内联 SVG / CSS 背景图都能识别
- **动图与视频原生支持**：
  - GIF / APNG / 动画 WebP 自动**扁平化为静态首帧**再送给视觉模型，避免"只看首帧拒收"或动图无法解析的常见失败
  - `<video>` 元素（含 Twitter / Reddit / Discord 把 GIF 转成的 mp4 假 GIF）通过 canvas 抓取**当前播放帧**为 JPEG 后再送给模型
  - canvas、内联 SVG、CSS `background-image` / `mask-image` 也都能识别
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
- **手动检查更新**：在「设置 → 检查更新」面板里一键比对最新 GitHub Release，提示是否有新版可下载
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

#### 方式 A：一键脚本（推荐）

```bash
# Windows / macOS / Linux 通用
npm run install:chrome

# 或者使用 Edge
npm run install:edge
```

> Windows 用户也可以直接 **双击仓库根目录的 `install.bat`**，第一次会自动 `npm install` + `npm run build` + 启动 Chrome 并加载扩展，无需手动操作 `chrome://extensions`。

脚本会自动：

1. 检测 / 自动构建 `dist/`（没有就跑一次 `npm run build`）
2. 自动定位本机 Chrome / Edge 可执行文件（找不到时可通过 `CHROME_PATH` 环境变量手动指定）
3. 用一个**项目独立的 profile**（`.chrome-dev-profile/`）启动浏览器，并通过 `--load-extension=<dist 绝对路径>` 在启动时直接加载本扩展
4. 顺便把 `chrome://extensions/` 打开给你确认

可选参数：

| 参数 | 说明 |
| --- | --- |
| `--build` | 启动前强制重新构建（默认仅在 `dist/` 不存在时构建） |
| `--browser=edge` | 使用 Microsoft Edge 而不是 Chrome |
| `--use-default-profile` | 使用你的系统默认 Chrome profile（**需要先彻底关闭 Chrome**，否则参数会被忽略） |

> 为什么默认用独立 profile？因为如果你已经在用主 Chrome，再传 `--load-extension` 给同一个 profile 会被现有进程吞掉、不生效。独立 profile 既保证一键稳定加载，又不会污染你日常浏览器；这个 profile 会被复用，登录态/扩展配置都会沉淀在 `.chrome-dev-profile/`。

#### 方式 B：手动加载（传统方式）

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

## 上架 Chrome Web Store

整套上架流程（zip 校验、商店素材、隐私政策、CI 自动发版）已经定制好，**一次性 30 分钟可走完**：

```bash
# 1) 生成上架专用 zip（开启 minify、关 sourcemap、合规校验、SHA256）
npm run release:store
# 输出：dist-zip/store/prompt-extracto-store-vX.Y.Z.zip

# 2) 生成 2 张宣传图（440×280 + 1400×560）
npm run store:assets

# 3) 生成 5 张商品截图（1280×800 ×5）
npm run store:screenshots
```

| 想要做的事 | 看这个文件 |
|---|---|
| 上架前逐项打勾 | [`store-listing/CHECKLIST.md`](store-listing/CHECKLIST.md) |
| 商店表单填什么（中英双语） | [`store-listing/`](store-listing/) |
| 隐私政策（提交时填的 URL） | [`PRIVACY.md`](PRIVACY.md) → `https://raw.githubusercontent.com/xiaotao-02/Prompt-extraction/main/PRIVACY.md` |
| CI 自动发版（推 tag 自动上架） | [`docs/CHROME_WEB_STORE_CI.md`](docs/CHROME_WEB_STORE_CI.md) + [`.github/workflows/publish-chrome-store.yml`](.github/workflows/publish-chrome-store.yml) |

## 自动发布（CI）

仓库已配置 GitHub Actions（`.github/workflows/auto-release.yml`），**每次 push 到 `main` 分支都会自动发布一次新版**，流程如下：

1. 自动 bump `package.json` 中的 `version`（默认升 patch；commit 信息包含 `[minor]` 升 minor，包含 `[major]` 或 `BREAKING CHANGE` 升 major）
2. `npm run build` + `npm run zip` 生成 `dist-zip/prompt-extracto-vX.Y.Z.zip`
3. 把 bump 后的 `package.json` / `package-lock.json` 推回 main，并打上 `vX.Y.Z` tag
4. 创建 GitHub Release，自动从两次 release 之间的 commits 生成 release notes，并把 zip 作为附件上传

跳过发版：在 commit message 里加 `[skip release]` 即可（机器人自己产生的 `chore(release):` commit 也会被自动跳过，不会循环触发）。

> 用户那侧的扩展默认更新源就是这个仓库，因此 Release 一旦发出，所有装了插件的用户在「设置 → 检查更新」中点一下「立即检查更新」即可收到提示。

## 检查更新

扩展内置一个**手动**的更新检查面板，更新源固定为本仓库 [`xiaotao-02/Prompt-extraction`](https://github.com/xiaotao-02/Prompt-extraction) 的最新 Release。

- 打开 **设置 → 检查更新**，点击「立即检查更新」即可向 GitHub Releases API 拉取最新版本，并与当前扩展的 `version` 比较。
- 检测结果会直接展示在面板上：当前版本号、最近一次检查时间，以及（若有新版本）发布说明与「前往发布页」链接。
- 没有定时任务、桌面通知或工具栏角标，更新动作完全由用户主动触发；下载新版本后到 `chrome://extensions` 重新加载即可。

## 常见问题

**Q：为什么有些网站的图片报"下载图片失败"？**
A：少数站点对图片做了 hotlink 防盗链或 Referer 校验。可右键"在新标签页打开图片"再重新提取。

**Q：图片太大失败？**
A：扩展内置 8MB 上限。动图 / 视频帧已经在送出前自动缩到最长边 1280~1536px，一般不会触发；如果是超大原图，可右键"图片另存为"压缩后再处理。

**Q：右键视频菜单点不动，或者视频帧抓不到？**
A：少数情况下视频元素是跨域且没有 `crossorigin="anonymous"`，canvas 会被污染、无法导出帧；这种站点目前抓不到帧。建议把视频暂停在想要识别的画面后再右键。

**Q：Twitter / X 的 GIF 没反应？**
A：这些"GIF"其实是 `<video>`，请在视频画面上**直接右键**，菜单文案会是"提取视频帧 / 动图提示词"。如果是站点自己劫持了右键（比如某些图片站），可以在视频上单击暂停后再右键。

**Q：可以批量提取吗？**
A：当前版本聚焦单张图右键体验；后续会加多选 / 当前页一键扫描功能。
