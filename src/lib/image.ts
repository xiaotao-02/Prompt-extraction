/**
 * 图片处理工具：把任意"动图 / 视频帧 / 静态图"统一规整成一张
 * 视觉大模型一定能吃下的 base64 dataURL。
 *
 * 关键点：
 *   - 大多数视觉 API 对 image/gif 的支持非常薄弱（OpenAI 仅看首帧，
 *     部分国产平台直接 400）；image/svg+xml、image/apng、动画 WebP
 *     更是要么不支持要么行为不一致。
 *   - 所以我们在送出去之前，对"已知可能是动图 / 矢量图"的 MIME
 *     一律尝试用 createImageBitmap + OffscreenCanvas 重绘成 JPEG，
 *     相当于把所有动图扁平化为静态首帧，把所有矢量图栅格化为位图。
 *   - 这个流程在 Manifest V3 的 service worker 里能跑（Chrome 已支持
 *     OffscreenCanvas / createImageBitmap），所以放在共享 lib 里。
 */
export interface FetchedImage {
  dataUrl: string;
  base64: string;
  mediaType: string;
  byteLength: number;
  /** 如果做过扁平化，会记录原始 MIME，便于调用方提示用户 */
  originalMediaType?: string;
}

const MAX_BYTES = 8 * 1024 * 1024; // 8MB 上限，多数视觉 API 容许 5~20MB
const FLATTEN_MAX_DIM = 1536; // 扁平化后最长边，节省 token

/**
 * 静态大图的"近无损降采样"阈值。
 *
 * 长边 1280 是识图类任务被业界广泛验证可用的"经济点"：
 *   - OpenAI vision low-detail 直接用 512×512，high-detail 也是按
 *     512×512 切 tile（1280 长边 ≈ 6 个 tile，识图细节足够）
 *   - Anthropic Claude 推荐 ≤ 1.15 megapixel（≈ 1568 长边），1280 在其下
 *   - 大多数视觉 transformer 的训练输入分辨率就在 224~1024 之间
 *
 * 比起 2048 阈值，1280 能让"中等大小图"（1–2MB 网图）也吃到降采样红利，
 * 上传体积通常再砍 50%~70%。识图 / 反推提示词这种任务对 1280 px 长边
 * 几乎没有可察觉的精度损失。
 *
 * 体积阈值 1.5MB：很多 1080p / 视网膜屏截图像素没到 2048 但本身就有 2MB+，
 * 这类图重编码后体积往往能压到 ≤ 500KB。
 */
const SHRINK_DIM_THRESHOLD = 1280;
const SHRINK_BYTES_THRESHOLD = Math.round(1.5 * 1024 * 1024);
/** JPEG 重编码质量：0.95 在人眼几乎不可分辨，但体积比 1.0 小一半。 */
const SHRINK_JPEG_QUALITY = 0.95;

/**
 * 哪些 MIME 主动走"扁平化为 JPEG"流程：
 *   - image/gif、image/apng：天然就是动画格式
 *   - image/webp：静态 / 动画两种可能，一并扁平化最稳
 *   - image/svg+xml：矢量图，部分模型直接拒绝
 *
 * image/png / image/jpeg 不在此列 —— 即使有 APNG 的极少数情况，
 * 也大概率会被 createImageBitmap 当静态首帧解码，没必要重新编码失真。
 */
const FLATTEN_TYPES = new Set([
  'image/gif',
  'image/apng',
  'image/webp',
  'image/svg+xml',
]);

export async function fetchImageAsBase64(imageUrl: string): Promise<FetchedImage> {
  const initial = await loadBlob(imageUrl);
  return normalizeForVisionApi(initial.blob, initial.mediaType);
}

