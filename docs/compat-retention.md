# 兼容层保留说明与变更后验证

本文档对应「核心提炼与冗余清理」类改动的边界：**不要轻易删除**下列兼容逻辑；发版前用下方冒烟清单回归。

## 基线自动化检查

删依赖或删文件后应始终通过：

```bash
npm test
npm run lint
npm run build
npm run knip
```

- `npm run knip` 仅检查 **未使用文件与依赖**（见根目录 [`knip.json`](../knip.json) 的 `--include` 范围）。  
- 需要完整的未使用 **导出** 报告时：`npm run knip:all`（会因大量对外 API 导出而产生噪声，属预期）。

## 人工冒烟（核心路径）

建议在 Chrome 中「重新加载扩展」后执行：

1. **Popup**：打开工具栏图标，列表与操作按钮可用；能进入 Options / 相关链接。
2. **Options**：打开设置页，供应商/模型、策略、数据与备份相关区块加载正常。
3. **网页注入面板**：在任意页面触发浮动面板（与日常用法一致），输入区与「生成 / 洗稿 / refine」等主流程可操作。
4. **右键与参考图**：对图片使用上下文菜单「添加到参考」「直接反推」等（与 [`src/manifest.config.ts`](../src/manifest.config.ts) 一致）。
5. **快捷键区域截图**（若使用）：`Ctrl+Shift+E`（Mac 为 `Command+Shift+E`）截取并加入参考。

## 原则上应保留的「兼容」代码（勿当死代码删）

| 区域 | 说明 | 代表位置 |
|------|------|----------|
| 运行时消息 / 存储形状 | 旧客户端省略字段、旧版 refine 单路等，靠可选字段兼容 | [`src/lib/types.ts`](../src/lib/types.ts) 内「兼容旧客户端」注释 |
| 设置持久化迁移 | `discoveredModels` 等曾跟随 sync 的数据迁移 | [`src/lib/storage/settings.ts`](../src/lib/storage/settings.ts) |
| 备份格式 | 备份文件 v1/v2/v3 的读入与兼容 | [`src/lib/storage/backup.ts`](../src/lib/storage/backup.ts) |
| 面板 DOM / 流式展示 | 旧 DOM 上仍存在 `stream-preview` 等时的分支 | [`src/content/panel/loading.ts`](../src/content/panel/loading.ts) |
| 策略措辞 | `classic` 键名、`append` 等与老用户设置对齐 | [`src/lib/strategies-meta.ts`](../src/lib/strategies-meta.ts)、[`src/lib/strategies.ts`](../src/lib/strategies.ts) |
| 远程配置 / 更新 | 调用链可能较少但属于运营能力 | [`src/lib/remoteRuntimeConfig/`](../src/lib/remoteRuntimeConfig/)、[`src/lib/updater.ts`](../src/lib/updater.ts)、[`src/lib/applyExtensionUpdate.ts`](../src/lib/applyExtensionUpdate.ts) |

删除上述逻辑可能导致已安装用户的数据错位、无声失败或面板旧实例异常。

## 本轮已移除的冗余（截至文档编写时）

- **依赖**：`zustand`（源码中从未引用）。
- **未引用文件**（Knip `--include files` 无残留后删除）：  
  - `src/options/PromptLibrary/parts/StatCard.tsx`  
  - `src/options/PromptLibrary/tabs/EditorTab.tsx`（展开面板已改由 [`ExpandedPanel.tsx`](../src/options/PromptLibrary/ExpandedPanel.tsx) 内联区块与其它 Tab 承担，二者无 import）。

后续若再删文件，务必先跑 `npm run knip` 并人工确认非动态引用（例如仅靠字符串的消息名）。
