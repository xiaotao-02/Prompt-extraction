/**
 * 从页面 `<video>` 按时间片段 seek，采样多帧为 JPEG dataURL，
 * 供 compose 面板「采样到参考 / 时间段反推」使用。
 */

import { MAX_REFERENCE_IMAGES } from '@/lib/referenceImages';
import { forEachAccessibleSameOriginDocument } from '@/content/sameOriginIframes';

/** 与 content/index.ts 矩形命中一致，缩小误扫与漏扫差异 */
const RECT_HIT_MAX_NODES = 2000;
const RECT_HIT_MIN_EDGE = 8;
const HOST_SCAN_LIMIT = 4000;

const SEEK_TIMEOUT_MS = 2800;

function rectArea(r: DOMRectReadOnly): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

/** `getBoundingClientRect` 相对于元素所在 browsing context 的视口；应用该 document 的 window 尺寸判断是否在视口内 */
function isRoughlyInViewportForElement(el: Element, r: DOMRectReadOnly): boolean {
  const win = el.ownerDocument?.defaultView;
  if (!win) return false;
  const h = typeof win.innerHeight === 'number' ? win.innerHeight : 0;
  const w = typeof win.innerWidth === 'number' ? win.innerWidth : 0;
  return r.bottom > 0 && r.top < h && r.right > 0 && r.left < w;
}

/**
 * 顶层 document + 可达同源 iframe 内文档中的 `<video>`（含 open Shadow）。
 */
function collectVideoElementsFromAccessibleDocuments(rootDoc: Document): HTMLVideoElement[] {
  const out: HTMLVideoElement[] = [];
  forEachAccessibleSameOriginDocument(rootDoc, (doc) => {
    out.push(...collectVideoElementsFromRoots(doc));
  });
  return out;
}

