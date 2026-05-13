/**
 * 注入到 Shadow DOM 的样式表。原本作为单一字符串内联在 panel.ts 里，
 * 拆出来后让 IDE 能正常给 CSS 高亮，未来也方便接 PostCSS。
 *
 * 注意：这是字符串常量，不是 .css 文件——content script 必须把它通过
 * <style>.textContent 注入到 Shadow Root，不能依赖 vite 的 CSS import。
 */
export const STYLE = `
:host, * { box-sizing: border-box; }
.panel {
  /* 位置和尺寸由 JS 写入到 inline style（top/left/width/height），
     这里只给一组兜底默认值。height 不写死，让面板按内容自适应；
     用户从右下角拖拽 resize 之后会被 JS 写成固定 px。 */
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
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  overflow: hidden;
  /* resize: both 允许用户从右下角拖动调整宽高。配合 overflow:hidden 才能生效。 */
  resize: both;
  animation: panelIn .22s cubic-bezier(.2,.9,.3,1.2);
}
.panel.dragging,
.panel.resizing {
  /* 拖拽 / resize 中关掉动画/过渡，避免位置跳动；并提升一下阴影做拾起效果。 */
  animation: none !important;
  transition: none !important;
  box-shadow: 0 40px 90px -16px rgba(0,0,0,0.45), 0 12px 28px rgba(0,0,0,0.18);
  user-select: none;
  /* 关掉 backdrop-filter：拖动 / resize 期间每帧重新对整个视口做高斯模糊
     +饱和度运算，是主线程卡顿的最大元凶。换成接近不透明的纯色背景就行，
     mouseup 后恢复毛玻璃。 */
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background: rgba(255,255,255,0.99);
  /* will-change 告诉合成器为这个层准备好独立合成，避免 reflow 时重新提层。 */
  will-change: left, top, width, height;
}
@media (prefers-color-scheme: dark) {
  .panel.dragging,
  .panel.resizing {
    background: rgba(24,24,27,0.99);
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
  /* success 状态下 .body 处在 .panel-row 内，是它唯一的 flex 子元素（历史
     版本 sidebar 已改为 position:absolute 的浮层），所以 flex:1 1 auto 让
     body 占满整个 panel-row 宽度，sidebar 滑出/收起时 body 视觉宽度不变。
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

.prompt-text {
  width: 100%; min-height: 240px; max-height: 480px; resize: vertical;
  padding: 12px 14px; border-radius: 10px;
  border: 1px solid rgba(0,0,0,0.1);
  background: rgba(0,0,0,0.02);
  color: inherit; font-size: 13px; line-height: 1.6;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
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
.link-btn[disabled] { cursor: not-allowed; opacity: 0.35; }
.link-btn[disabled]:hover { background: transparent; }
@media (prefers-color-scheme: dark) {
  .link-btn:hover { background: rgba(255,255,255,0.06); }
  .link-btn.active { background: rgba(139,92,246,0.18); color: #c4b5fd; }
  .link-btn.primary { color: #a5b4fc; }
  .link-btn.primary:hover { background: rgba(139,92,246,0.18); }
}

/* panel-row：success 状态下，header 下方的横向容器。
   - position: relative：给绝对定位的历史版本 overlay 提供定位上下文。
   - flex: 1 1 auto + min-height: 0：占满 panel 剩余高度，超出时由内部
     .body / .versions-list 自己滚动。
   - overflow: hidden：截断 versions sidebar 滑出动画的左侧"屏外"那部分。 */
.panel-row {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* 左侧历史版本侧栏：常驻 DOM 的覆盖式 drawer，从面板左侧滑入。
   设计要点：
   - position: absolute 完全脱离布局流 → 切显隐时主面板宽高不动。
   - transform: translateX 控制滑入滑出，配合 transition 平滑过渡。
   - pointer-events / visibility 在收起时关闭，避免吃掉主体上的点击。
   - 自带阴影 + 半透明背景，作为浮层有层次感。 */
.versions-side {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 280px;
  max-width: 70%;
  z-index: 2;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(248,248,250,0.98);
  border-right: 1px solid rgba(0,0,0,0.08);
  box-shadow: 8px 0 24px -8px rgba(0,0,0,0.18);
  transform: translateX(-100%);
  transition: transform .22s cubic-bezier(.2,.9,.3,1.2),
              opacity .18s ease;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
}
.panel-row.versions-open .versions-side {
  transform: translateX(0);
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
}
@media (prefers-color-scheme: dark) {
  .versions-side {
    background: rgba(30,30,34,0.98);
    border-right-color: rgba(255,255,255,0.10);
    box-shadow: 8px 0 24px -8px rgba(0,0,0,0.55);
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
}
.version-item:last-child { border-bottom: none; }
.version-item.current { background: rgba(16,185,129,0.06); }
@media (prefers-color-scheme: dark) {
  .version-item { border-bottom-color: rgba(255,255,255,0.04); }
  .version-item.current { background: rgba(16,185,129,0.10); }
}
.version-head {
  display: flex; align-items: center; gap: 6px; font-size: 11px; margin-bottom: 4px;
}
.version-tag {
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
.version-time { opacity: 0.65; }
.version-badge {
  margin-left: auto; padding: 1px 6px; border-radius: 4px;
  font-size: 10px; background: rgba(16,185,129,0.18); color: #047857;
}
@media (prefers-color-scheme: dark) {
  .version-badge { background: rgba(16,185,129,0.25); color: #6ee7b7; }
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
