/**
 * 浮动面板的几何信息（位置 + 尺寸）：加载、保存、clamp、apply。
 *
 * 设计要点：
 * - 默认状态下 width 用 CSS 默认值（720px），height 完全 auto，让内容决定高度。
 *   这样状态切换（loading → success → versions 展开）时面板能"自适应"内容。
 * - 用户主动操作后才把对应字段写成固定 px：
 *   · 拖动 header → 写 left / top
 *   · 拖任意边缘 / 角落 resize → 写 width / height（西/北方向同时写 left/top）
 * - 几何信息持久化到 sessionStorage，刷新当前 tab 后丢失，新 tab 独立，
 *   不污染 chrome.storage.local（用户基本不会期望"上次拖到右下角，下次新打开还在右下角"）。
 */
import {
  panel,
  panelGeometry,
  setPanelGeometry,
  type PanelGeometry,
} from './state';

const STORAGE_KEY = '__image_prompt_extractor_panel_geom__';
export const MIN_WIDTH = 360;
export const MIN_HEIGHT = 220;
export const VIEWPORT_MARGIN = 8;
export const SIDEBAR_WIDTH = 280;

/**
 * 用于 clamp 的布局盒：优先 Visual Viewport（移动端地址栏、软键盘、 pinch-zoom），
 * 与 `window.innerWidth/innerHeight` 不一致时避免面板被「夹到」不可见区域。
 */
export function getLayoutViewportBox(): {
  width: number;
  height: number;
  originLeft: number;
  originTop: number;
} {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv && vv.width > 0 && vv.height > 0) {
    return {
      width: vv.width,
      height: vv.height,
      originLeft: vv.offsetLeft,
      originTop: vv.offsetTop,
    };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    originLeft: 0,
    originTop: 0,
  };
}

function readSession(): PanelGeometry | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (
      v &&
      typeof v.left === 'number' &&
      typeof v.top === 'number' &&
      (v.width === undefined || typeof v.width === 'number') &&
      (v.height === undefined || typeof v.height === 'number')
    ) {
      return v;
    }
  } catch {
    // sessionStorage 在某些 sandbox iframe 里会抛 SecurityError，忽略
  }
  return null;
}

function writeSession(g: PanelGeometry): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(g));
  } catch {
    // 同上：忽略 SecurityError / QuotaExceededError
  }
}

/**
 * 把任意几何 clamp 到当前视口范围内，避免被拖出屏幕或调到比视口还大。
 *
 * - width / height 上限：视口减去左右 / 上下各一个 margin
 * - left / top 上限：让面板至少有 32px 露在视口里（这里直接保留 margin 当下限）
 */
export function clampGeometry(g: PanelGeometry): PanelGeometry {
  const { width: vw, height: vh, originLeft, originTop } = getLayoutViewportBox();
  const w =
    g.width !== undefined
      ? Math.max(MIN_WIDTH, Math.min(g.width, vw - VIEWPORT_MARGIN * 2))
      : undefined;
  const h =
    g.height !== undefined
      ? Math.max(MIN_HEIGHT, Math.min(g.height, vh - VIEWPORT_MARGIN * 2))
      : undefined;
  // left / top 的可移动上限：保证整个面板（按当前 width / height 估算）至少有
  // 一小条留在视口里。如果 width/height 是 undefined，就用一个最小估值兜底。
  const estW = w ?? Math.min(720, vw - 48);
  const estH = h ?? Math.min(480, vh - 48);
  const minL = originLeft + VIEWPORT_MARGIN;
  const minT = originTop + VIEWPORT_MARGIN;
  const maxLeft = originLeft + vw - estW - VIEWPORT_MARGIN;
  const maxTop = originTop + vh - estH - VIEWPORT_MARGIN;
  const left = Math.max(minL, Math.min(g.left, Math.max(minL, maxLeft)));
  const top = Math.max(minT, Math.min(g.top, Math.max(minT, maxTop)));
  return { left, top, width: w, height: h };
}

/**
 * 取当前应用到面板上的几何：内存 → sessionStorage → 居中默认值。
 *
 * 居中默认值采用「水平居中、距顶 80px」，比 50/50 居中更舒服一点
 * （面板里图片缩略图占空间多，纯垂直居中容易让按钮区贴底）。
 */
