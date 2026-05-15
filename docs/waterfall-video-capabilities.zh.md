# 瀑布流与视频当前帧：插件能力说明

本文说明右键视觉提取在 **瀑布流（masonry）** 与 **`<video>` 当前帧** 场景下的行为与限制，对应实现主要在 [`src/content/index.ts`](../src/content/index.ts)。

---

## 视频当前帧：**支持**

- 在 **`contextmenu` 捕获阶段**，`captureMediaUrlAtPoint` 会在 `elementsFromPoint` 命中栈里优先查找 `<video>`，并调用 **`captureVideoFrame`**：将当前帧绘制到离屏 `canvas`，再输出 **`toDataURL('image/jpeg', 0.9)`**；最长边缩放到 **1280px**，避免单条消息体积过大。
- 若 `<video>` 不在命中栈里（例如 `pointer-events: none`），会通过 **`pickMediaUrlByRectHit`** 在视口内的 `video`、`img` 上做矩形命中兜底；命中视频时同样先尝试 **`captureVideoFrame`**。
- **用户直接右键点在 `<video>` 上**时，内容脚本对该路径有意返回空串，以便与 Chrome **原生 `video` 上下文菜单**配合，避免重复入口；Chrome 仍会提供 `srcUrl`，扩展另有 fallback 菜单路径。

### 限制

- **跨域视频**：若页面未按 CORS 为视频资源配置得当，`canvas` 可能被污染，`toDataURL` 失败后会返回空串，上层可能退回 **`currentSrc` / `src`（视频 URL）** 而非 JPEG 帧。后台对「纯视频 URL」与「图像帧 data URL」的处理路径不同，详见 [`src/lib/image.ts`](../src/lib/image.ts) 中与 `video/*` 相关的注释与逻辑。
- **解码就绪**：极端懒加载或未就绪时，可能暂时拿不到有效帧尺寸，行为会依兜底分支而定。

---

## 瀑布流：**无专用模式**，有部分通用优化

实现上**没有**针对 Pinterest 等站的单独「瀑布流开关」或布局识别，而是通用右键选图逻辑下的启发式与性能保护：

- **多张 `<img>` 同时出现在同一命中栈**：选取 **包围盒面积较小** 的图片，用于 **减轻瀑布流重叠时的误选**（参见源码注释：Behance / Pinterest / Dribbble / Unsplash 等常用 overlay 场景）。
- **矩形兜底扫描**：对页面内 `video`、`img` 遍历设有 **`RECT_HIT_MAX_NODES`（2000）** 上限，避免 **超重型瀑布流页面一次右键卡死主线程**。

若站点使用非标准 DOM（例如极小占位图 + 背景图、激进虚拟列表、大量自定义绘制），仍可能出现漏选，需依赖其它分支（如 **CSS `background-image`** 探测）或站点特定适配（当前仓库**没有**站点白名单式瀑布流模块）。

---

## 简要对照

| 场景 | 说明 |
|------|------|
| 视频 → **当前帧 JPEG** 做视觉提取 | **支持**，受 CORS / 画布污染与解码就绪影响 |
| 瀑布流 masonry | **无单独模式**；依赖 **小面积优先选图** 与 **扫描节点上限**，不保证覆盖所有站点 |

---

## 右键菜单有时不出现？

常见原因与自查：

1. **MV3 Service Worker 竞态（兜底菜单）**  
   主菜单只在 Chrome 判定的 **图片 / 视频** 上下文显示；遮罩下的图等依赖 **兜底菜单**，由后台在收到 `CTX_MENU_PREP` 后异步 `contextMenus.update`。若后台刚从休眠启动，`update` 可能晚于菜单弹出，表现为「偶尔没有」。当前版本通过 **内容脚本与后台之间的 `runtime.connect` 保活**（见 [`src/content/bgPort.ts`](../src/content/bgPort.ts)、[`src/background/index.ts`](../src/background/index.ts)）减轻该问题。

2. **页面不允许注入或无权访问**  
   `chrome://`、`chrome.google.com/webstore`、部分内置 PDF / 特殊查看器等页面通常**不会**按普通站点加载扩展内容脚本，右键不会出现本扩展项。

3. **站点 DOM 导致探测不到图**  
   例如仅有自定义画布、封闭 Shadow DOM、虚拟列表未挂载真实 `<img>`、画布跨域污染等，`captureMediaUrlAtPoint` 拿不到 URL，且 Chrome 也未给出 image/video 上下文时，**主菜单与兜底都不会出现**。

**验收建议**：浏览器冷启动后立刻打开普通 HTTPS 图站，在**遮罩覆盖的图片**上第一次右键，应能稳定看到「提取图片提示词」；直接右键原生 `<img>` / `<video>` 仍应只看到 **一条**同名菜单（避免重复）。