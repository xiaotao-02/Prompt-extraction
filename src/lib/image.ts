/**
 * 图片处理工具：把任意图片源（http(s) / data: / blob:）规整成一份
 * 视觉大模型一定能吃下的 base64 dataURL。
 *
 * ## 设计哲学（v0.1.6 简化后）
 *
 * 回归原始版"下载 → base64 → 上传"的直链思路，**只保留"功能必需"的预处理**，
 * 不再做任何"性能优化型"的客户端图片操作。具体边界：
 *
 *   ✅ 保留（功能必需）：
 *     - 动图 / SVG 扁平化（{@link FLATTEN_TYPES}）：
 *       GIF / APNG / SVG 这几种格式被视觉 API 接受的程度参差不齐
 *       （OpenAI 仅看 GIF 首帧、Anthropic 不接受 GIF、几乎所有 API 都不接受 SVG），
 *       不在客户端栅格化为 JPEG 的话用户会直接看到"调用失败"。
 *     - 视频帧抓取：由 content script 的 `captureVideoFrameToDataUrl` 在右键事件里
 *       同步完成，到 background 时已经是 `data:image/jpeg;base64,…`，
 *       直接走 {@link tryFastDataUrl} 零拷贝返回。
 *
 *   ❌ 砍掉（纯性能优化，反而拖慢识图速度）：
 *     - 大图近无损降采样（之前的 tryShrinkLossless）：
 *       视觉 API 那侧本来就会做自己的 resize，本地多缩一次的收益
 *       （几个 token / 几十 KB 上传）远低于 createImageBitmap + canvas 重编码
 *       要花的 200–800ms，且 PNG 重编码常常体积反而更大被丢弃。
 *     - WebP 扁平化：现代视觉 API（OpenAI / Anthropic / Gemini / 智谱 / Qwen-VL）
 *       全部接受 image/webp，没有理由再在客户端把它转 JPEG。
 *
 *   ⚪ 边界（按需保留）：
 *     - {@link makeStorageThumbnail} 仍保留，用于把右键抓到的大 dataUrl
 *       压成 ≤32KB 的小缩略图存进 chrome.storage.local，避免 5MB 配额被撑爆。
 *       这条不在识图主链路上，是历史落库的辅助功能。
 */
export interface FetchedImage {
  dataUrl: string;
  base64: string;
  mediaType: string;
  byteLength: number;
  /** 如果做过扁平化，会记录原始 MIME，便于调用方提示用户 */
  originalMediaType?: string;
}

/** 多数视觉 API 的 base64 上限 5–20MB；这里取个保守值，超了直接抛错让用户感知。 */
const MAX_BYTES = 8 * 1024 * 1024;
/** 扁平化输出的最长边。GIF / SVG 解码后尺寸可能很大，给它一个温和的上限。 */
const FLATTEN_MAX_DIM = 1536;

/**
 * 哪些 MIME 必须在客户端扁平化为静态 JPEG 才能上传。
 *
 *   - image/gif、image/apng：天然动画格式
 *     OpenAI 仅识别首帧；Anthropic Claude 直接 400；国产平台几乎都不收。
 *   - image/svg+xml：矢量图
 *     主流视觉 API 几乎没有原生支持 SVG 的，必须栅格化。
 *
 * **不在此列**的 MIME（含 image/webp / image/avif / image/png / image/jpeg）
 * 全部原样上传 —— 现代视觉 API 都已经支持它们，砍掉对应预处理能在主链路上
 * 省 100–500ms 的客户端开销。
 */
const FLATTEN_TYPES = new Set([
  'image/gif',
  'image/apng',
  'image/svg+xml',
]);

export async function fetchImageAsBase64(imageUrl: string): Promise<FetchedImage> {
  // 快速路径：content script 已经把视频帧 / canvas 序列化为 data:image/jpeg;base64,…
  // 时直接拆出 base64 段返回，跳过 atob → Blob → FileReader 的脱壳穿衣。
  if (imageUrl.startsWith('data:')) {
    const fast = tryFastDataUrl(imageUrl);
    if (fast) return fast;
  }
  const { blob, mediaType } = await loadBlob(imageUrl);
  return normalizeForVisionApi(blob, mediaType);
}

