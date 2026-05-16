---
name: 商店上架后续步骤
overview: 你已手工上架并通过审核；若启用 Actions 自动发商店，仍按 docs/CHROME_WEB_STORE_CI 完成 GCP OAuth + GitHub Secrets + workflow 验证。可选使用本机全局包 @jackwener/opencli（opencli.cmd）导出当前浏览器页或通过终端运行 opencli browser，便于逐步向导；会话中禁止粘贴明文 CLIENT_SECRET、refresh_token 或 GitHub PAT。
todos:
  - id: decide-ci
    content: 选择是否启用 GitHub Actions 自动上架（路线 A vs B）
    status: completed
  - id: gcp-oauth
    content: 若选路线 A：GCP 启用 Chrome Web Store API + Desktop OAuth + Test users
    status: completed
  - id: refresh-token
    content: 若选路线 A：本机 npx chrome-webstore-upload-keys 拿 refresh_token
    status: completed
  - id: github-secrets
    content: 若选路线 A：配置 CWS_EXTENSION_ID（见商店列表 URL）及 CLIENT_ID/SECRET/REFRESH_TOKEN
    status: completed
  - id: workflow-verify
    content: 若选路线 A：Actions 先 dry_run，再 trustedTesters，最后正式 tag 发布
    status: completed
isProject: false
---

# 扩展已上架后的后续安排

