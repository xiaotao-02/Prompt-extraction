# Chrome Web Store CI 自动发版配置指南

> 这份指南教你如何在 GitHub Actions 中**自动**把新版本上架到 Chrome Web Store，
> 一旦配好，以后只要 `git tag v0.2.0 && git push --tags` 就会自动构建 + 上传 + 发布。
> 整个配置过程是**一次性**的，建议预留 30 分钟。

---

## 0. 前置条件

- [ ] 已有 Chrome Web Store 开发者账号（一次性 $5）
- [ ] 已经**手动上传过至少一次**该扩展（Chrome Web Store API 不允许通过 API 创建新扩展，必须先在网页后台手工创建一遍，拿到 EXTENSION_ID 后才能用 API 替换 zip）
- [ ] 已经记下扩展 URL 中的 EXTENSION_ID（形如 `chromewebstore.google.com/detail/prompt-extracto/abcdefghijklmnop` 中那段 32 位小写字母）

> ⚠️ 很多人卡在这一步：**第一次必须手工上架**，CI 只能"更新已存在的扩展"。

---

## 1. 在 Google Cloud Console 创建 OAuth 应用

整个流程的核心是拿到 4 个值：`EXTENSION_ID` / `CLIENT_ID` / `CLIENT_SECRET` / `REFRESH_TOKEN`。
前 3 个在 Google Cloud Console 创建 OAuth Client 时直接给你，最后一个需要再做一次 OAuth dance。

### 1.1 创建一个 Google Cloud 项目

1. 打开 <https://console.cloud.google.com/>
2. 顶部「选择项目」→「新建项目」
3. 项目名随便填（例如 `prompt-extracto-cws`），点创建

### 1.2 启用 Chrome Web Store API

1. 左侧导航 → APIs & Services → **Library**
2. 搜索 **Chrome Web Store API**
3. 点进去 → **Enable**

### 1.3 配置 OAuth consent screen（同意屏幕）

1. 左侧导航 → APIs & Services → **OAuth consent screen**
2. User Type 选 **External**（个人 Google 账号必须选这个；选 Internal 仅限 Google Workspace 组织内账号）
3. 应用名称随便填（如 `Prompt Extracto CI`），support email 选你自己
4. 「Scopes」步骤：**直接 Save and continue 跳过**（不需要勾任何 scope，下面 dance 时会动态请求）
5. 「Test users」步骤：**必须把你将来要授权的那个 Google 账号（即开发者账号）加为 Test user**，否则 OAuth 时会被 403 拒绝
6. 全部完成后回到 OAuth consent screen 主页，**保持在 "Testing" 状态即可**，不需要 publish

> ⚠️ 不要在 consent screen "Publish app"，否则需要 Google 安全审查。Testing 状态下的应用 refresh_token 有效期是 7 天 → 每周都得重新拿，对 CI 是灾难。
>
> 解决办法二选一：
>   A. 永远把 OAuth app 保持在 Testing 状态，但**只用一次拿到 refresh_token 后立即把这个账号设为长期 Test user**（关键：在 Google Cloud Console 里查的 refresh_token 有 6 个月有效期，到期前 30 天 google 会发邮件提醒）。
>   B. 想要永久不过期，就得把 OAuth app 提交 Google 审核（要求很高，个人项目几乎不可能过）。
>
> **推荐方案 A**：每 6 个月跑一次 1.5 节重新拿 refresh_token，把 GitHub Secret 更新一下，1 分钟搞定。

### 1.4 创建 OAuth 2.0 Client ID

1. 左侧导航 → APIs & Services → **Credentials**
2. 顶部「+ CREATE CREDENTIALS」→ **OAuth client ID**
3. Application type 选 **Desktop app**
4. 名字随便（如 `cli`）→ Create
5. 弹出框给你两个值，**立即复制**：
   - `CLIENT_ID`（形如 `xxxxx.apps.googleusercontent.com`）
   - `CLIENT_SECRET`（形如 `GOCSPX-xxxxxxxx`）
6. 关掉弹框；之后随时可以在 Credentials 页重新看到

### 1.5 拿 REFRESH_TOKEN（核心！）

这是整个流程最容易卡的一步。不要用浏览器自带的 OAuth Playground，因为它的回调域不在我们刚才创建的 client 上，会拿不到正确的 refresh_token。

**正确做法**：用 npm 包 `chrome-webstore-upload-keys` 一条命令搞定。

在你**本机**（不是 CI）的任意目录执行：

