import type { OneClickRewriteRandomness, RuntimeMessage, StrategyId } from '@/lib/types';
import { postCtxMenuPrepViaKeepalivePort } from '@/content/bgPort';
import { normalizeOneClickRewriteRandomness } from '@/lib/oneClickRewrite';
import { SETTINGS_KEY } from '@/lib/storage/keys';
import {
  renderPanel,
  renderPanelForExtractPending,
  applyExtractStreamProgress,
  applyExtractStreamResult,
  applyExtractStreamError,
  patchRefineProgress,
  closePanel,
  applyHistoryReady,
  applyHistoryPrefetch,
  applyStoredPromptStrategy,
  applyStoredRewriteRandomness,
  appendReferenceFromBackground,
} from './panel';
import { expandPanelForSidebar } from './panel/geometry';
import { startRegionCaptureFromExtension, abortRegionCaptureIfActive } from '@/content/regionCapture';
import { isExtensionContextValid, safeSendMessage } from '@/content/extensionBridge';

export { safeSendMessage } from '@/content/extensionBridge';

try {
  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === 'START_REGION_CAPTURE') {
      if (window.top !== window) {
        sendResponse({ ok: false, skipped: true });
        return false;
      }
      startRegionCaptureFromExtension();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'EXTRACT_PENDING') {
      renderPanelForExtractPending({
        requestId: message.payload.requestId,
        imageUrl: message.payload.imageUrl,
        imageUrls: message.payload.imageUrls,
        strategy: message.payload.strategy,
        rewriteRandomness: message.payload.oneClickRewriteRandomness,
      });
      return false;
    }
    if (message.type === 'EXTRACT_PROGRESS') {
      applyExtractStreamProgress(message.payload.requestId, {
        stage: message.payload.stage,
        partial: message.payload.partial,
        strategy: message.payload.strategy,
        provider: message.payload.provider,
        model: message.payload.model,
        rewriteRandomness: message.payload.oneClickRewriteRandomness,
      });
      return false;
    }
    if (message.type === 'EXTRACT_RESULT') {
      applyExtractStreamResult(message.payload.requestId, {
        prompt: message.payload.prompt,
        provider: message.payload.provider,
        model: message.payload.model,
      });
      return false;
    }
    if (message.type === 'EXTRACT_ERROR') {
      applyExtractStreamError(message.payload.requestId, message.payload.error);
      return false;
    }
    if (message.type === 'HISTORY_READY') {
      // 把面板持有的 requestId 切到 storage 真实落地的 actualId（同图反推时它们会不同），
      // 同步填充 versions 和 prompt，从根上消灭 "save / restore 静默失败" 这类竞态 bug。
      applyHistoryReady(
        message.payload.requestId,
        message.payload.actualId,
        message.payload.versions,
        message.payload.prompt
      );
      return false;
    }
    if (message.type === 'HISTORY_PREFETCH') {
      const p = message.payload;
      applyHistoryPrefetch(p.requestId, {
        storageId: p.storageId,
        versions: p.versions,
        prompt: p.prompt,
      });
      return false;
    }
    if (message.type === 'PANEL_APPEND_REFERENCE') {
      appendReferenceFromBackground(message.payload.imageUrl);
      return false;
    }
    if (message.type === 'PANEL_FROM_HISTORY') {
      // 从 popup / 提示词库「召回到悬浮窗」：数据必须由 background 随消息下发。
      // content script 内访问的 indexedDB 绑定的是当前网页源，不是 chrome-extension://，
      // 在页面里 getHistoryItem 永远读不到后台库，会静默失败、面板不出现。
      const { historyId, item, dock } = message.payload;
      try {
        if (!item || item.id !== historyId) {
          console.warn('[PromptExtracto] PANEL_FROM_HISTORY: invalid payload', historyId);
          return false;
        }
        const versionsOpen = dock === 'versions';
        const refineOpen = dock === 'refine';
        const imageUrls =
          item.imageUrls?.length ? item.imageUrls : [item.thumbnail || item.imageUrl || ''];
        const primary = imageUrls[0] || item.imageUrl;
        renderPanel({
          requestId: item.id,
          imageUrl: primary,
          imageUrls,
          status: 'success',
          prompt: item.prompt,
          draft: item.prompt,
          provider: item.provider,
          model: item.model,
          versions: item.versions,
          strategy: item.strategy,
          rewriteRandomness: normalizeOneClickRewriteRandomness(
            message.payload.oneClickRewriteRandomness
          ),
          versionsOpen,
          ...(refineOpen ? { refineOpen: true } : {}),
        });
        if (versionsOpen) {
          requestAnimationFrame(() => expandPanelForSidebar());
        }
      } catch (err) {
        console.warn('[PromptExtracto] PANEL_FROM_HISTORY failed', err);
      }
      return false;
    }
    if (message.type === 'REFINE_PROGRESS') {
      patchRefineProgress({
        historyId: message.payload.historyId,
        refineJobId: message.payload.refineJobId,
        stage: message.payload.stage,
        partial: message.payload.partial,
      });
      return false;
    }
    return false;
  });
  chrome.storage.onChanged.addListener((changes, _area) => {
    const ch = changes[SETTINGS_KEY];
    if (!ch?.newValue || typeof ch.newValue !== 'object') return;
    const nv = ch.newValue as {
      promptStrategy?: StrategyId;
      oneClickRewriteRandomness?: OneClickRewriteRandomness;
    };
    const ps = nv.promptStrategy;
    const rr = nv.oneClickRewriteRandomness;
    if (ps != null) applyStoredPromptStrategy(ps);
    if (rr != null) applyStoredRewriteRandomness(normalizeOneClickRewriteRandomness(rr));
  });
} catch {
  // Extension context already invalidated at registration time
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (abortRegionCaptureIfActive()) return;
    closePanel();
  }
});