你已完成的里程碑对应 [docs/CHROME_WEB_STORE_CI.md](docs/CHROME_WEB_STORE_CI.md) **第 0 节**：扩展已在 [Chrome Web Store 列表页](https://chromewebstore.google.com/detail/prompt-extracto/oaanodmbndnpeohmfoedgmfleabhdmkg?hl=zh-CN) 存在且通过审核。请将列表 URL **末尾连续的 32 位小写字母**作为 **EXTENSION_ID** 写入 GitHub Secret `CWS_EXTENSION_ID`（不要在仓库源码中再抄写一遍）。

---

## 路线 A：希望以后 `git push --tags` 自动发商店（推荐与文档一致）

按 [docs/CHROME_WEB_STORE_CI.md](docs/CHROME_WEB_STORE_CI.md) **第 1–3 节**一次性做完即可：

1. **Google Cloud**
   - 新建项目 → 启用 **Chrome Web Store API**。
   - 配置 OAuth 同意屏幕：External、`Testing`、把**将来用于授权的商店开发者账号**加入 **Test users**（文档强调勿随意 Publish OAuth 应用）。
   - 创建 **Desktop app** OAuth 客户端，记下 `CLIENT_ID` / `CLIENT_SECRET`。

2. **获取 REFRESH_TOKEN**
   - 文档推荐本机运行：`npx -y chrome-webstore-upload-keys`，用商店开发者账号完成授权。
   - 将得到的 `refresh_token` **只**放入 GitHub Secrets（勿提交仓库）；注意文档里提到的 **refresh_token 会过期**（约 6 个月级），需轮换时重复此步并更新 Secret。

3. **GitHub Secrets（仓库 → Settings → Secrets and variables → Actions）**
   - `CWS_EXTENSION_ID` = 同上列表 URL 末尾 32 位扩展 ID
   - `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN` = 上两步所得

4. **验证 Workflow**
   - Actions 里打开 **Publish to Chrome Web Store**（对应 [.github/workflows/publish-chrome-store.yml](.github/workflows/publish-chrome-store.yml)）。
   - 先 `dry_run = true` 确认能打出 `chrome-store-zip` 且 zip 可在 `chrome://extensions` 加载。
   - 再 `dry_run = false` 且 `target = trustedTesters`（若有测试组）做**非公开**试发。
   - 与文档 **第 4 节**一致：若启用 [auto-release.yml](.github/workflows/auto-release.yml)，向 `main` 推送后的自动 tag 会触发 `publish-chrome-store`；也可在 Actions 里手动跑、或临时 disable 商店 workflow 只发 GitHub Release。

---

## （可选）用 OpenCLI 识别当前浏览器页、按需向导

你已安装的 CLI 对应 npm 包 **[@jackwener/opencli](https://www.npmjs.com/package/@jackwener/opencli)**（描述为 *Make any website or Electron App your CLI*）。它通过 **Chrome 里的 Browser Bridge 扩展 + 本机 daemon** 连接你已登录的标签页——适合把「GCP / GitHub 页面上到底有什么按钮、表单叫什么」转成**结构化快照**给我读，我告诉你下一步该点什么、每项填什么语义（不改变：OAuth、Secret、`refresh_token` 仍必须由你的帐号生成）。

### 使用前检查

1. 按官方 README：[安装 Browser Bridge 扩展](https://github.com/jackwener/opencli/releases) → `chrome://extensions` → 加载未打包扩展。
2. 终端执行 **`opencli doctor`**，确认与浏览器连通。
3. 任选其一：
   - **在 Cursor 里装 skill**（文档推荐）：例如 `npx skills add jackwener/opencli --skill opencli-browser`（或整包）。之后你在对话里让我 **在你本机执行** `opencli browser …`（你点运行批准），由我根据终端快照逐步指导。**注意**：我仍无法替你完成 Google 2FA/Captcha——只能读写「页面上已有的控件与文案」。
   - **你手动跑 CLI**：对应当前置顶标签页执行 README 所列的 **`opencli browser`** 子命令（如 **`state`**、**`screenshot`**、**`find`**；以本机 **`opencli browser --help`** 为准），把输出**脱敏后**粘贴到聊天（去掉中间段的 Secret/token）。

### 安全（必须）

- **`CLIENT_SECRET`、`refresh_token`、GitHub token**：只允许出现在 **GCP / GitHub 控制台或 Repository Secrets**，**不要**完整贴到聊天记录；若一页上同时有「界面结构」与「密钥明文」，请先打码密钥再导出快照。
- **路线 A 的步骤顺序不变**（GCP → Desktop OAuth → `chrome-webstore-upload-keys` → GitHub Secrets → Actions 验证）；OpenCLI **只减轻「看不懂控制台」**，不代替凭证保管。

**当前约定**：你已确认 Browser Bridge 已装且 **`opencli doctor` 通过**；优先由 Cursor Agent 在你**批准终端命令**的前提下执行 `opencli browser …`，根据输出逐步说明操作；Google **2FA / Captcha** 仍须你本人在浏览器里完成。

---

## 路线 B：不配置 CI，仅手工维护商店

- 每次发版在 [Chrome Web Store 开发者信息中心](https://chrome.google.com/webstore/devconsole) 对**同一扩展**上传新 zip、提交审核并等待通过即可（行为与「第一次上架」相同，只是更新版本）。

---

## 商店与运营层面的常见收尾（与 CI 无关）

- **列表信息**：检查商店页「概述 / 截图 / 隐私说明 / 支持链接」是否与当前功能一致（你当前列表描述里中英文/功能点若有不一致可后续在后台改）。
- **政策与权限**：若后续 manifest 增权限或数据声明有变，更新隐私政策与「数据使用」披露，减少二次审核风险。
- **版本节奏**：小步迭代、保留可回滚的上一版习惯，便于应对审核或用户反馈。

---

## 小结

| 你的目标 | 下一步 |
|---------|--------|
| 自动化更新商店 | 按文档 **§1–3** 配 GCP OAuth + 4 个 Secrets + Workflow 先试 `dry_run` 再测试组发布 |
| 继续手工上传 | 仅需在开发者控制台对现有条目上传新版本并走审核 |

若你明确「只要手工、不要 CI」，可跳过路线 A；若要与现有 `auto-release` 对齐，以实现 **推送 main → 自动 tag → 自动上架** 的流程，则应完成路线 A。
