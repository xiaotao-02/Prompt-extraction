import type { RegionCaptureConfirmPayload } from '@/lib/types';

const MAX_EDGE = 1600;

function clampRect(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * 按视口 CSS 坐标把整页 PNG 快照裁成 JPEG；输出最长边不超 {@link MAX_EDGE}。
 */
export async function cropTabCaptureToJpeg(
  rawPngDataUrl: string,
  viewport: RegionCaptureConfirmPayload
): Promise<string | null> {
  const iw = Math.max(1, viewport.innerWidth);
  const ih = Math.max(1, viewport.innerHeight);
  let blob: Blob;
  try {
    const resp = await fetch(rawPngDataUrl);
    blob = await resp.blob();
  } catch {
    return null;
  }

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return null;
  }

  try {
    const sx = clampRect(Math.round((viewport.x / iw) * bmp.width), 0, bmp.width - 1);
    const sy = clampRect(Math.round((viewport.y / ih) * bmp.height), 0, bmp.height - 1);
    let sw = Math.round((viewport.width / iw) * bmp.width);
    let sh = Math.round((viewport.height / ih) * bmp.height);
    sw = Math.max(1, Math.min(bmp.width - sx, sw));
    sh = Math.max(1, Math.min(bmp.height - sy, sh));

    let dw = sw;
    let dh = sh;
    const longest = Math.max(dw, dh);
    if (longest > MAX_EDGE) {
      const scale = MAX_EDGE / longest;
      dw = Math.max(1, Math.round(dw * scale));
      dh = Math.max(1, Math.round(dh * scale));
    }

    const canvas = new OffscreenCanvas(dw, dh);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);

    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    if (!out) return null;
    return await blobToDataUrl(out);
  } finally {
    bmp.close();
  }
}

export function parseRegionCaptureConfirmPayload(raw: unknown): RegionCaptureConfirmPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const width = Number(o.width);
  const height = Number(o.height);
  const innerWidth = Number(o.innerWidth);
  const innerHeight = Number(o.innerHeight);
  if (![x, y, width, height, innerWidth, innerHeight].every((n) => Number.isFinite(n))) return null;
  if (width < 8 || height < 8 || innerWidth < 64 || innerHeight < 64) return null;
  if (x < -2 || y < -2 || innerWidth > 8192 || innerHeight > 8192) return null;
  return { x, y, width, height, innerWidth, innerHeight };
}