/**
 * 尝试把一条 `data:image/...;base64,…` URL 直通成 FetchedImage，跳过所有解码 / 重编码。
 *
 * 命中条件（任一不满足都返回 null 走完整路径）：
 *   1. 必须是 base64 编码的 data URL
 *   2. mediaType 必须是图像类型，且不在 {@link FLATTEN_TYPES} 里（动图 / SVG 仍需扁平化）
 *   3. 解码后估算字节数 ≤ {@link MAX_BYTES}（否则后续会走错误分支并抛错给用户）
 */
function tryFastDataUrl(url: string): FetchedImage | null {
  const match = /^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/i.exec(url);
  if (!match) return null;
  const mediaType = match[1].toLowerCase();
  const base64 = match[2];
  if (!mediaType.startsWith('image/')) return null;
  if (FLATTEN_TYPES.has(mediaType)) return null;

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const approxBytes = Math.floor(base64.length * 0.75) - padding;
  if (approxBytes > MAX_BYTES) {
    throw new Error(
      `图片过大（${(approxBytes / 1024 / 1024).toFixed(
        1
      )}MB），请使用更小的图片或缩略图`
    );
  }

  return {
    dataUrl: url,
    base64,
    mediaType,
    byteLength: approxBytes,
  };
}

async function loadBlob(imageUrl: string): Promise<{ blob: Blob; mediaType: string }> {
  // data: 协议直接解析（用 fetch 解析 data URL 比手写 atob 更省事，且自带 RFC 校验）
  if (imageUrl.startsWith('data:')) {
    const resp = await fetch(imageUrl);
    const blob = await resp.blob();
    const mediaType = blob.type || 'application/octet-stream';
    return { blob, mediaType };
  }

  const resp = await fetch(imageUrl, { credentials: 'omit' });
  if (!resp.ok) {
    throw new Error(`下载图片失败：HTTP ${resp.status}`);
  }
  const blob = await resp.blob();
  const mediaType = blob.type || guessMimeFromUrl(imageUrl) || 'image/jpeg';
  return { blob, mediaType };
}

function guessMimeFromUrl(url: string): string {
  const m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url);
  if (!m) return '';
  const ext = m[1].toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    apng: 'image/apng',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
  };
  return map[ext] || '';
}

/**
 * 视觉 API 适配层（已极简化）：
 *   - 视频流：直接抛错（content script 没拦下来意味着没法在 service worker 里抓帧）
 *   - {@link FLATTEN_TYPES} 中的 MIME：栅格化为 JPEG（GIF/APNG/SVG 必需）
 *   - 其它一切（PNG / JPEG / WebP / AVIF / BMP …）：**原样直传**，零客户端加工
 */
async function normalizeForVisionApi(
  blob: Blob,
  mediaType: string
): Promise<FetchedImage> {
  let finalBlob = blob;
  let finalType = mediaType;
  let originalType: string | undefined;

  if (mediaType.startsWith('video/')) {
    // service worker 里没有 <video> 元素，无法解码视频帧。
    // 这种情况一般是 content script 没能预处理（比如 chrome:// / about: 页面）。
    throw new Error(
      '当前命中的是视频流，请把鼠标移到正在播放的视频画面上再右键，让插件抓取当前帧。'
    );
  }

  if (FLATTEN_TYPES.has(mediaType)) {
    const flat = await tryFlatten(blob);
    if (flat) {
      originalType = mediaType;
      finalBlob = flat;
      finalType = 'image/jpeg';
    }
    // tryFlatten 返回 null 表示降级，继续走原 blob —— 即便服务端只能看到
    // 首帧或 SVG 原文，至少把请求送出去一次让用户看到模型的真实反馈。
  }

  if (finalBlob.size > MAX_BYTES) {
    throw new Error(
      `图片过大（${(finalBlob.size / 1024 / 1024).toFixed(
        1
      )}MB），请使用更小的图片或缩略图`
    );
  }

  const dataUrl = await blobToDataUrl(finalBlob, finalType);
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
  return {
    dataUrl,
    base64,
    mediaType: finalType,
    byteLength: finalBlob.size,
    originalMediaType: originalType,
  };
}

