/**
 * 与 src/styles/globals.css 中 @theme --font-sans 保持同步（逐字相同）。
 * Shadow DOM 无法引用全局 CSS，面板侧从本常量注入；改栈时请同时改 globals.css。
 */
export const UI_FONT_STACK_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, "Noto Sans CJK SC", sans-serif';
