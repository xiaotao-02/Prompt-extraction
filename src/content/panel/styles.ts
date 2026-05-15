/**
 * 注入到 Shadow DOM 的样式表。原本作为单一字符串内联在 panel.ts 里，
 * 拆出来后让 IDE 能正常给 CSS 高亮，未来也方便接 PostCSS。
 *
 * 注意：这是字符串常量，不是 .css 文件——content script 必须把它通过
 * <style>.textContent 注入到 Shadow Root，不能依赖 vite 的 CSS import。
 */
import { UI_FONT_STACK_SANS } from '@/lib/uiFontStack';

export const STYLE = `
:host, * { box-sizing: border-box; }
.panel {
  /* 位置和尺寸由 JS 写入到 inline style（top/left/width/height），
     这里只给一组兜底默认值。height 不写死，让面板按内容自适应；
     用户从任意边缘 / 角落拖拽 resize 之后会被 JS 写成固定 px。 */
  position: fixed;
  top: 24px; left: 24px;
  width: min(720px, calc(100vw - 48px));
  min-width: 360px;
  min-height: 220px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  display: flex; flex-direction: column;
  background: rgba(255,255,255,0.96);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  color: #111;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 16px;
  box-shadow: 0 32px 80px -16px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.12);
  font: 13px/1.5 ${UI_FONT_STACK_SANS};
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: "kern" 1;
  overflow: hidden;
  /* resize 由 JS 通过 8 个 .resize-handle 自实现（见 events.ts:bindEdgeResize），
     不再依赖 CSS 原生 resize: both，因为后者只支持右下角一个方向。 */
  animation: panelIn .22s cubic-bezier(.2,.9,.3,1.2);
}
/* 主 UI 在 panel-surface 内替换；根节点与拉手常驻，避免整板销毁导致闪断。 */
.panel > [data-role="panel-surface"] {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 8 个边缘 resize 拉手：分别贴在 panel 内侧的 4 边 + 4 角。
   - 边 handle 6px 厚、长边在 10px 内缩，避免挤占角落 handle 的命中区。
   - 角 handle 14x14，位于 panel 4 个圆角处。
   - 角 handle 的 z-index 高于边 handle，保证斜向拖拽优先于单向。
   - 内嵌在 panel 内部（而非 outside 负偏移），这样不会被 panel 的
     overflow:hidden 截断点击区域。代价是 panel 内容（如 header / 按钮）
     最外圈 6~14px 会被 handle 盖住，但这一圈本来就是空白边距区，
     实际不影响功能。 */
.resize-handle {
  position: absolute;
  z-index: 5;
  /* 默认透明，hover 时不显示视觉提示，靠 cursor 让用户知道可以拖拽。 */
  background: transparent;
}
.resize-handle.n  { top: 0;     left: 14px;  right: 14px; height: 6px;  cursor: ns-resize; }
.resize-handle.s  { bottom: 0;  left: 14px;  right: 14px; height: 6px;  cursor: ns-resize; }
.resize-handle.w  { left: 0;    top: 14px;   bottom: 14px; width: 6px;  cursor: ew-resize; }
.resize-handle.e  { right: 0;   top: 14px;   bottom: 14px; width: 6px;  cursor: ew-resize; }
.resize-handle.nw { top: 0;     left: 0;     width: 14px; height: 14px; cursor: nwse-resize; z-index: 6; }
.resize-handle.ne { top: 0;     right: 0;    width: 14px; height: 14px; cursor: nesw-resize; z-index: 6; }
.resize-handle.sw { bottom: 0;  left: 0;     width: 14px; height: 14px; cursor: nesw-resize; z-index: 6; }
.resize-handle.se { bottom: 0;  right: 0;    width: 14px; height: 14px; cursor: nwse-resize; z-index: 6; }
/* panelIn 跑完后由 JS 给 panel 加上 .mounted，永久禁用入场动画。
   这样后续切换 .dragging / .resizing 等 class 时，浏览器不会因为
   "animation: none" 被移除而把 panelIn 当成新的动画声明重播一次，
   也就避免了"拖动 header 松手瞬间面板闪一下 / 像被重建"的现象。
   写在 .dragging / .resizing 之前，由 !important 自身保证胜出。
   注：这里特意不用反引号，外层 STYLE 是模板字符串，反引号会截断它。 */
.panel.mounted {
  animation: none !important;
}
/* 侧栏展开/收起时临时加上，让面板宽度和位置与侧栏的 .22s 过渡同步动画。
   .dragging / .resizing 的 transition:none!important 会覆盖，安全。 */
.panel.sidebar-transition {
  transition: width .22s cubic-bezier(.2,.9,.3,1.2),
              left .22s cubic-bezier(.2,.9,.3,1.2);
}
.panel.dragging,
.panel.resizing {
  /* 拖拽 / resize 中关掉动画/过渡，避免位置跳动；并提升一下阴影做拾起效果。 */
  animation: none !important;
  transition: none !important;
  box-shadow: 0 40px 90px -16px rgba(0,0,0,0.45), 0 12px 28px rgba(0,0,0,0.18);
  user-select: none;
  /* 弱化而非关掉 blur：从「无毛玻璃」跳回满强度时合成路径突变最明显。
     保留轻量 backdrop 以减轻 mouseup 闪感；成本仍低于满载 20px blur。 */
  backdrop-filter: blur(12px) saturate(130%) !important;
  -webkit-backdrop-filter: blur(12px) saturate(130%) !important;
  background: rgba(255,255,255,0.97);
  /* will-change 告诉合成器为这个层准备好独立合成，避免 reflow 时重新提层。 */
  will-change: left, top, width, height;
}
@media (prefers-color-scheme: dark) {
  .panel.dragging,
  .panel.resizing {
    background: rgba(24,24,27,0.97);
  }
}
@media (prefers-color-scheme: dark) {
  .panel {
    background: rgba(24,24,27,0.94);
    color: #f4f4f5;
    border-color: rgba(255,255,255,0.08);
  }
}
@keyframes panelIn {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  flex: none;
  /* header 整条作为拖拽把手；内部 icon-btn 会单独覆盖回 pointer。 */
  cursor: move;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
@media (prefers-color-scheme: dark) {
  .header { border-bottom-color: rgba(255,255,255,0.06); }
}
.title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
.badge {
  font-weight: 400; font-size: 11px; padding: 2px 6px;
  border-radius: 6px;
  background: rgba(0,0,0,0.05);
  color: rgba(0,0,0,0.6);
}
@media (prefers-color-scheme: dark) {
  .badge { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }
}
/* loading 头部的策略档位标签：用品牌紫色淡底，和右下角进度条的高亮色保持呼应。 */
.strategy-badge {
  background: rgba(99,102,241,0.12);
  color: #4f46e5;
  font-weight: 500;
}
@media (prefers-color-scheme: dark) {
  .strategy-badge { background: rgba(139,92,246,0.20); color: #c4b5fd; }
}
.strategy-badge.hidden { display: none; }
/* loading 头部的模型标签：用品牌青蓝色和 strategy 区分一下，
   让用户一眼能看出"用谁的什么模型在跑"。 */
.model-badge {
  background: rgba(14,165,233,0.12);
  color: #0369a1;
  font-weight: 500;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-color-scheme: dark) {
  .model-badge { background: rgba(56,189,248,0.20); color: #7dd3fc; }
}
.model-badge.hidden { display: none; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dot.loading { background: #f59e0b; animation: pulse 1.2s infinite; }
.dot.success { background: #10b981; }
.dot.error { background: #ef4444; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

.icon-btn {
  background: transparent; border: none; padding: 4px;
  border-radius: 6px; color: inherit; opacity: 0.6;
  display: inline-flex; align-items: center; justify-content: center;
  /* header 整条 cursor:move，按钮单独恢复成手型，不让人误以为按钮也是拖拽区。 */
  cursor: pointer;
}
.icon-btn:hover { opacity: 1; background: rgba(0,0,0,0.05); }
@media (prefers-color-scheme: dark) {
  .icon-btn:hover { background: rgba(255,255,255,0.08); }
}

.body {
  /* success 状态下 .body 和 .versions-side 并排成为 .panel-row 的两个 flex
     子项。sidebar 收起时宽度为 0，body 占满整个 panel-row；sidebar 展开时
     宽度过渡到 280px，body 通过 flex:1 1 auto + min-width:0 自动收窄，**不再
     被覆盖**，缩略图 / 编辑器 / 按钮全部保留可见与可点击。
     loading/error 状态下 .body 是 panel 的直接子元素，column flex 主轴
     是纵向，flex:1 1 auto 同样让它撑满 panel 剩余高度，行为一致。 */
  flex: 1 1 auto;
  min-width: 0;
  padding: 16px; display: flex; flex-direction: column; gap: 12px;
  overflow-y: auto;
}
.thumb {
  width: 100%; height: 220px; border-radius: 12px; overflow: hidden;
  background: rgba(0,0,0,0.04); display: flex; align-items: center; justify-content: center;
  flex: none;
}
.thumb img { width: 100%; height: 100%; object-fit: contain; }

.prompt-editor-wrap {
  position: relative;
  width: 100%;
  flex: none;
  min-width: 0;
}
.editor-char-count {
  position: absolute;
  right: 12px;
  bottom: 10px;
  font-size: 11px;
  line-height: 1;
  color: rgba(0,0,0,0.45);
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
@media (prefers-color-scheme: dark) {
  .editor-char-count { color: rgba(255,255,255,0.45); }
}

.prompt-text {
  width: 100%; min-height: 240px; max-height: 480px; resize: vertical;
  padding: 12px 14px; border-radius: 10px;
  border: 1px solid rgba(0,0,0,0.1);
  background: rgba(0,0,0,0.02);
  color: inherit; font-size: 13px; line-height: 1.6;
  font-family: inherit;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.prompt-editor-wrap .prompt-text {
  padding-bottom: 32px;
}
.prompt-text:focus {
  border-color: rgba(99,102,241,0.55);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.18);
}
@media (prefers-color-scheme: dark) {
  .prompt-text { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); }
}

.error-msg {
  padding: 10px 12px; border-radius: 10px;
  background: rgba(239,68,68,0.08); color: #b91c1c;
  font-size: 12px; line-height: 1.5; word-break: break-word;
}
@media (prefers-color-scheme: dark) { .error-msg { color: #fca5a5; } }

.meta-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px;
  gap: 6px;
}
.meta-left { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dirty-hint {
  opacity: 0; transition: opacity .15s;
  color: #b45309; font-weight: 500;
}
.dirty-hint.show { opacity: 1; }
@media (prefers-color-scheme: dark) {
  .dirty-hint { color: #fbbf24; }
}

/* refine-slot：常驻 DOM 的容器，靠 .hidden 控制 AI 调整框的显隐。
   不用 display:none 直接作用在 .refine-box 上，是为了将来可以加滑入动画
   而不需要管 refine-box 自身的布局类型。 */
.refine-slot { display: contents; }
.refine-slot.hidden { display: none; }

.refine-box {
  border: 1px solid rgba(99,102,241,0.25);
  background: linear-gradient(180deg, rgba(99,102,241,0.06), rgba(139,92,246,0.04));
  border-radius: 12px;
  padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
  position: relative;
  transition: opacity .15s;
}
.refine-box.loading { opacity: 0.85; }
@media (prefers-color-scheme: dark) {
  .refine-box {
    border-color: rgba(139,92,246,0.35);
    background: linear-gradient(180deg, rgba(139,92,246,0.10), rgba(99,102,241,0.06));
  }
}
.refine-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; font-weight: 600;
  color: #4f46e5;
}
.refine-head > span:first-child {
  display: inline-flex; align-items: center; gap: 6px;
}
@media (prefers-color-scheme: dark) {
  .refine-head { color: #c4b5fd; }
}
.refine-input {
  width: 100%; min-height: 80px; max-height: 220px; resize: vertical;
  padding: 8px 10px; border-radius: 8px;
  border: 1px solid rgba(99,102,241,0.25);
  background: rgba(255,255,255,0.7);
  color: inherit; font-size: 12px; line-height: 1.5;
  font-family: inherit;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.refine-input:focus {
  border-color: rgba(99,102,241,0.7);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.18);
}
.refine-input:disabled {
  opacity: 0.6; cursor: not-allowed;
}
@media (prefers-color-scheme: dark) {
  .refine-input {
    background: rgba(0,0,0,0.25);
    border-color: rgba(139,92,246,0.35);
  }
}
.refine-error {
  padding: 6px 10px; border-radius: 6px;
  background: rgba(239,68,68,0.12); color: #b91c1c;
  font-size: 11px; line-height: 1.45;
}
@media (prefers-color-scheme: dark) {
  .refine-error { color: #fca5a5; background: rgba(239,68,68,0.18); }
}
.refine-suggest {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.chip {
  border: 1px solid rgba(99,102,241,0.25);
  background: rgba(255,255,255,0.65);
  color: #4f46e5;
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  cursor: pointer; font-family: inherit;
  transition: background .12s, opacity .12s;
}
.chip:hover { background: rgba(99,102,241,0.10); }
.chip:disabled { opacity: 0.5; cursor: not-allowed; }
@media (prefers-color-scheme: dark) {
  .chip {
    background: rgba(139,92,246,0.10);
    border-color: rgba(139,92,246,0.35);
    color: #c4b5fd;
  }
  .chip:hover { background: rgba(139,92,246,0.20); }
}
.refine-actions {
  display: flex; justify-content: flex-end; gap: 6px;
}
/* refine 流式进度块。和顶部 loading 状态共用 .bar.progress / .hint-row 的样式，
   这里只负责给一个内边距和淡入动画。 */
.refine-progress {
  padding: 4px 0 0;
  animation: fadeIn .2s ease-out;
}
.refine-progress .hint-row { margin-top: 6px; }
/* refine 流式预览的 textarea：比顶部 loading 那个矮一点，省得在面板里把
   底部按钮挤下去。 */
.prompt-text.streaming.refine-streaming {
  min-height: 120px; max-height: 280px;
  font-size: 12px; line-height: 1.55;
}
.spinner {
  display: inline-block; width: 12px; height: 12px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.link-btn {
  background: transparent; border: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; border-radius: 6px;
  color: inherit; opacity: 0.7;
  font-size: 11px;
  font-family: inherit;
}
.link-btn:hover { opacity: 1; background: rgba(0,0,0,0.05); }
.link-btn.active { opacity: 1; background: rgba(99,102,241,0.12); color: #4f46e5; }
.link-btn.primary { color: #4f46e5; opacity: 0.9; }
.link-btn.primary:hover { background: rgba(99,102,241,0.12); opacity: 1; }
/* 危险动作（删除版本）：常态保持中性灰，hover 才变玫红，避免在
   sidebar 一排按钮里抢眼。margin-left:auto 把它推到右端，与
   "复制 / 恢复" 留出视觉间距。 */
.link-btn.danger { color: inherit; opacity: 0.55; margin-left: auto; }
.link-btn.danger:hover {
  opacity: 1; background: rgba(244,63,94,0.10); color: #e11d48;
}
.link-btn[disabled] { cursor: not-allowed; opacity: 0.35; }
.link-btn[disabled]:hover { background: transparent; }
@media (prefers-color-scheme: dark) {
  .link-btn:hover { background: rgba(255,255,255,0.06); }
  .link-btn.active { background: rgba(139,92,246,0.18); color: #c4b5fd; }
  .link-btn.primary { color: #a5b4fc; }
  .link-btn.primary:hover { background: rgba(139,92,246,0.18); }
  .link-btn.danger:hover { background: rgba(244,63,94,0.18); color: #fda4af; }
}

/* panel-row：success 状态下，header 下方的横向容器。
   - flex: 1 1 auto + min-height: 0：占满 panel 剩余高度，超出时由内部
     .body / .versions-list 自己滚动。
   - overflow: hidden：避免 sidebar width 过渡的中间帧把超出宽度推出去。
   - sidebar 现在是占布局空间的 flex item，不再是覆盖层，所以这里不需要
     position: relative 提供定位上下文。 */
.panel-row {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* 左侧历史版本侧栏：常驻 DOM 的 flex 列，展开时把 .body 挤窄而不是
   覆盖在它上面。
   设计要点：
   - 收起时 width: 0 + overflow: hidden，DOM 在但视觉完全消失。
   - 用 width 过渡做"展开/收起"动画，比 transform 浮层更直观地告诉用户
     主体内容是被推开了，不会再有"按钮被挡住点不到"的问题。
   - pointer-events 收起时关掉，万一里面有焦点也接不到键鼠事件。
   - flex: none 防止它被父级 flex 算法压缩到非 width 设定的尺寸。 */
.versions-side {
  flex: none;
  width: 0;
  max-width: 50%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(248,248,250,0.98);
  border-right: 1px solid transparent;
  transition: width .22s cubic-bezier(.2,.9,.3,1.2),
              border-right-color .22s ease,
              opacity .18s ease;
  opacity: 0;
  pointer-events: none;
}
.panel-row.versions-open .versions-side {
  width: 280px;
  border-right-color: rgba(0,0,0,0.08);
  opacity: 1;
  pointer-events: auto;
}
/* sidebar 内部布局始终按 280px 计算，外层 width 在 0 ↔ 280 过渡时，
   .versions-head 标题 / .version-preview 文本不会跟着挤压换行 → 过渡
   视觉更稳。外层 overflow:hidden 会把多出来的部分裁掉。 */
.versions-side > * {
  min-width: 280px;
}
@media (prefers-color-scheme: dark) {
  .versions-side {
    background: rgba(30,30,34,0.98);
  }
  .panel-row.versions-open .versions-side {
    border-right-color: rgba(255,255,255,0.10);
  }
}
.versions-head {
  padding: 10px 12px;
  font-size: 11px; font-weight: 600;
  display: flex; align-items: center; justify-content: space-between;
  gap: 6px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  flex: none;
  opacity: 0.85;
}
@media (prefers-color-scheme: dark) {
  .versions-head { border-bottom-color: rgba(255,255,255,0.06); }
}
.versions-list {
  list-style: none; margin: 0; padding: 0;
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto;
}
.version-item {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(0,0,0,0.04);
  cursor: pointer;
  transition: background .12s;
}
.version-item.refine-pending { opacity: 0.95; }
.version-item.refine-pending .version-preview { font-style: italic; color: rgba(80,80,90,0.95); }
.version-item:last-child { border-bottom: none; }
.version-item:hover { background: rgba(99,102,241,0.06); }
.version-item:focus-visible {
  outline: 2px solid rgba(99,102,241,0.4);
  outline-offset: -2px;
}
.version-item.current { background: rgba(16,185,129,0.06); }
/* selected：editor 内容匹配的那一条。紫色背景只表示正在预览；
   恢复历史版本仍必须显式点击"恢复此版本"。
   写在 .current 后面，覆盖它的绿色背景，让"选中态"优先于"最新版"。 */
.version-item.selected { background: rgba(99,102,241,0.12); }
.version-item.selected:hover { background: rgba(99,102,241,0.16); }
@media (prefers-color-scheme: dark) {
  .version-item { border-bottom-color: rgba(255,255,255,0.04); }
  .version-item:hover { background: rgba(139,92,246,0.10); }
  .version-item.current { background: rgba(16,185,129,0.10); }
  .version-item.selected { background: rgba(139,92,246,0.18); }
  .version-item.selected:hover { background: rgba(139,92,246,0.22); }
}
.version-head {
  display: flex; align-items: center; gap: 6px; font-size: 11px; margin-bottom: 4px;
  flex-wrap: nowrap;
  min-width: 0;
}
.version-tag {
  flex: none;
  white-space: nowrap;
  padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 500;
  background: rgba(99,102,241,0.12); color: #4f46e5;
}
.version-tag.extracted { background: rgba(16,185,129,0.12); color: #047857; }
.version-tag.edited { background: rgba(245,158,11,0.14); color: #b45309; }
.version-tag.restored { background: rgba(99,102,241,0.12); color: #4f46e5; }
.version-tag.refined { background: rgba(168,85,247,0.14); color: #7e22ce; }
@media (prefers-color-scheme: dark) {
  .version-tag.extracted { background: rgba(16,185,129,0.18); color: #6ee7b7; }
  .version-tag.edited { background: rgba(245,158,11,0.20); color: #fbbf24; }
  .version-tag.restored { background: rgba(139,92,246,0.20); color: #c4b5fd; }
  .version-tag.refined { background: rgba(168,85,247,0.25); color: #d8b4fe; }
}
.version-time {
  flex: none;
  white-space: nowrap;
  margin-left: auto;
  opacity: 0.65;
}
.version-meta, .version-strategy {
  min-width: 0;
  max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 500;
  background: rgba(255,255,255,0.70); color: #52525b;
  border: 1px solid rgba(212,212,216,0.70);
}
.version-strategy {
  background: rgba(245,158,11,0.12); color: #b45309; border-color: rgba(245,158,11,0.25);
}
@media (prefers-color-scheme: dark) {
  .version-meta {
    background: rgba(39,39,42,0.80); color: #d4d4d8; border-color: rgba(63,63,70,0.80);
  }
  .version-strategy {
    background: rgba(245,158,11,0.18); color: #fbbf24; border-color: rgba(245,158,11,0.26);
  }
}
/* 版本序号 chip：与来源 chip 并列在同一行，按 versionNo 显示
   "初始 / 版本N / 当前"。当前 = emerald，初始 = sky 蓝（与 emerald 区分），
   中间版本 = 中性灰。 */
.version-ord {
  flex: none;
  white-space: nowrap;
  padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;
  background: rgba(113,113,122,0.18); color: #3f3f46;
}
.version-ord.current { background: rgba(16,185,129,0.18); color: #047857; }
.version-ord.initial { background: rgba(14,165,233,0.18); color: #0369a1; }
@media (prefers-color-scheme: dark) {
  .version-ord { background: rgba(161,161,170,0.20); color: #e4e4e7; }
  .version-ord.current { background: rgba(16,185,129,0.25); color: #6ee7b7; }
  .version-ord.initial { background: rgba(56,189,248,0.25); color: #7dd3fc; }
}
.version-preview {
  font-size: 12px; line-height: 1.5; opacity: 0.85;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-word;
}
.version-actions {
  display: flex; gap: 4px; margin-top: 4px;
  flex-wrap: wrap;
}

/* ── 自定义策略下拉选择器 ── */
.strategy-dropdown {
  position: relative;
  display: inline-flex;
  max-width: 160px;
}
.sd-trigger {
  display: inline-flex; align-items: center; gap: 4px;
  border: 1px solid rgba(99,102,241,0.25);
  background: rgba(99,102,241,0.06);
  color: #4f46e5;
  font-size: 11px; font-weight: 500; font-family: inherit;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer; outline: none;
  transition: background .12s, border-color .15s, box-shadow .15s;
  max-width: 160px;
  white-space: nowrap;
}
.sd-label {
  overflow: hidden; text-overflow: ellipsis;
}
.sd-arrow {
  flex: none;
  width: 10px; height: 6px;
  transition: transform .18s ease;
}
.strategy-dropdown.open .sd-arrow { transform: rotate(180deg); }
.sd-trigger:hover {
  background: rgba(99,102,241,0.12);
  border-color: rgba(99,102,241,0.4);
}
.sd-trigger:focus-visible {
  border-color: rgba(99,102,241,0.55);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.18);
}
.sd-menu {
  display: none;
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  min-width: 140px;
  max-width: 220px;
  list-style: none;
  margin: 0; padding: 4px;
  background: rgba(255,255,255,0.98);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid rgba(0,0,0,0.10);
  border-radius: 10px;
  box-shadow: 0 8px 24px -4px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08);
  z-index: 20;
  animation: sdIn .14s ease-out;
}
.strategy-dropdown.open .sd-menu { display: block; }
@keyframes sdIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.sd-item {
  padding: 6px 10px;
  font-size: 12px; font-weight: 400; font-family: inherit;
  color: #1f2937;
  border-radius: 6px;
  cursor: pointer;
  transition: background .1s, color .1s;
  white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.sd-item:hover {
  background: rgba(99,102,241,0.08);
  color: #4338ca;
}
.sd-item.active {
  background: rgba(99,102,241,0.12);
  color: #4338ca;
  font-weight: 600;
}
@media (prefers-color-scheme: dark) {
  .sd-trigger {
    background: rgba(139,92,246,0.12);
    border-color: rgba(139,92,246,0.35);
    color: #c4b5fd;
  }
  .sd-trigger:hover {
    background: rgba(139,92,246,0.20);
    border-color: rgba(139,92,246,0.5);
  }
  .sd-trigger:focus-visible {
    border-color: rgba(139,92,246,0.6);
    box-shadow: 0 0 0 3px rgba(139,92,246,0.2);
  }
  .sd-menu {
    background: rgba(30,30,34,0.98);
    border-color: rgba(255,255,255,0.10);
    box-shadow: 0 8px 28px -4px rgba(0,0,0,0.5), 0 2px 10px rgba(0,0,0,0.3);
  }
  .sd-item { color: #d1d5db; }
  .sd-item:hover {
    background: rgba(139,92,246,0.16);
    color: #e0d4fc;
  }
  .sd-item.active {
    background: rgba(139,92,246,0.22);
    color: #e0d4fc;
  }
}

.actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 8px;
  font-size: 12px; font-weight: 500;
  cursor: pointer; border: 1px solid transparent;
  transition: transform .08s, background .12s, opacity .12s;
  font-family: inherit;
  color: inherit;
}
.btn:active { transform: scale(0.97); }
.btn.primary {
  background: linear-gradient(135deg,#6366f1,#8b5cf6);
  color: #fff;
}
.btn.primary:hover { filter: brightness(1.05); }
.btn.ghost {
  background: transparent;
  color: inherit;
  border-color: rgba(0,0,0,0.1);
}
.btn.ghost:hover { background: rgba(0,0,0,0.05); }
.btn.disabled, .btn[disabled] {
  opacity: 0.45; cursor: not-allowed;
}
.btn.disabled:hover, .btn[disabled]:hover { filter: none; background: transparent; }
@media (prefers-color-scheme: dark) {
  .btn.ghost { border-color: rgba(255,255,255,0.12); }
  .btn.ghost:hover { background: rgba(255,255,255,0.06); }
}
.btn.copied { background: #10b981 !important; color:#fff !important; border-color: transparent !important; }

.loader-wrap { padding: 8px 0; }
.bar {
  position: relative; width: 100%; height: 6px; border-radius: 4px;
  overflow: hidden; background: rgba(0,0,0,0.06);
}
@media (prefers-color-scheme: dark) {
  .bar { background: rgba(255,255,255,0.08); }
}
/* 旧的"无方向滑块"：仅在没设 progress 时 fallback，目前不再使用。 */
.bar:not(.progress) span {
  position: absolute; left: -40%; top: 0; width: 40%; height: 100%;
  background: linear-gradient(90deg,#6366f1,#8b5cf6);
  animation: slide 1.4s infinite;
}
@keyframes slide {
  0% { left: -40%; }
  100% { left: 100%; }
}
/* 阶段映射出的"确定性进度条"。宽度由 JS 控制，只用 transition 平滑。 */
.bar.progress { background: rgba(99,102,241,0.10); }
.bar.progress span {
  display: block; height: 100%;
  background: linear-gradient(90deg,#6366f1,#8b5cf6);
  width: 0%;
  transition: width .35s cubic-bezier(.4,.0,.2,1);
  position: relative;
}
/* 在确定性进度条上叠一层"流动光"，让用户知道还在持续工作中。 */
.bar.progress span::after {
  content: '';
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 40px;
  background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.5) 100%);
  filter: blur(2px);
  animation: shimmer 1.6s ease-in-out infinite;
}
@keyframes shimmer {
  0%, 100% { opacity: 0.25; transform: translateX(0); }
  50% { opacity: 0.85; transform: translateX(-6px); }
}

.hint { margin-top: 8px; font-size: 11px; opacity: 0.6; }
.hint-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.hint-row .elapsed {
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
  font-weight: 500;
  color: #4f46e5;
}
@media (prefers-color-scheme: dark) {
  .hint-row .elapsed { color: #c4b5fd; }
}

.stream-preview {
  display: flex;
  flex-direction: column;
  animation: fadeIn .2s ease-out;
}
.stream-preview.hidden { display: none; }
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.prompt-text.streaming {
  min-height: 220px; max-height: 460px;
  background: linear-gradient(180deg, rgba(99,102,241,0.04), rgba(139,92,246,0.03));
  border-color: rgba(99,102,241,0.25);
  cursor: default;
}
@media (prefers-color-scheme: dark) {
  .prompt-text.streaming {
    background: linear-gradient(180deg, rgba(139,92,246,0.08), rgba(99,102,241,0.04));
    border-color: rgba(139,92,246,0.30);
  }
}`;
