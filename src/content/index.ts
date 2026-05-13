import type { RuntimeMessage } from '@/lib/types';
import { renderPanel, updatePanel, closePanel } from './panel';

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'EXTRACT_PENDING') {
    renderPanel({
      requestId: message.payload.requestId,
      imageUrl: message.payload.imageUrl,
      status: 'loading',
      stage: 'calling',
      startedAt: Date.now(),
      strategy: message.payload.strategy,
    });
    return false;
  }
  if (message.type === 'EXTRACT_PROGRESS') {
    // 只把"实际带值"的字段塞进 patch，避免后台只为通知 strategy 而发的
    // progress 把面板已经推进到的 stage / partial 重置回 undefined。
    const patch: Parameters<typeof updatePanel>[1] = {};
    if (message.payload.stage !== undefined) patch.stage = message.payload.stage;
    if (message.payload.partial !== undefined) patch.partial = message.payload.partial;
    if (message.payload.strategy !== undefined) patch.strategy = message.payload.strategy;
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
    });
    return false;
  }
  if (message.type === 'EXTRACT_ERROR') {
    updatePanel(message.payload.requestId, {
      status: 'error',
      error: message.payload.error,
      partial: undefined,
      stage: undefined,
    });
    return false;
  }
  return false;
});

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
      const url = captureMediaUrlAtPoint(ev);
      chrome.runtime.sendMessage(
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

  // <video> 优先：现代站点的"假 GIF"几乎全是 <video>。
  for (const el of stack) {
    if (el instanceof HTMLVideoElement && el.readyState >= 2) {
      const frame = captureVideoFrame(el);
      if (frame) return frame;
      // tainted 退路：直接交回 video src，让后台用 fetch 兜底
      return el.currentSrc || el.src || '';
    }
  }

  // GIF / APNG / WebP 这类动图通常是 <img>，原生 image 菜单本来就能命中，
  // 这里只在 *动图扩展名* 时主动接管 —— 因为我们后续会做"扁平化"，
  // 视觉模型对静态首帧的识别比动图本体可靠得多。
  for (const el of stack) {
    if (el instanceof HTMLImageElement) {
      // 让原生 image 菜单自己处理（返回空字符串 → fallback 隐藏）。
      // 不在 content 里 dataUrl 化，因为同源 <img> 的 srcUrl 后端再 fetch 即可，
      // 反而能保留原始动图供后台扁平化。
      void el; // 触发 lint，无副作用
      return '';
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

  // <picture> 内的 <source>，元素栈中通常已经有 <img>，这里兜底。
  for (const el of stack) {
    if (el instanceof HTMLElement && el.tagName === 'PICTURE') {
      const img = el.querySelector('img');
      if (img?.currentSrc || img?.src) return ''; // 同上，交给原生菜单
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
