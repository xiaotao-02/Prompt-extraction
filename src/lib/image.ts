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
  // ★ 快速路径：当 imageUrl 已经是 `data:image/<x>;base64,<payload>` 且体积在阈值内、
  //   且不属于必须扁平化的格式（gif / apng / webp / svg），直接拆出 base64 段返回。
  //
  //   常见命中场景：content script 的 captureVideoFrame / canvas.toDataURL / SVG 序列化，
  //   它们送过来的 imageUrl 本身就是一份现成的 base64。原先要 atob → Uint8Array → Blob →
  //   FileReader.readAsDataURL 又走一圈，500KB 视频帧能浪费 100–200ms，**全是无用功**。
  if (imageUrl.startsWith('data:')) {
    const fast = tryFastDataUrl(imageUrl);
    if (fast) return fast;
  }
  const initial = await loadBlob(imageUrl);
  return normalizeForVisionApi(initial.blob, initial.mediaType);
}

/**
 * 尝试把一条 `data:image/...;base64,...` URL 直通成 FetchedImage，跳过所有解码/重编码。
 *
 * 命中条件（任一不满足都返回 null 走完整路径）：
 *   1. 必须是 base64 编码的 data URL（百分号编码的 SVG 等需要走 Blob 路径）
 *   2. mediaType 必须是图像类型，且不在 {@link FLATTEN_TYPES} 里（动图 / SVG 仍需扁平化）
 *   3. 解码后估算字节数 ≤ {@link SHRINK_BYTES_THRESHOLD}（否则可能需要走缩放）
 *
 * 字节数估算用 `Math.floor(base64.length * 0.75) - padding`：base64 每 4 字符对应 3 字节，
 * 末尾 `=` padding 占位但不解码出字节。这个估算对快/慢阈值判断已经够精确。
 */
function tryFastDataUrl(url: string): FetchedImage | null {
  // 用懒匹配抓 mediaType 与 base64 payload；非 base64 的 data URL 不在此路径处理
  const match = /^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/i.exec(url);
  if (!match) return null;
  const mediaType = match[1].toLowerCase();
  const base64 = match[2];
  if (!mediaType.startsWith('image/')) return null;
  if (FLATTEN_TYPES.has(mediaType)) return null;

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const approxBytes = Math.floor(base64.length * 0.75) - padding;
  if (approxBytes > SHRINK_BYTES_THRESHOLD) return null; // 让大图走缩放路径

  return {
    dataUrl: url,
    base64,
    mediaType,
    byteLength: approxBytes,
  };
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
    // 静态 PNG / JPEG / AVIF / BMP：仅在体积超阈值时触发近无损降采样。
    // 体积之内的小图直接原样上传，0 解码、0 重编码、0 失真。
    const shrunk = await tryShrinkLossless(blob);
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

  // base64 化走 FileReader.readAsDataURL：在 service worker 主线程上是异步、
  // 走线程池，不会同步阻塞消息派发；同时省掉一次 ArrayBuffer + Uint8Array 中转，
  // 对几 MB 图能比同步 btoa(arrayBufferToBase64) 快一倍以上。
  const dataUrl = await blobToDataUrl(finalBlob, finalType);
  // dataUrl 形如 `data:<mime>;base64,<payload>`；提取 base64 段供 Anthropic / Gemini 用
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
 * 当 blob.type 与目标 mime 不一致（例如我们扁平化后的输出是 image/jpeg 但
 * 原 blob 还是 image/png），我们用 `new Blob([blob], { type: finalType })`
 * 重新包一下，确保产出的 dataUrl 头部 mime 正确。
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
 * 触发条件：体积 > {@link SHRINK_BYTES_THRESHOLD}（仅靠体积判定，避免对
 * 每张图都走一次 createImageBitmap 解码）。
 *
 * 为什么不再用"长边 > 1280 也触发"作为入口条件：
 *   - 之前为了支持"长边超但体积不超"这种边角情况，所有图都要先做一次
 *     `createImageBitmap` 拿宽高，再回头判断要不要缩。一张 800×600 / 400KB
 *     的普通网图就要为此多花 50–300ms 的解码 + 内存分配，**这次解码 100%
 *     是浪费的**。
 *   - 体积 ≤ 1.5MB 的图，即便长边稍大（比如 1600×900 的 JPEG ≈ 600KB），
 *     模型那侧本来就会做自己的 resize，本地再多缩一次的收益（几个 token、
 *     几十 KB 上传）远低于多花的几百 ms 解码 + 重编码代价。
 *   - 真正会"上传卡顿 / token 爆炸"的图全都是体积大的（1.5MB+ 的截图、
 *     PNG 大图、AVIF / BMP 等）—— 体积阈值已经足够覆盖它们。
 *
 * 编码策略：缩放后**统一**转 JPEG（垫白底兼容透明 PNG）。
 *   - 视觉 API 那侧 alpha 通道完全无用（会合成成底色），保 PNG 没有识图收益
 *   - 而 OffscreenCanvas 的 PNG 编码没有最优滤波器选择，1080p PNG 编码常常
 *     需要 500–1500ms 且产出体积 ≥ 原图 → 触发下方 `out.size >= blob.size`
 *     分支整段白做；JPEG 编码同尺寸只要 50–200ms 且体积稳定缩小。
 *
 * 重要：只有重编码后体积*更小*才采用，否则继续走原 blob —— 避免某些场景
 * 下"重编码反而更大"的反向劣化（例如本身已经是极致压缩的小图）。
 */
async function tryShrinkLossless(
  blob: Blob
): Promise<{ blob: Blob; mediaType: string } | null> {
  // 体积阈值之内直接放行，跳过整次 createImageBitmap + canvas 编码（命中率极高的快速路径）
  if (blob.size <= SHRINK_BYTES_THRESHOLD) return null;
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
    const scale = longest > SHRINK_DIM_THRESHOLD ? SHRINK_DIM_THRESHOLD / longest : 1;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // 透明 PNG 直接画到 JPEG 上会变黑（JPEG 不支持 alpha），先垫一层白底
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // 高质量重采样，对识图无影响但能让缩放后字体 / 边缘更干净
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);

    const out = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: SHRINK_JPEG_QUALITY,
    });

    if (out.size >= blob.size) return null;
    return { blob: out, mediaType: 'image/jpeg' };
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
