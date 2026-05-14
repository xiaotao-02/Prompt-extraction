import type { RuntimeMessage, StrategyId } from '@/lib/types';
import { SETTINGS_KEY } from '@/lib/storage/keys';
import {
  renderPanel,
  renderPanelForExtractPending,
  updatePanel,
  closePanel,
  applyHistoryReady,
  applyStoredPromptStrategy,
} from './panel';
import { isExtensionContextValid, safeSendMessage } from '@/content/extensionBridge';

export { safeSendMessage } from '@/content/extensionBridge';

try {
  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'EXTRACT_PENDING') {
      renderPanelForExtractPending({
        requestId: message.payload.requestId,
        imageUrl: message.payload.imageUrl,
        strategy: message.payload.strategy,
      });
      return false;
    }
    if (message.type === 'EXTRACT_PROGRESS') {
      const patch: Parameters<typeof updatePanel>[1] = {};
      if (message.payload.stage !== undefined) patch.stage = message.payload.stage;
      if (message.payload.partial !== undefined) patch.partial = message.payload.partial;
      if (message.payload.strategy !== undefined) patch.strategy = message.payload.strategy;
      if (message.payload.provider !== undefined) patch.provider = message.payload.provider;
      if (message.payload.model !== undefined) patch.model = message.payload.model;
      updatePanel(message.payload.requestId, patch);
      return false;
    }
    if (message.type === 'EXTRACT_RESULT') {
      updatePanel(message.payload.requestId, {
        status: 'success',
        prompt: message.payload.prompt,
        provider: message.payload.provider,
        model: message.payload.model,
        partial: undefined,
        stage: undefined,
        extractBaselinePrompt: undefined,
      });
      return false;
    }
    if (message.type === 'EXTRACT_ERROR') {
      updatePanel(message.payload.requestId, {
        status: 'error',
        error: message.payload.error,
        partial: undefined,
        stage: undefined,
        extractBaselinePrompt: undefined,
      });
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
    if (message.type === 'PANEL_FROM_HISTORY') {
      // 从 popup / 提示词库「召回到悬浮窗」：数据必须由 background 随消息下发。
      // content script 内访问的 indexedDB 绑定的是当前网页源，不是 chrome-extension://，
      // 在页面里 getHistoryItem 永远读不到后台库，会静默失败、面板不出现。
      const { historyId, item } = message.payload;
      try {
        if (!item || item.id !== historyId) {
          console.warn('[PromptExtracto] PANEL_FROM_HISTORY: invalid payload', historyId);
          return false;
        }
        renderPanel({
          requestId: item.id,
          imageUrl: item.thumbnail || item.imageUrl,
          status: 'success',
          prompt: item.prompt,
          draft: item.prompt,
          provider: item.provider,
          model: item.model,
          versions: item.versions,
          versionsOpen: false,
        });
      } catch (err) {
        console.warn('[PromptExtracto] PANEL_FROM_HISTORY failed', err);
      }
      return false;
    }
    if (message.type === 'REFINE_PROGRESS') {
      // historyId 在面板里就是 requestId；只更新 refine 相关字段，保持 status='success' 不变。
      const patch: Parameters<typeof updatePanel>[1] = {};
      if (message.payload.stage !== undefined) patch.refineStage = message.payload.stage;
      if (message.payload.partial !== undefined) patch.refinePartial = message.payload.partial;
      updatePanel(message.payload.historyId, patch);
      return false;
    }
    return false;
  });
  chrome.storage.onChanged.addListener((changes, _area) => {
    const ch = changes[SETTINGS_KEY];
    if (!ch?.newValue || typeof ch.newValue !== 'object') return;
    const ps = (ch.newValue as { promptStrategy?: StrategyId }).promptStrategy;
    if (ps == null) return;
    applyStoredPromptStrategy(ps);
  });
} catch {
  // Extension context already invalidated at registration time
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
});