export function ensureGeometry(): PanelGeometry {
  if (panelGeometry) return panelGeometry;
  const stored = readSession();
  if (stored) {
    const c = clampGeometry(stored);
    setPanelGeometry(c);
    return c;
  }
  const { width: vw, height: vh, originLeft, originTop } = getLayoutViewportBox();
  const defaultWidth = Math.min(720, vw - 48);
  const minL = originLeft + VIEWPORT_MARGIN;
  const minT = originTop + VIEWPORT_MARGIN;
  const left = Math.max(minL, Math.round(originLeft + (vw - defaultWidth) / 2));
  const top = Math.max(minT, Math.min(originTop + 80, Math.round(originTop + vh * 0.08)));
  const g: PanelGeometry = { left, top };
  setPanelGeometry(g);
  return g;
}

/**
 * 把几何写入到当前 panel 元素的 inline style。
 *
 * width / height 没设时显式抹掉对应的 inline style，让 CSS 默认值（包括
 * max-height）继续生效，从而保留"按内容自适应"的能力。
 */
export function applyGeometryToPanel(p: HTMLElement, g: PanelGeometry): void {
  p.style.left = `${g.left}px`;
  p.style.top = `${g.top}px`;
  if (g.width !== undefined) p.style.width = `${g.width}px`;
  else p.style.removeProperty('width');
  if (g.height !== undefined) p.style.height = `${g.height}px`;
  else p.style.removeProperty('height');
  p.classList.toggle('panel-locked-height', g.height !== undefined);
}

/**
 * 合并 patch 到模块级 panelGeometry，clamp 后写回 sessionStorage，
 * 并把结果应用到当前 panel 节点（如果存在）。
 *
 * 拖拽过程中频繁调用：拖动 = patch left/top；resize = patch width/height。
 */
export function updateGeometry(patch: Partial<PanelGeometry>): PanelGeometry {
  const base = panelGeometry ?? ensureGeometry();
  const merged: PanelGeometry = { ...base, ...patch };
  const clamped = clampGeometry(merged);
  setPanelGeometry(clamped);
  writeSession(clamped);
  if (panel) applyGeometryToPanel(panel, clamped);
  return clamped;
}

/**
 * 视口尺寸变化时调用一次，把当前几何 clamp 回安全范围。
 * 避免用户先把 panel 拉到 1800px 宽，再把浏览器窗口缩到 800px 后看不到 panel。
 */
export function reclampOnViewportChange(): void {
  if (!panelGeometry) return;
  const next = clampGeometry(panelGeometry);
  setPanelGeometry(next);
  writeSession(next);
  if (panel) applyGeometryToPanel(panel, next);
}

let reclampViewportRafQueued = false;

/**
 * 把视口 clamp 延后到下一帧：resize 拖拽会连续触发，合并到单次 rAF
 * 减少 clamp + sessionStorage + style 写入的抖动。
 */
export function scheduleReclampOnViewportChange(): void {
  if (reclampViewportRafQueued) return;
  reclampViewportRafQueued = true;
  requestAnimationFrame(() => {
    reclampViewportRafQueued = false;
    reclampOnViewportChange();
  });
}

// ── 侧栏展开 / 收起时自动调整面板宽度 ──────────────────────────────

let _sidebarLeftShift = 0;

/**
 * 侧栏展开时：面板向左扩展 SIDEBAR_WIDTH，编辑区保持原始大小。
 * 如果向左空间不足，剩余部分由 clampGeometry 向右扩展并截断。
 */
export function expandPanelForSidebar(): void {
  if (!panel) return;
  const base = panelGeometry ?? ensureGeometry();
  const { originLeft } = getLayoutViewportBox();
  const edgeMinLeft = originLeft + VIEWPORT_MARGIN;
  const currentWidth = base.width ?? panel.offsetWidth;
  const desiredLeft = base.left - SIDEBAR_WIDTH;
  const clampedLeft = Math.max(edgeMinLeft, desiredLeft);
  _sidebarLeftShift = base.left - clampedLeft;
  updateGeometry({ left: clampedLeft, width: currentWidth + SIDEBAR_WIDTH });
}

/**
 * 侧栏收起时：面板向右收缩 SIDEBAR_WIDTH，恢复到展开前的位置与宽度。
 */
export function collapsePanelForSidebar(): void {
  if (!panel) return;
  const base = panelGeometry ?? ensureGeometry();
  if (base.width === undefined) return;
  const newWidth = Math.max(MIN_WIDTH, base.width - SIDEBAR_WIDTH);
  updateGeometry({ left: base.left + _sidebarLeftShift, width: newWidth });
  _sidebarLeftShift = 0;
}