```powershell
npx -y chrome-webstore-upload-keys
```

它会：

1. 让你输入刚才的 `CLIENT_ID` 和 `CLIENT_SECRET`
2. 自动在浏览器里打开 Google 授权页面
3. 你**用第 0 节的 Chrome Web Store 开发者账号**登录、授权
4. 浏览器跳转到 `localhost:8888` 的回调页（脚本临时起的本地 server）
5. 终端里直接打印出 `refresh_token`

复制这个 `refresh_token`。**这是一个长期有效（6 个月）的凭证，泄漏后等同于把你的扩展账号交出去**——务必只放进 GitHub Secrets，永远不要 commit 进仓库。

如果 `chrome-webstore-upload-keys` 不可用，等价手工流程：

```bash
# 1. 在浏览器打开下面 URL（替换 YOUR_CLIENT_ID）
https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&prompt=consent&scope=https://www.googleapis.com/auth/chromewebstore&redirect_uri=urn:ietf:wg:oauth:2.0:oob&client_id=YOUR_CLIENT_ID

# 2. 授权后页面会显示一个 4/0Adeu5BU... 的 CODE，复制
# 3. 用 curl 换 refresh_token
curl https://accounts.google.com/o/oauth2/token \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=YOUR_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"
```

返回的 JSON 里 `refresh_token` 字段就是。

---

## 2. 配置 GitHub Secrets

到你的 GitHub 仓库 → Settings → Secrets and variables → **Actions** → **New repository secret**，
添加以下 4 个：

| Name | Value |
|---|---|
| `CWS_EXTENSION_ID` | 第 0 节拿到的 32 位扩展 ID |
| `CWS_CLIENT_ID` | 1.4 节拿到的 client_id |
| `CWS_CLIENT_SECRET` | 1.4 节拿到的 client_secret |
| `CWS_REFRESH_TOKEN` | 1.5 节拿到的 refresh_token |

---

## 3. 验证

进入仓库 **Actions** Tab → 选 **Publish to Chrome Web Store** → **Run workflow**：

- 第一次跑时把 `dry_run` 选 `true`，只构建不上传，先确认 zip 出得来
- 看到 Workflow 绿色后，下载产物 `chrome-store-zip`，本地解压验证一下能在 `chrome://extensions` 加载
- 然后再跑一次 `dry_run = false`，并且把 `target` 选 `trustedTesters`（推到测试组，不影响公开商店）
- 如果有"trusted testers"组（在商店后台 Distribution 里配置），他们会立即收到更新
- 一切 OK 后，正式发版只需要：

```bash
git tag v0.2.0
git push origin v0.2.0
```

`publish-chrome-store.yml` 会被 tag push 自动触发，跑同一套流程并发布到 default（公开商店）。

---

## 4. 与现有 auto-release.yml 的协作

| Workflow | 触发 | 做什么 |
|---|---|---|
| `auto-release.yml`（已存在） | push 到 main | 自动 bump 版本号、打 tag `vX.Y.Z`、创建 GitHub Release，附带 dist-zip |
| `publish-chrome-store.yml`（本次新增） | tag `v*` push | 构建 store zip、上传到 Chrome Web Store、自动发布 |

**两个 workflow 互不耦合**：

- `auto-release` push 出 tag 后，`publish-chrome-store` 自动接力发到商店
- 也可以手动跑 `publish-chrome-store`（不推 tag，仅上架某次手动构建的版本）
- 如果你只想发 GitHub Release 不想发商店，把 `publish-chrome-store` 在 Actions 里 disable 即可

---

## 5. 故障排查

### "401: Unauthorized"
- refresh_token 过期了。回到 1.5 节重新拿一次，更新 `CWS_REFRESH_TOKEN`。

### "Item not found"
- `CWS_EXTENSION_ID` 写错了，或者还没在网页后台手工上架过该扩展。

### "Invalid response: 403 Forbidden ... ITEM_LIVE_REVIEW_IN_PROGRESS"
- 上一次提交还在 Google 审核中，本次提交被拒。等审核完再触发，或者先 reject 上一次。

### "Manifest is invalid"
- 本地先跑 `npm run release:store`，看看 dist/manifest.json 是不是合法。
- 上传前在 [chrome://extensions](chrome://extensions) 加载 dist 验证。

### CI 跑挂在 npm ci
- 检查 package-lock.json 是否提交。`auto-release.yml` 会自动 commit lock 文件，但如果你手动改了 package.json 没跑 `npm install`，CI 会因为 lock 不匹配而失败。