/**
 * 通过 FileReader 把 Blob 异步读成 `data:<mime>;base64,<...>`。
 *
 * 为什么不用 `arrayBuffer() + btoa`：后者在 service worker 主线程上是
 * 同步阻塞，5–8MB 图能阻塞 100~500ms，期间所有 chrome.runtime / contextMenus
 * 消息都会排队，连续抽图时第二张明显"卡一拍"。FileReader 在 Chrome service
 * worker 里是支持的，且 readAsDataURL 内部走线程池。
 *
 * 当 blob.type 与目标 mime 不一致（例如扁平化后输出是 image/jpeg 但 blob 还是
 * image/png），用 `new Blob([blob], { type: mediaType })` 重新包一下确保 dataUrl
 * 头部 mime 正确。
 */
function blobToDataUrl(blob: Blob, mediaType: string): Promise<string> {
  if (typeof FileReader === 'undefined') {
    // 极端环境兜底：退回同步路径
    return blob.arrayBuffer().then((buf) => {
      const base64 = arrayBufferToBase64(buf);
      return `data:${mediaType};base64,${base64}`;
    });
  }
  const target = blob.type === mediaType ? blob : new Blob([blob], { type: mediaType });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(target);
  });
}

/**
 * 把动图 / 矢量图扁平化为一张静态 JPEG。
 *
 * 失败时返回 null，调用方继续用原始 blob 兜底。
 *
 * 这是当前文件里**唯一保留**的"客户端图像加工"路径，因为不做就送不上去
 * （GIF / APNG / SVG 在多数视觉 API 那里要么 400 要么只看首帧）。
 */
async function tryFlatten(blob: Blob): Promise<Blob | null> {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas === 'undefined'
  ) {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (err) {
    console.debug('[PromptExtracto] createImageBitmap failed', err);
    return null;
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > FLATTEN_MAX_DIM ? FLATTEN_MAX_DIM / longest : 1;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // 一些动图 / SVG 没有底色，导出 JPEG 会变黑，先垫一层白底
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return out;
  } catch (err) {
    console.debug('[PromptExtracto] flatten draw failed', err);
    return null;
  } finally {
    try {
      bitmap.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 兜底用的同步 base64 转换。
 *
 * 主路径已切到 FileReader.readAsDataURL（异步、走线程池），这里只在
 * service worker 里没有 FileReader 这种极端环境里才会被走到。
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  return btoa(binary);
}

/**
 * 给"提示词库 / 历史记录"用的缩略图生成器。
 *
 * 当用户右键的是视频帧 / canvas / 扁平化后的动图时，imageUrl 进来是
 * 一个上百 KB ~ 数 MB 的 data:image/... base64 字符串。如果原样塞进
 * chrome.storage.local（5MB 配额，HISTORY_LIMIT=300），几条就能撑爆配额。
 *
 * 策略：
 *   - http(s) / blob: URL 保持原样（远程地址只占几百字节）
 *   - data: URL 且体积超过阈值 → 解码 → 缩到 maxDim → JPEG 80% 重编码
 *   - 任何异常都降级为原 URL，不阻塞主流程
 *
 * 注意：这条不在识图主链路上，是 background `persistHistory` 后台落库时用的，
 * 慢一点不影响用户感知。
 */
export async function makeStorageThumbnail(
  url: string,
  maxDim = 320,
  quality = 0.8
): Promise<string> {
  if (!url) return url;
  if (!url.startsWith('data:')) return url;
  // 32KB 以内的小 dataUrl 不值得重新编码
  if (url.length < 32 * 1024) return url;
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas === 'undefined'
  ) {
    return url;
  }
  try {
    const { blob } = await loadBlob(url);
    const bmp = await createImageBitmap(blob);
    try {
      const longest = Math.max(bmp.width, bmp.height);
      const scale = longest > maxDim ? maxDim / longest : 1;
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return url;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      return await blobToDataUrl(out, 'image/jpeg');
    } finally {
      try {
        bmp.close();
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.debug('[PromptExtracto] makeStorageThumbnail failed', err);
    return url;
  }
}
