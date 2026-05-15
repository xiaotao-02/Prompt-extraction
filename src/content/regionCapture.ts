import type { RegionCaptureConfirmPayload } from '@/lib/types';
import { safeSendMessage } from '@/content/extensionBridge';

const ROOT_ID = 'pe-region-capture-root';
/** 过小视为误触 */
const MIN_EDGE = 12;

let disposeActive: (() => void) | null = null;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalizeRect(ax: number, ay: number, bx: number, by: number) {
  const left = clamp(Math.min(ax, bx), 0, window.innerWidth);
  const top = clamp(Math.min(ay, by), 0, window.innerHeight);
  const right = clamp(Math.max(ax, bx), 0, window.innerWidth);
  const bottom = clamp(Math.max(ay, by), 0, window.innerHeight);
  const width = right - left;
  const height = bottom - top;
  if (width < MIN_EDGE || height < MIN_EDGE) return null;
  return { x: left, y: top, width, height };
}

function buildPayload(rect: NonNullable<ReturnType<typeof normalizeRect>>): RegionCaptureConfirmPayload {
  return {
    ...rect,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  };
}

/**
 * 仅在顶层框架调用：全屏拖拽选框，松开后在下一帧投递裁剪请求（避免遮罩残留在截图里）。
 */
export function startRegionCaptureFromExtension(): void {
  if (window.top !== window) return;
  disposeActive?.();

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.setAttribute('data-pe-region-capture', '1');
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    cursor: 'crosshair',
    userSelect: 'none',
    touchAction: 'none',
    boxSizing: 'border-box',
  } as CSSStyleDeclaration & { msUserSelect?: string });

  const hint = document.createElement('div');
  hint.textContent = '拖拽选取区域 · 松开完成 · Esc 退出';
  Object.assign(hint.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    padding: '8px 14px',
    borderRadius: '10px',
    fontFamily: 'system-ui,sans-serif',
    fontSize: '13px',
    fontWeight: '600',
    color: '#fafafa',
    background: 'rgba(15,15,25,0.82)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'absolute',
    pointerEvents: 'none',
    border: '2px solid rgba(255,255,255,0.95)',
    borderRadius: '2px',
    boxShadow:
      '0 0 0 1px rgba(0,0,0,0.35) inset, 0 0 0 9999px rgba(0,0,0,0.42)',
    display: 'none',
  });

  root.append(box, hint);

  let startX = 0;
  let startY = 0;
  let dragging = false;
  let curX = 0;
  let curY = 0;

  const updateBox = (ax: number, ay: number, bx: number, by: number) => {
    const r = normalizeRect(ax, ay, bx, by);
    if (!r) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    box.style.left = `${r.x}px`;
    box.style.top = `${r.y}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
  };

  const removeUiOnly = () => {
    window.removeEventListener('keydown', onKeydown, true);
    root.removeEventListener('pointerdown', onPointerDown, true);
    root.removeEventListener('pointermove', onPointerMove, true);
    root.removeEventListener('pointerup', onPointerUp, true);
    root.removeEventListener('pointercancel', onPointerCancel, true);
    hint.remove();
    box.remove();
    root.remove();
  };

  const fullDispose = () => {
    removeUiOnly();
    disposeActive = null;
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    fullDispose();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    curX = startX;
    curY = startY;
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    box.style.display = 'block';
    updateBox(startX, startY, startX, startY);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    e.preventDefault();
    curX = e.clientX;
    curY = e.clientY;
    updateBox(startX, startY, curX, curY);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging || e.button !== 0) return;
    dragging = false;
    e.preventDefault();
    curX = e.clientX;
    curY = e.clientY;

    const r = normalizeRect(startX, startY, curX, curY);
    if (!r) {
      fullDispose();
      return;
    }

    const payload = buildPayload(r);

    removeUiOnly();
    disposeActive = null;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        safeSendMessage(
          {
            type: 'REGION_CAPTURE_CONFIRM',
            payload,
          },
          () => void chrome.runtime.lastError
        );
      });
    });
  };

  const onPointerCancel = () => {
    dragging = false;
    fullDispose();
  };

  window.addEventListener('keydown', onKeydown, true);
  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('pointermove', onPointerMove, true);
  root.addEventListener('pointerup', onPointerUp, true);
  root.addEventListener('pointercancel', onPointerCancel, true);

  disposeActive = fullDispose;
  document.documentElement.append(root);
}

export function abortRegionCaptureIfActive(): boolean {
  if (!disposeActive) return false;
  disposeActive();
  return true;
}
