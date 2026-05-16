# 上架前自检清单（一次性 Checklist）

> 上架前**逐条**打勾。任何一项打不上勾就**不要**点提交，否则审核被打回 1-2 周等不起。

---

## 1. 开发者账号

- [ ] 已注册 [Chrome Web Store 开发者账号](https://chrome.google.com/webstore/devconsole)（一次性 $5，注册后必须等待 24 小时左右才能上架第一个扩展）
- [ ] 开发者账号已通过邮箱验证
- [ ] 开发者账号身份信息已填写（个人开发者：真实姓名 + 国家；组织：公司全称 + 地址 + 域名验证）

## 2. 仓库 / 文件准备（已由本次任务生成，确认存在即可）

- [ ] `LICENSE` 存在（MIT）
- [ ] `PRIVACY.md` 存在
- [ ] `PRIVACY.md` 已通过 `git push` 同步到 GitHub `main` 分支
- [ ] 验证 `https://raw.githubusercontent.com/xiaotao-02/Prompt-extraction/main/PRIVACY.md` 可在浏览器无登录直接打开
- [ ] `store-listing/` 内全部中英文素材已生成
- [ ] `store-assets/promo/small-promo-440x280.png` 已生成
- [ ] `store-assets/promo/marquee-1400x560.png` 已生成
- [ ] `store-assets/screenshots/screenshot-{1..5}-*.png` 已生成

## 3. 构建出符合上架要求的 zip

```powershell
npm run release:store
```

跑完后确认：

- [ ] 终端打印「上架包就绪」
- [ ] `dist-zip/store/prompt-extracto-store-vX.Y.Z.zip` 存在
- [ ] 终端给出的 SHA-256 已记录到该版本的 GitHub Release notes 中
- [ ] zip 体积 < 10 MiB
- [ ] 用任意解压工具打开 zip：
  - [ ] **没有** `.map` 文件
  - [ ] **没有** `.ts` / `.tsx` 文件
  - [ ] 根目录有 `manifest.json`
  - [ ] `icons/icon-{16,32,48,128}.png` 都在

## 4. 进入 Chrome Web Store 后台

打开 <https://chrome.google.com/webstore/devconsole> → 「+ 新增项目」→ 上传上面的 zip → 进入「Item」详情页。

后台共 4 个 Tab，按下面顺序填，都填完才能点「Submit for review」：

### 4.1 Store listing（商品页）

| 字段 | 复制自 | 备注 |
|---|---|---|
| Name | `store-listing/name.txt` | ≤ 45 字符 |
| Summary（zh_CN） | `store-listing/summary.zh.txt` | ≤ 132 字符 |
| Summary（en） | `store-listing/summary.en.txt` | 切到 en locale 后填 |
| Description（zh_CN） | `store-listing/description.zh.md` 全文 | ≤ 16,000 字符 |
| Description（en） | `store-listing/description.en.md` 全文 | 切到 en locale 后填 |
| Category | `store-listing/category.txt` | Productivity |
| Language | 默认 `中文 (zh_CN)`，再 + 一个 `English` | |
| Store icon (128×128) | `dist/icons/icon-128.png` | 上传 zip 后已自动用上，无需重传 |
| Small promo tile (440×280) | `store-assets/promo/small-promo-440x280.png` | **必须** |
| Marquee promo tile (1400×560) | `store-assets/promo/marquee-1400x560.png` | 强烈推荐 |
| Screenshots (1280×800 ×5) | `store-assets/screenshots/screenshot-1..5-*.png` | 至少 1 张，推荐 5 张 |

- [ ] 全部填完，预览页面没有任何"missing"红字

### 4.2 Privacy practices（隐私实践）

| 字段 | 复制自 |
|---|---|
| Single purpose | `store-listing/single-purpose.zh.md` 或 `.en.md` |
| Permission justifications · 每个权限单独的输入框（与 zip 内 `manifest.json` 的 `permissions` **逐项对应**） | `store-listing/permission-justifications.md` 中对应小节；若弹窗提示「必须提供 clipboardRead 理由」，零注释整段复制：`store-listing/clipboard-read-justification-zh-paste-only.txt`；或见 `clipboard-permission-snippets.zh.txt` 完整版/短版 |
| Data usage 勾选项 + Approved use cases 文本 | `store-listing/data-usage-disclosure.md` |
| Privacy policy URL | `store-listing/privacy-policy-url.txt` |

- [ ] 「I do not sell or transfer …」3 条 certification 全部勾选
- [ ] 「Remote code: No」勾选

### 4.3 Distribution（分发）

- [ ] Visibility: **Public**（首次上架建议先 Unlisted 验证一遍流程，再改为 Public）
- [ ] Distribution regions: 默认 All regions（国内用户也能装；如果想限制，按需调整）
- [ ] Pricing: Free
- [ ] Mature content: No

### 4.4 Account（账户级别，仅一次）

- [ ] Verified contact email: 填一个能收信的邮箱
- [ ] Account verification 邮件已点击确认

## 5. 提交审核

- [ ] 点 **Submit for review**
- [ ] 后台状态变为 **Pending review**
- [ ] 把审核确认邮件保存到归档（标题类似 "Item submitted: Prompt Extracto"）

## 6. 审核期间（通常 1-7 个工作日）

- [ ] 不要重复提交同一版本
- [ ] 关注开发者邮箱：被打回时审核员会写明原因
- [ ] 如果被打回，**只需修复对应字段后再次 submit，无需重新打 zip**（除非要修改代码）

## 7. 审核通过后

- [ ] 拿到商品的 Web Store URL（形如 `https://chromewebstore.google.com/detail/prompt-extracto/<EXT_ID>`）
- [ ] 把 URL 加到 README 顶部
- [ ] 把 EXTENSION_ID 记录到 `.github/secrets-ref.md`（**不要**入仓，仅在自己机器上保留），后续 CI 自动发版要用
- [ ] 截图保留一份审核状态作为发版记录

---

## 8. 常见被打回原因（提前规避）

| 原因 | 本项目对策 |
|---|---|
| 「Insufficient justification for `<all_urls>`」 | 已在 `permission-justifications.md` 第 6 节写死说理 |
| 「Privacy disclosure mismatch」 | `data-usage-disclosure.md` 已严格对齐代码实际行为 |
| 「Single purpose unclear」 | `single-purpose.*.md` 已声明唯一用途 |
| 「Description spam / keyword stuffing」 | 描述里没有"重复关键词"、不带营销词，保持工具型语调 |
| 「Misleading screenshots」 | 截图里的 prompt 都是真实可复现的示例文本 |
| 「Hidden remote code (eval / new Function)」 | 代码无远程脚本，`permission-justifications.md` 已声明 No |
| 「Privacy policy not accessible」 | URL 是 GitHub 公开 raw 链接，无登录可访问 |