// ===================================================================
//  contextmenu 探测：补齐对 <video> / <canvas> / 内联 <svg> / CSS 背景图
//  以及"用 <video> 假装成 GIF"的现代动图（Twitter / Reddit / Discord
//  把 .gif 转成 mp4 的场景）的识别。
//
//  Chrome 原生只在用户右键 <img> 时才会触发 contexts: ['image'] 菜单，
//  所以我们必须在右键事件触发时：
//    1. 找出鼠标位置上最相关的"可视化媒体元素"
//    2. 如果是视频 → 抓当前帧到 canvas → toDataURL，喂给后台
//    3. 如果是 canvas/svg/背景图 → 序列化为 data URL
//    4. 然后通过 CTX_MENU_PREP 把这个 URL 缓存到后台，让 fallback
//       菜单显示出来；用户点击后 fallback 菜单优先用这个缓存。
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
      const url = captureMediaUrlAtPoint(ev);
      safeSendMessage(
        {
          type: 'CTX_MENU_PREP',
          payload: { imageUrl: url },
        } satisfies RuntimeMessage,
        () => void chrome.runtime.lastError
      );
    } catch (err) {
      console.debug('[PromptExtracto] ctxmenu prep failed', err);
    }
  },
  true
);

function captureMediaUrlAtPoint(ev: MouseEvent): string {
  const x = ev.clientX;
  const y = ev.clientY;
  const stack = elementsAtPoint(x, y);
  const target = ev.target instanceof Element ? ev.target : null;

  // <video> 优先：现代站点的"假 GIF"几乎全是 <video>。
  for (const el of stack) {
    if (el instanceof HTMLVideoElement && el.readyState >= 2) {
      const frame = captureVideoFrame(el);
      if (frame) return frame;
      // tainted 退路：直接交回 video src，让后台用 fetch 兜底
      return el.currentSrc || el.src || '';
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
  const targetIsImage =
    target instanceof HTMLImageElement || (target instanceof Element && target.tagName === 'SOURCE');
  if (targetIsImage) return '';
  for (const el of stack) {
    if (el instanceof HTMLImageElement) {
      // 不在 content 里 dataUrl 化：让后台 fetch 拿原图（多半命中浏览器缓存，
      // 比把整张图序列化进 message 倒一遍快得多），动图原始字节也得以保留。
      const src = el.currentSrc || el.src || '';
      if (src) return src;
    }
  }

  // <canvas>：很多动画 / 渲染场景（webgl 图表、游戏画面）走 canvas。
  for (const el of stack) {
    if (el instanceof HTMLCanvasElement) {
      try {
        return el.toDataURL('image/png');
      } catch {
        // tainted canvas，没辙
        return '';
      }
    }
  }

  // 内联 <svg>（图标、矢量插画）：序列化成 data:image/svg+xml
  for (const el of stack) {
    if (el instanceof SVGSVGElement) {
      try {
        const xml = new XMLSerializer().serializeToString(el);
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      } catch {
        // ignore
      }
    }
  }

  // CSS background-image / mask-image
  for (const el of stack) {
    if (!(el instanceof Element)) continue;
    const url = readCssBgUrl(el);
    if (url) return url;
  }

  return '';
}

function elementsAtPoint(x: number, y: number): Element[] {
  if (typeof document.elementsFromPoint === 'function') {
    return document.elementsFromPoint(x, y);
  }
  const el = document.elementFromPoint(x, y);
  return el ? [el] : [];
}

/**
 * 把 <video> 的当前帧抓到一张 JPEG dataUrl。
 * - 自动按最长边 1280px 缩放，避免 8MB 上限被触发
 * - 跨域 video 没有 crossorigin="anonymous" 时 canvas 会被污染，
 *   toDataURL 会抛 SecurityError，这里捕获并交还空串让上层走兜底
 */
function captureVideoFrame(video: HTMLVideoElement): string {
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
    // JPEG 体积小、被任何视觉 API 都支持
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
