/**
 * 图片处理工具：将远程图片地址转换为 base64 dataURL，
 * 以便统一传给那些只接受内联 base64 的视觉 API（如 Anthropic / Gemini）。
 */
export interface FetchedImage {
  dataUrl: string;
  base64: string;
  mediaType: string;
  byteLength: number;
}

const MAX_BYTES = 8 * 1024 * 1024; // 8MB 上限，多数视觉 API 容许 5~20MB

export async function fetchImageAsBase64(imageUrl: string): Promise<FetchedImage> {
  // data: 协议直接解析
  if (imageUrl.startsWith('data:')) {
    const match = /^data:([^;,]+)(?:;([^,]+))?,(.*)$/.exec(imageUrl);
    if (!match) throw new Error('无法解析的 data URL');
    const mediaType = match[1] || 'image/png';
    const isBase64 = (match[2] || '').includes('base64');
    const payload = match[3] || '';
    if (isBase64) {
      const base64 = payload;
      return {
        dataUrl: imageUrl,
        base64,
        mediaType,
        byteLength: Math.floor((base64.length * 3) / 4),
      };
    }
    const bin = decodeURIComponent(payload);
    const base64 = btoa(bin);
    return {
      dataUrl: `data:${mediaType};base64,${base64}`,
      base64,
      mediaType,
      byteLength: bin.length,
    };
  }

  const resp = await fetch(imageUrl, { credentials: 'omit' });
  if (!resp.ok) {
    throw new Error(`下载图片失败：HTTP ${resp.status}`);
  }
  const blob = await resp.blob();
  if (blob.size > MAX_BYTES) {
    throw new Error(`图片过大（${(blob.size / 1024 / 1024).toFixed(1)}MB），请使用更小的图片`);
  }
  const mediaType = blob.type || 'image/jpeg';
  const buffer = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  return {
    dataUrl: `data:${mediaType};base64,${base64}`,
    base64,
    mediaType,
    byteLength: blob.size,
  };
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