// ===================================================================
//  contextmenu 探测：补齐对 <video> / <canvas> / 内联 <svg> / CSS 背景图
//  以及"用 <video> 假装成 GIF"的现代动图（Twitter / Reddit / Discord
//  把 .gif 转成 mp4 的场景）的识别。
//
//  Chrome 原生在 <img>（image）与 <video>（video）上会出扩展的常驻菜单项；
//  但遮罩 / pointer-events / 未缓冲视频等仍需要 fallback，因此我们必须在右键时：
//    1. 找出鼠标位置上最相关的"可视化媒体元素"
//    2. 如果是视频 → 抓当前帧到 canvas → toDataURL，喂给后台
//    3. 如果是 canvas/svg/背景图 → 序列化为 data URL
//    4. 然后通过 CTX_MENU_PREP 把 extractionUrl + showFallback 发到后台：
//       tab 级缓存总是写入（哪怕 showFallback:false，用于原生 `<video>`
//       菜单点击时优先用抓拍 JPEG）；showFallback 只控制兜底菜单。
//
//  注意：必须用 capture phase，避免站点自己 stopPropagation；
//  并且整个 prep 流程必须尽量同步完成（不 await 网络），因为 Chrome
//  会在 contextmenu 事件结束后非常快地弹出原生菜单，菜单一旦显示
//  contextMenus.update 就来不及了。
// ===================================================================

window.addEventListener(
  'contextmenu',
  (ev: MouseEvent) => {
    try {
      if (!isExtensionContextValid()) return;
      const payload = computeCtxMenuPrep(ev);
      postCtxMenuPrepViaKeepalivePort(payload);
      safeSendMessage(
        {
          type: 'CTX_MENU_PREP',
          payload,
        } satisfies RuntimeMessage,
        () => void chrome.runtime.lastError
      );
    } catch (err) {
      console.debug('[PromptExtracto] ctxmenu prep failed', err);
    }
  },
  true
);

/** 全页扫描上限，避免超重型瀑布流一次右键卡死主线程 */
const RECT_HIT_MAX_NODES = 2000;
/** 忽略过小的占位/追踪图，避免矩形命中误选 */
const RECT_HIT_MIN_EDGE = 8;

type CtxMenuPrepResult = { extractionUrl: string; showFallback: boolean };

/** `composedPath` + `elementsFromPoint` 合并，减轻 Shadow / 层叠上下文下的漏检。 */
function hitStack(ev: MouseEvent, x: number, y: number): Element[] {
  const fromPoint =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(x, y)
      : (() => {
          const hit = document.elementFromPoint(x, y);
          return hit ? [hit] : [];
        })();

  let fromComposed: Element[] = [];
  if (typeof ev.composedPath === 'function') {
    try {
      fromComposed = ev
        .composedPath()
        .filter((node): node is Element => node instanceof Element);
    } catch {
      fromComposed = [];
    }
  }

  const seen = new Set<Element>();
  const out: Element[] = [];
  const push = (el: Element) => {
    if (seen.has(el)) return;
    seen.add(el);
    out.push(el);
  };

  // composedPath（事件路径）先于视口自上而下命中栈——通常对用户「点中了谁」更准确
  for (const el of fromComposed) push(el);
  for (const el of fromPoint) push(el);

  return out;
}

