# Chrome Web Store 上架素材

本目录是上架到 Chrome Web Store 时**直接复制粘贴到开发者后台表单**的所有文本与素材清单。
顺序对应后台「Store listing」「Privacy practices」「Distribution」三个 Tab 的字段。

> 中英双语策略：上传时先在后台**默认语言**选 `zh_CN`，把中文素材填进去；
> 然后点页面顶部「+ Add language」追加 `en`，再把英文素材覆盖。
> 不同语言的字段在审核时同步审，**英文版的描述更容易被海外审核员一遍过**，建议都填。

| 文件 | 对应 Chrome Web Store 表单字段 |
|---|---|
| `name.txt` | Store listing → Name（≤45 字符）|
| `summary.zh.txt` / `summary.en.txt` | Store listing → Summary（≤132 字符）|
| `description.zh.md` / `description.en.md` | Store listing → Description（≤16000 字符，支持简单换行）|
| `category.txt` | Store listing → Category |
| `single-purpose.zh.md` / `single-purpose.en.md` | Privacy practices → Single purpose description |
| `permission-justifications.md` | Privacy practices → Permission justifications（每条权限单独的解释框）|
| `data-usage-disclosure.md` | Privacy practices → Data usage（一系列勾选框 + 文本解释）|
| `privacy-policy-url.txt` | Privacy practices → Privacy policy |
| `CHECKLIST.md` | 上传前自检清单 |

## 一句话："为什么要拆这么细？"

Chrome Web Store 的审核被打回最常见的三大原因，**全部对应这里的不同文件**：

1. **"Single purpose" 不清晰** → `single-purpose.*.md`
2. **"Permission justification" 不充分**（特别是 `<all_urls>` / `host_permissions`）→ `permission-justifications.md`
3. **"Data usage disclosure" 与代码实际行为不一致**（比如代码会发送图片到 OpenAI，但表单里没勾"Personal communications"）→ `data-usage-disclosure.md`

按本目录文件填，不会被打回这三类问题。
