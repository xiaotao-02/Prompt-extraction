/**
 * 浮动面板对外的 3 个公开 API：renderPanel / updatePanel / closePanel。
 * 这是 src/content/index.ts 唯一引用到的入口。
 */
import { STYLE } from './styles';
import {
  HOST_ID,
  host,
  shadow,
  panel,
  currentState,
  setHost,
  setShadow,
  setPanel,
  setCurrentState,
  type PanelState,
} from './state';
import {
  manageLoadingTicker,
  stopLoadingTicker,
  applyLoadingPatch,
} from './loading';
import { panelHtml } from './templates';
import { bindEvents, syncVersions } from './events';

function ensureHost(): { host: HTMLDivElement; shadow: ShadowRoot } {
  if (host && shadow) return { host, shadow };
  const h = document.createElement('div');
  h.id = HOST_ID;
  h.style.cssText = `
    position: fixed; inset: 0;
    z-index: 2147483647; width: 0; height: 0;
    color-scheme: light dark;
  `;
  const s = h.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  s.appendChild(style);
  document.documentElement.appendChild(h);
  setHost(h);
  setShadow(s);
  return { host: h, shadow: s };
}

export function renderPanel(state: PanelState): void {
  const { shadow } = ensureHost();
  setCurrentState(state);
  if (panel) panel.remove();
  const next = document.createElement('div');
  next.className = 'panel';
  next.innerHTML = panelHtml(state);
  shadow.appendChild(next);
  setPanel(next);
  bindEvents(next);
  manageLoadingTicker(state);
}

export function updatePanel(requestId: string, patch: Partial<PanelState>): void {
  if (!currentState || currentState.requestId !== requestId) return;
  const prev = currentState;
  const merged = { ...prev, ...patch } as PanelState;
  setCurrentState(merged);

  if (patch.status === 'success') {
    void syncVersions(requestId);
  }

  const lightUpdate =
    prev.status === 'loading' &&
    merged.status === 'loading' &&
    patch.status === undefined &&
    (patch.stage !== undefined ||
      patch.partial !== undefined ||
      patch.strategy !== undefined);

  if (lightUpdate && panel) {
    applyLoadingPatch(merged);
    manageLoadingTicker(merged);
    return;
  }
  renderPanel(merged);
}

export function closePanel(): void {
  stopLoadingTicker();
  if (panel) {
    panel.remove();
    setPanel(null);
  }
  setCurrentState(null);
}