export function captureVideoFrameToDataUrl(video: HTMLVideoElement): string {
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

export function collectVideoElementsFromRoots(top: Document | ShadowRoot): HTMLVideoElement[] {
  const out: HTMLVideoElement[] = [];
  let seenMedia = 0;
  let hostScan = 0;

  const visitRoot = (root: Document | ShadowRoot): void => {
    root.querySelectorAll('video').forEach((el) => {
      if (!(el instanceof HTMLVideoElement)) return;
      if (seenMedia >= RECT_HIT_MAX_NODES) return;
      seenMedia += 1;
      out.push(el);
    });

    if (seenMedia >= RECT_HIT_MAX_NODES) return;

    for (const host of root.querySelectorAll('*')) {
      if (hostScan >= HOST_SCAN_LIMIT || seenMedia >= RECT_HIT_MAX_NODES) return;
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
 * 视口内、尺寸足够的 `<video>` 列表（与右键矩形命中观感一致）。
 */
export function listViewportVideos(): HTMLVideoElement[] {
  const all = collectVideoElementsFromAccessibleDocuments(document);
  return all.filter((v) => {
    const r = v.getBoundingClientRect();
    if (r.width < RECT_HIT_MIN_EDGE || r.height < RECT_HIT_MIN_EDGE) return false;
    if (!isRoughlyInViewportForElement(v, r)) return false;
    const area = rectArea(r);
    return area >= RECT_HIT_MIN_EDGE * RECT_HIT_MIN_EDGE;
  });
}

function formatDurationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '?';

  try {
    // 避免出现 599.994s 这一类过长小数
    if (seconds >= 3600 * 48) return '很长';
    if (seconds < 60) return `${seconds.toFixed(2).replace(/\.?0+$/, '')}s`;

    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m${String(s).padStart(2, '0')}s`;
  } catch {
    return '?';
  }
}

/**
 * 供 compose 模板渲染 `<option>` HTML（value 为 0-based 序号）。
 */
export function composeVideoPickerOptionsHtml(): string {
  const vids = listViewportVideos();
  if (vids.length === 0) {
    return '<select class="compose-video-picker" data-role="video-seg-picker" disabled><option value="">无页面内视频</option></select>';
  }

  const options = vids.map((v, i) => {
    const dur = formatDurationLabel(v.duration);
    const label = `${i + 1} · ${v.videoWidth || 0}×${v.videoHeight || 0} · ${dur}`;
    const esc = label
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    return `<option value="${i}">${esc}</option>`;
  });

  return `<select class="compose-video-picker" data-role="video-seg-picker">${options.join('')}</select>`;
}

export function resolveViewportVideoAtIndex(idx: number): HTMLVideoElement | undefined {
  const vids = listViewportVideos();
  if (idx < 0 || idx >= vids.length) return undefined;
  return vids[idx];
}

function clampTimeToFiniteDuration(t: number, duration: number): number {
  if (!Number.isFinite(t)) return t;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, t);
  return Math.min(Math.max(0, t), duration);
}

/**
 * open 区间的均匀采样时间点（含首尾），长度为 `frameCount`，至少 2 个。
 */
export function uniformSampleTimes(
  startSec: number,
  endSec: number,
  frameCount: number
): number[] {
  const n = Math.max(2, Math.floor(frameCount));
  const span = endSec - startSec;
  if (span <= 0 || !Number.isFinite(span)) return [startSec, endSec];

  const out: number[] = [];
  if (n === 1) return [startSec];

  for (let i = 0; i < n; i += 1) {
    const t = startSec + (span * i) / (n - 1);
    out.push(t);
  }
  return out;
}

async function seekVideoTo(video: HTMLVideoElement, t: number): Promise<void> {
  const view = video.ownerDocument?.defaultView ?? window;
  const target = Number.isFinite(t) ? Math.max(0, t) : 0;

  if (Math.abs(video.currentTime - target) < 1e-4) {
    await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()));
    return;
  }

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => finish();

    video.addEventListener('seeked', onSeeked, { passive: true });
    try {
      video.currentTime = target;
    } catch {
      finish();
      return;
    }

    view.setTimeout(finish, SEEK_TIMEOUT_MS);
  });

  await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()));
}

interface PlaybackSnapshot {
  currentTime: number;
  paused: boolean;
}

async function pauseForSampling(video: HTMLVideoElement): Promise<PlaybackSnapshot> {
  const view = video.ownerDocument?.defaultView ?? window;
  const snap: PlaybackSnapshot = {
    currentTime: video.currentTime,
    paused: video.paused,
  };
  if (!snap.paused) {
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()));
  }
  return snap;
}

function restorePlayback(video: HTMLVideoElement, snap: PlaybackSnapshot): void {
  try {
    video.currentTime = snap.currentTime;
  } catch {
    /* ignore */
  }

  try {
    if (!snap.paused) {
      void video.play().catch(() => undefined);
    } else if (!video.paused) {
      video.pause();
    }
  } catch {
    /* ignore */
  }
}

const MIN_SEGMENT_SPAN = 1 / 240;

export interface SampleVideoSegmentResult {
  frames: string[];
  startSec: number;
  endSec: number;
  /** 与 `frames` 等长的采样时间点（秒），按播放时间递增 */
  frameTimesSec: number[];
}

/**
 * Seek 区间内均匀抓取 JPEG；返回实际用于采样的时间与 dataURL 列表（按时间递增）。
 *
 * `maxFrames` 默认等同参考图上限；至少 2 帧。
 */
export async function sampleVideoSegmentJPEGs(
  video: HTMLVideoElement,
  rawStartSec: number,
  rawEndSec: number,
  opts?: { maxFrames?: number }
): Promise<SampleVideoSegmentResult> {
  let startSec = rawStartSec;
  let endSec = rawEndSec;

  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    throw new Error('起始秒 / 结束秒必须是有效数字');
  }

  let duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;

  startSec = Math.max(0, startSec);
  endSec = Math.max(0, endSec);

  if (Number.isFinite(duration)) {
    startSec = clampTimeToFiniteDuration(startSec, duration);
    endSec = clampTimeToFiniteDuration(endSec, duration);
  }

  if (endSec - startSec < MIN_SEGMENT_SPAN) {
    throw new Error('时间段太短，请输入有效的起止秒且起始 < 结束');
  }

  if (startSec >= endSec) {
    throw new Error('起始秒必须小于结束秒');
  }

  const maxFrames = Math.min(MAX_REFERENCE_IMAGES, Math.max(2, opts?.maxFrames ?? MAX_REFERENCE_IMAGES));

  const times = uniformSampleTimes(startSec, endSec, maxFrames);
  const snap = await pauseForSampling(video);

  const frames: string[] = [];

  try {
    for (const t of times) {
      await seekVideoTo(video, t);
      const jpeg = captureVideoFrameToDataUrl(video);
      if (!jpeg) {
        throw new Error(
          '无法抓取该视频画面（可能没有解码画面，或跨域导致 canvas 被污染）；请换一个视频源或勾选允许跨域的媒体。'
        );
      }

      frames.push(jpeg);
    }

    if (frames.length < 2) {
      throw new Error('抓取到的有效帧过少，无法描述片段；请换时间段或稍后重试。');
    }

    /** 首尾时间用于提示词文案（与用户输入一致或可读的 clamp 后区间）*/
    const outStart = times[0]!;
    const outEnd = times[times.length - 1]!;

    return { frames, startSec: outStart, endSec: outEnd, frameTimesSec: [...times] };
  } finally {
    restorePlayback(video, snap);
  }
}