async function loadBlob(imageUrl: string): Promise<{ blob: Blob; mediaType: string }> {
  // data: 协议直接解析
  if (imageUrl.startsWith('data:')) {
    const match = /^data:([^;,]+)(?:;([^,]+))?,(.*)$/.exec(imageUrl);
    if (!match) throw new Error('无法解析的 data URL');
    const mediaType = match[1] || 'application/octet-stream';
    const isBase64 = (match[2] || '').includes('base64');
    const payload = match[3] || '';
    let buffer: ArrayBuffer;
    if (isBase64) {
      const bin = atob(payload);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      buffer = arr.buffer as ArrayBuffer;
    } else {
      const decoded = decodeURIComponent(payload);
      const arr = new TextEncoder().encode(decoded);
      buffer = arr.buffer as ArrayBuffer;
    }
    return {
      blob: new Blob([buffer], { type: mediaType }),
      mediaType,
    };
  }

  // blob: URL 直接 fetch（同源），http(s) 也是 fetch
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
 * 视觉 API 适配层：根据 MIME 决定是否扁平化 / 截帧，然后做大小校验、base64 化。
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
    // 直接抛错让 UI 给出明确指引，比传一个肯定失败的视频 blob 体验好。
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
  } else {
    // 静态 PNG / JPEG / AVIF / BMP：仅在"长边 > 2048"或"体积 > 4MB"时
    // 触发近无损降采样。阈值之内的小图原样上传，0 重编码、0 失真。
    const shrunk = await tryShrinkLossless(blob, mediaType);
    if (shrunk) {
      // 这种降采样对模型可见信息无损（远端本来就会做同样的 resize），
      // 所以不计入 originalMediaType；调用方无需提示用户。
      finalBlob = shrunk.blob;
      finalType = shrunk.mediaType;
    }
  }

  if (finalBlob.size > MAX_BYTES) {
    throw new Error(
      `图片过大（${(finalBlob.size / 1024 / 1024).toFixed(
        1
      )}MB），请使用更小的图片或缩略图`
    );
  }

  const buffer = await finalBlob.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  return {
    dataUrl: `data:${finalType};base64,${base64}`,
    base64,
    mediaType: finalType,
    byteLength: finalBlob.size,
    originalMediaType: originalType,
  };
}

/**
 * 把动图 / 矢量图等扁平化为一张静态 JPEG。
 * 失败时返回 null，调用方继续用原始 blob 兜底。
 */
async function tryFlatten(blob: Blob): Promise<Blob | null> {
  // service worker / content script 都能拿到 createImageBitmap & OffscreenCanvas
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
 * 静态大图的近无损降采样。
 *
 * 触发条件：长边 > {@link SHRINK_DIM_THRESHOLD} 或体积 > {@link SHRINK_BYTES_THRESHOLD}。
 * 其它图片直接返回 null（外层会原样上传）。
 *
 * 编码策略：
 *   - PNG：缩尺寸后仍保留 PNG（不破坏透明通道，文字 / 线稿不会出现 JPEG 振铃）
 *   - 其它（JPEG / AVIF / BMP / …）：转 JPEG 0.95（人眼不可分辨）
 *
 * 重要：只有重编码后体积*更小*才采用，否则继续走原 blob —— 避免某些场景
 * 下"重编码反而更大"的反向劣化（例如本身已经是极致压缩的小图）。
 */
async function tryShrinkLossless(
  blob: Blob,
  mediaType: string
): Promise<{ blob: Blob; mediaType: string } | null> {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas === 'undefined'
  ) {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const overDim = longest > SHRINK_DIM_THRESHOLD;
    const overBytes = blob.size > SHRINK_BYTES_THRESHOLD;
    if (!overDim && !overBytes) return null;

    const scale = overDim ? SHRINK_DIM_THRESHOLD / longest : 1;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // 高质量重采样，对识图无影响但能让缩放后字体 / 边缘更干净
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);

    const keepAlpha = mediaType === 'image/png';
    const out = keepAlpha
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await canvas.convertToBlob({
          type: 'image/jpeg',
          quality: SHRINK_JPEG_QUALITY,
        });

    if (out.size >= blob.size) return null;
    return { blob: out, mediaType: keepAlpha ? 'image/png' : 'image/jpeg' };
  } catch (err) {
    console.debug('[PromptExtracto] shrink failed', err);
    return null;
  } finally {
    try {
      bitmap.close();
    } catch {
      /* ignore */
    }
  }
}

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
 * 这里的策略：
 *   - http(s)/blob: URL 保持原样（远程地址只占几百字节）
 *   - data: URL 且体积超过阈值 → 解码 → 缩到 maxDim → JPEG 80% 重编码
 *   - 任何异常都降级为原 URL，不阻塞主流程
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
    // SVG 已经在 normalizeForVisionApi 里栅格化过，这里再走一次只为缩小
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
      const buf = await out.arrayBuffer();
      return `data:image/jpeg;base64,${arrayBufferToBase64(buf)}`;
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