function resolveVideoPosterUrl(video: HTMLVideoElement): string {
  const raw = video.getAttribute('poster')?.trim() || '';
  if (!raw) return '';
  const base = video.ownerDocument?.baseURI ?? (typeof location !== 'undefined' ? location.href : '');
  try {
    return new URL(raw, base || undefined).href;
  } catch {
    try {
      return base ? new URL(raw, base).href : raw;
    } catch {
      return raw;
    }
  }
}

/**
 * video 解码帧 → JPEG；失败后依次 poster、`currentSrc`。
 */
function extractVideoBestUrl(video: HTMLVideoElement): string {
  const frame = captureVideoFrame(video);
  if (frame) return frame;
  const poster = resolveVideoPosterUrl(video);
  if (poster) return poster;
  return video.currentSrc || video.src || '';
}

/** Chrome 会认为属于原生 image 上下文的右键 target；这类情况不写 fallback 兜底菜单以免重复入口。 */
function isNativeMediaContextSurface(target: Element | null): boolean {
  if (!target) return false;
  if (target instanceof HTMLImageElement) return true;
  const tag = target.tagName;
  return tag === 'SOURCE' || tag === 'PICTURE';
}

/** 右键位置综合探测：返回值同时驱动 tab 缓存与兜底菜单 visibility。 */
function computeCtxMenuPrep(ev: MouseEvent): CtxMenuPrepResult {
  const x = ev.clientX;
  const y = ev.clientY;
  const stack = hitStack(ev, x, y);
  const target = ev.target instanceof Element ? ev.target : null;

  // 直接点到 <video>：原生 video 上下文 + 「添加到参考」菜单项；不写 showFallback；仍缓存抓拍 JPEG 供菜单点击优于 srcUrl。
  if (target instanceof HTMLVideoElement) {
    return {
      extractionUrl: extractVideoBestUrl(target),
      showFallback: false,
    };
  }

  // <video> 优先（遮罩、「假 GIF」video）
  for (const el of stack) {
    if (el instanceof HTMLVideoElement) {
      const url = extractVideoBestUrl(el);
      if (url) return { extractionUrl: url, showFallback: true };
    }
  }

  // <img> 分两种命中模式：
  //
  //   A. 右键直接命中 <img>（event.target 本身是 img，或是 <picture> 里的 <source>
  //      ——后者 Chrome 仍会按图像上下文菜单处理）→ 原生 image 菜单会自动弹出，
  //      返回空串让 fallback 菜单保持隐藏，避免和原生菜单重复。
  //
  //   B. <img> 被透明 overlay 罩住 ——
  //      Behance / Pinterest / Dribbble / Unsplash / 各种作品集站点惯用做法：
  //      在 <img> 之上盖一个吃指针事件的 <div>，目的是拦截"另存为/拖拽下载"。
  //      这种情况下 contextmenu 的 target 是上层 div，Chrome 不会判定为 image
  //      上下文，原生菜单不出；如果我们这里再傻乎乎返回空串，fallback 菜单也
  //      被藏起来，用户就什么入口都看不到（这就是"Behance 上右键失效"的根因）。
  //      所以这里主动把被覆盖的 <img> 的 currentSrc 抛给后台，让 fallback 菜单
  //      显示。currentSrc 比 src 更准确——能拿到 srcset 实际选中的那张分辨率。
  //      栈里多张图时取包围盒面积较小者，减轻瀑布流重叠时的误选。
  //      点到 `<picture>` 外层等价于结构化图片上下文，亦不写兜底。
  //
  if (isNativeMediaContextSurface(target)) return { extractionUrl: '', showFallback: false };

  const imgsInStack: HTMLImageElement[] = [];
  for (const el of stack) {
    if (el instanceof HTMLImageElement) imgsInStack.push(el);
  }
  if (imgsInStack.length > 0) {
    const pick =
      imgsInStack.length === 1
        ? imgsInStack[0]
        : imgsInStack.reduce((a, b) =>
            rectArea(a.getBoundingClientRect()) <= rectArea(b.getBoundingClientRect()) ? a : b
          );
    const src = pick.currentSrc || pick.src || '';
    if (src) return { extractionUrl: src, showFallback: true };
  }

  // <canvas>：很多动画 / 渲染场景（webgl 图表、游戏画面）走 canvas。
  for (const el of stack) {
    if (el instanceof HTMLCanvasElement) {
      try {
        return { extractionUrl: el.toDataURL('image/png'), showFallback: true };
      } catch {
        // tainted canvas，没辙
        return { extractionUrl: '', showFallback: false };
      }
    }
  }

  // 内联 <svg>（图标、矢量插画）：序列化成 data:image/svg+xml
  for (const el of stack) {
    if (el instanceof SVGSVGElement) {
      try {
        const xml = new XMLSerializer().serializeToString(el);
        return {
          extractionUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`,
          showFallback: true,
        };
      } catch {
        // ignore
      }
    }
  }

  // CSS background-image / mask-image
  for (const el of stack) {
    if (!(el instanceof Element)) continue;
    const url = readCssBgUrl(el);
    if (url) return { extractionUrl: url, showFallback: true };
  }

  // <video> 设了 pointer-events:none、或不在命中栈里时，用矩形命中兜底。
  const fromRect = pickMediaUrlByRectHit(x, y);
  if (fromRect) return { extractionUrl: fromRect, showFallback: true };

  return { extractionUrl: '', showFallback: false };
}

function rectArea(r: DOMRectReadOnly): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function rectContainsClientPoint(r: DOMRectReadOnly, x: number, y: number): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function isRoughlyInViewport(r: DOMRectReadOnly): boolean {
  const h = window.innerHeight;
  const w = window.innerWidth;
  return r.bottom > 0 && r.top < h && r.right > 0 && r.left < w;
}

/**
 * 在视口内、包含点击点的 video/img 中，取包围盒面积最小者；含一层 open ShadowRoot。
 */
function pickMediaUrlByRectHit(x: number, y: number): string {
  const candidates = collectVideoImgRoots(document);
  let bestEl: HTMLVideoElement | HTMLImageElement | undefined;
  let bestArea = Infinity;

  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (r.width < RECT_HIT_MIN_EDGE || r.height < RECT_HIT_MIN_EDGE) continue;
    if (!isRoughlyInViewport(r)) continue;
    if (!rectContainsClientPoint(r, x, y)) continue;
    const area = rectArea(r);
    if (area < bestArea) {
      bestArea = area;
      bestEl = el;
    }
  }

  if (!bestEl) return '';
  if (bestEl instanceof HTMLVideoElement) {
    return extractVideoBestUrl(bestEl);
  }
  return bestEl.currentSrc || bestEl.src || '';
}

function collectVideoImgRoots(top: Document | ShadowRoot): (HTMLVideoElement | HTMLImageElement)[] {
  const out: (HTMLVideoElement | HTMLImageElement)[] = [];
  let seenMedia = 0;
  let hostScan = 0;
  const MAX_HOST_SCAN = 4000;

  const visitRoot = (root: Document | ShadowRoot): void => {
    root.querySelectorAll('video, img').forEach((el) => {
      if (!(el instanceof HTMLVideoElement || el instanceof HTMLImageElement)) return;
      if (seenMedia >= RECT_HIT_MAX_NODES) return;
      seenMedia += 1;
      out.push(el);
    });

    if (seenMedia >= RECT_HIT_MAX_NODES) return;

    for (const host of root.querySelectorAll('*')) {
      if (hostScan >= MAX_HOST_SCAN || seenMedia >= RECT_HIT_MAX_NODES) return;
      hostScan += 1;
      const sr = host.shadowRoot;
      if (sr?.mode !== 'open') continue;
      visitRoot(sr);
    }
  };

  visitRoot(top);
  return out;
}

/**
 * 把 <video> 的当前帧抓到一张 JPEG dataUrl。
 * - 自动按最长边 1280px 缩放，避免 8MB 上限被触发
 * - HAVE_CURRENT_DATA 之前不 draw，便于走 poster / srcUrl
 * - 跨域 video 无 CORS 时 canvas 污染 → 返回空串
 */
function captureVideoFrame(video: HTMLVideoElement): string {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return '';
  }

  const w = video.videoWidth || video.clientWidth;
  const h = video.videoHeight || video.clientHeight;
  if (!w || !h) return '';
  const longest = Math.max(w, h);
  const MAX = 1280;
  const scale = longest > MAX ? MAX / longest : 1;
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const off = document.createElement('canvas');
  off.width = cw;
  off.height = ch;
  const ctx = off.getContext('2d');
  if (!ctx) return '';
  try {
    ctx.drawImage(video, 0, 0, cw, ch);
    return off.toDataURL('image/jpeg', 0.9);
  } catch (err) {
    console.debug('[PromptExtracto] video frame capture tainted', err);
    return '';
  }
}

function readCssBgUrl(el: Element): string {
  let style: CSSStyleDeclaration;
  try {
    style = getComputedStyle(el);
  } catch {
    return '';
  }
  // 优先看 background-image，再看 mask-image / -webkit-mask-image
  const candidates = [
    style.backgroundImage,
    style.getPropertyValue('mask-image'),
    style.getPropertyValue('-webkit-mask-image'),
  ];
  for (const v of candidates) {
    if (!v || v === 'none') continue;
    const m = /url\((?:"|')?([^"')]+)(?:"|')?\)/.exec(v);
    if (m && m[1]) return m[1];
  }
  return '';
}
