import '@/styles/globals.css';
import { useEffect, useLayoutEffect, useRef, useState, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { installChromePreviewShim } from './chromeShim';
import {
  ensurePreviewLibrarySeed,
  PREVIEW_DEMO_PANEL_DEFAULT_ID,
} from './seedPreviewLibrary';
import { historyItemToPanelPreviewState } from './historyToPanelPreviewState';
import type { HistoryItem } from '@/lib/types';
import { getHistoryItem } from '@/lib/storage';
import { STYLE } from '@/content/panel/styles';
import { panelHtml } from '@/content/panel/templates';
import type { PanelState } from '@/content/panel/state';
import { setCurrentState, setPanel, panelActions, panel } from '@/content/panel/state';
import {
  bindEvents,
  updateDirtyChromeImmediate,
  cancelPendingDirtyChromeDeferred,
} from '@/content/panel/events';
import {
  manageLoadingTicker,
  manageLoadingStallWatchdog,
  manageRefineTicker,
  stopLoadingTicker,
  stopLoadingStallWatchdog,
  stopRefineTicker,
} from '@/content/panel/loading';

installChromePreviewShim();

/** 插在 STYLE 之后，仅开发预览 iframe：解除 `.panel` 的 fixed，便于外层 flex 居中。 */
const PREVIEW_PANEL_LAYOUT_CSS = `
.panel.panel--dev-preview {
  position: relative !important;
  top: auto !important;
  left: auto !important;
}`;

const RESIZE_DIRS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const;

function appendResizeHandles(p: HTMLElement): void {
  for (const d of RESIZE_DIRS) {
    const h = document.createElement('div');
    h.className = `resize-handle ${d}`;
    h.dataset.dir = d;
    p.appendChild(h);
  }
}

function previewRenderPanel(state: PanelState): void {
  setCurrentState(state);
  const root = panel;
  if (!root) return;
  const surface = root.querySelector<HTMLElement>('[data-role="panel-surface"]');
  if (!surface) return;
  surface.innerHTML = panelHtml(state);
  updateDirtyChromeImmediate();
  manageLoadingTicker(state);
  manageLoadingStallWatchdog(state);
  manageRefineTicker(state);
}

/** 预览不关 DOM，仅停定时器，避免 content `closePanel` 拆掉 iframe 内的面板节点。 */
function previewClosePanel(): void {
  cancelPendingDirtyChromeDeferred();
  stopLoadingTicker();
  stopLoadingStallWatchdog();
  stopRefineTicker();
}

panelActions.renderPanel = previewRenderPanel;
panelActions.closePanel = previewClosePanel;

/** `#focus=` 与 Options deep-link 对齐；`item=` 为别名。 */
function readPanelPreviewPreferredHistoryId(): string {
  const raw = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
  const params = new URLSearchParams(raw);
  const fromHash = params.get('focus')?.trim() || params.get('item')?.trim();
  return fromHash || PREVIEW_DEMO_PANEL_DEFAULT_ID;
}

async function fetchHistoryWithRetry(id: string): Promise<HistoryItem | null> {
  let item = await getHistoryItem(id);
  if (!item) {
    await new Promise((r) => setTimeout(r, 80));
    item = await getHistoryItem(id);
  }
  return item;
}

async function resolvePreviewPanelState(): Promise<PanelState | null> {
  await ensurePreviewLibrarySeed();
  const preferredId = readPanelPreviewPreferredHistoryId();
  let item = await fetchHistoryWithRetry(preferredId);
  if (!item && preferredId !== PREVIEW_DEMO_PANEL_DEFAULT_ID) {
    item = await fetchHistoryWithRetry(PREVIEW_DEMO_PANEL_DEFAULT_ID);
  }
  return item ? historyItemToPanelPreviewState(item) : null;
}

/** 生产级 `bindEvents` + shim 路由；不向 `document.documentElement` 挂宿主。 */
function PanelPeek({ panelState }: { panelState: PanelState }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const mount = hostRef.current;
    if (!mount) return;

    mount.innerHTML = '';
    mount.style.margin = '0 auto';
    mount.style.padding = '2rem';
    mount.style.boxSizing = 'border-box';

    const panelHost = document.createElement('div');
    panelHost.className =
      'min-h-[min(600px,calc(100vh-96px))] flex items-start justify-center bg-gradient-to-br from-indigo-200/40 via-zinc-100 to-violet-200/35 dark:from-indigo-900/35 dark:via-zinc-900 dark:to-violet-900/35';
    panelHost.style.colorScheme = 'light dark';

    const shadow = panelHost.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = STYLE + PREVIEW_PANEL_LAYOUT_CSS;
    shadow.appendChild(styleEl);

    const panelRoot = document.createElement('div');
    panelRoot.className = 'panel mounted panel--dev-preview';
    panelRoot.style.width = 'min(720px, calc(100vw - 96px))';
    panelRoot.style.margin = '48px auto 0';

    const surface = document.createElement('div');
    surface.dataset.role = 'panel-surface';
    panelRoot.appendChild(surface);
    appendResizeHandles(panelRoot);

    shadow.appendChild(panelRoot);
    mount.appendChild(panelHost);

    setPanel(panelRoot);
    previewRenderPanel(panelState);
    bindEvents(panelRoot);

    return () => {
      cancelPendingDirtyChromeDeferred();
      stopLoadingTicker();
      stopLoadingStallWatchdog();
      stopRefineTicker();
      setPanel(null);
      setCurrentState(null);
      mount.innerHTML = '';
    };
  }, [panelState]);

  return <div ref={hostRef} className="min-h-screen w-full" />;
}

function PanelPreviewApp(): JSX.Element {
  const [panelState, setPanelState] = useState<PanelState | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    void resolvePreviewPanelState().then((s) => {
      if (s) setPanelState(s);
      else setLoadError(true);
    });
  }, []);

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
        预览数据未就绪：IndexedDB 中找不到 `{PREVIEW_DEMO_PANEL_DEFAULT_ID}`（或 hash 指定的记录）。请清空库后刷新，或先打开 Popup 预览触发种子写入。
      </div>
    );
  }

  if (!panelState) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-sm text-zinc-500 dark:text-zinc-500">
        加载预览…
      </div>
    );
  }

  return <PanelPeek panelState={panelState} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PanelPreviewApp />
  </StrictMode>
);
