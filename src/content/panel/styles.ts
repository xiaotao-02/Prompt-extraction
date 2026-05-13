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
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: min(720px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
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
  animation: panelIn .25s cubic-bezier(.2,.9,.3,1.2);
}
@media (prefers-color-scheme: dark) {
  .panel {
    background: rgba(24,24,27,0.94);
    color: #f4f4f5;
    border-color: rgba(255,255,255,0.08);
  }
}
@keyframes panelIn {
  from { transform: translate(-50%, calc(-50% + 12px)); opacity: 0; }
  to { transform: translate(-50%, -50%); opacity: 1; }
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  flex: none;
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
  background: transparent; border: none; cursor: pointer; padding: 4px;
  border-radius: 6px; color: inherit; opacity: 0.6;
  display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn:hover { opacity: 1; background: rgba(0,0,0,0.05); }
@media (prefers-color-scheme: dark) {
  .icon-btn:hover { background: rgba(255,255,255,0.08); }
}

.body {
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

.versions {
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  background: rgba(0,0,0,0.02);
  max-height: 320px;
  overflow-y: auto;
}
@media (prefers-color-scheme: dark) {
  .versions { border-color: rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); }
}
.versions-head {
  padding: 8px 10px; font-size: 11px; font-weight: 600; opacity: 0.65;
  border-bottom: 1px solid rgba(0,0,0,0.05);
}
@media (prefers-color-scheme: dark) {
  .versions-head { border-bottom-color: rgba(255,255,255,0.06); }
}
.versions-list {
  list-style: none; margin: 0; padding: 0;
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
