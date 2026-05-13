import type { UpdateCheckResult, UpdateInfo, UpdateSettings } from './types';
import { isNewerVersion } from './version';

export const UPDATE_ALARM_NAME = 'image-prompt-update-check';
export const MIN_INTERVAL_MINUTES = 30;

// 内置默认更新源：插件官方 GitHub 仓库的 Releases。
// 用户在「设置 → 自动更新」里填写的 feedUrl 仍会覆盖这里的默认值。
export const DEFAULT_FEED_URL = 'xiaotao-02/Prompt-extraction';

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  enabled: true,
  feedUrl: DEFAULT_FEED_URL,
  intervalHours: 24,
  notifyDesktop: true,
  lastCheckedAt: 0,
  lastResult: null,
  dismissedVersion: '',
};

export function getCurrentVersion(): string {
  try {
    return chrome.runtime.getManifest().version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * 把用户输入的更新源规范化为可直接 fetch 的 URL。
 * - "owner/repo"                                → GitHub Releases Latest API
 * - "https://github.com/owner/repo[/...]"       → GitHub Releases Latest API
 *   （否则会拿到一个 HTML 页面，触发 JSON 解析报错）
 * - 完整 https URL                              → 原样使用
 * - 其他/空值                                    → 返回 null
 */
export function normalizeFeedUrl(input: string): string | null {
  const s = (input || '').trim();
  if (!s) return null;
  const githubWeb = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/i.exec(s);
  if (githubWeb) {
    return `https://api.github.com/repos/${githubWeb[1]}/${githubWeb[2]}/releases/latest`;
  }
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) {
    return `https://api.github.com/repos/${s}/releases/latest`;
  }
  return null;
}

interface GithubAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  assets?: GithubAsset[];
  published_at?: string;
  created_at?: string;
  prerelease?: boolean;
  draft?: boolean;
}

interface CustomFeed {
  version?: string;
  name?: string;
  downloadUrl?: string;
  url?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  notes?: string;
  publishedAt?: string;
}

function parseGithubRelease(data: GithubRelease): UpdateInfo | null {
  if (data.draft) return null;
  const tag = String(data.tag_name || '').trim();
  if (!tag) return null;
  const version = tag.replace(/^v/i, '');
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const zipAsset =
    assets.find((a) => /\.zip$/i.test(a?.name || '')) ||
    assets.find((a) => /\.crx$/i.test(a?.name || '')) ||
    assets[0];
  return {
    version,
    name: data.name || tag,
    downloadUrl: zipAsset?.browser_download_url || data.html_url || '',
    releaseUrl: data.html_url || '',
    releaseNotes: data.body || '',
    publishedAt: data.published_at || data.created_at || '',
  };
}

function parseCustomFeed(data: CustomFeed): UpdateInfo | null {
  if (!data.version) return null;
  return {
    version: String(data.version).replace(/^v/i, ''),
    name: data.name || data.version,
    downloadUrl: data.downloadUrl || data.url || '',
    releaseUrl: data.releaseUrl || data.url || '',
    releaseNotes: data.releaseNotes || data.notes || '',
    publishedAt: data.publishedAt || '',
  };
}

function truncate(s: string, max = 200): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(共 ${s.length} 字符)`;
}

function looksLikeHtml(s: string): boolean {
  const head = s.trimStart().slice(0, 64).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml');
}

export async function fetchLatestRelease(feedUrl: string): Promise<UpdateInfo | null> {
  const url = normalizeFeedUrl(feedUrl);
  if (!url) return null;
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }
  const text = await resp.text();
  let data: GithubRelease & CustomFeed;
  try {
    data = JSON.parse(text) as GithubRelease & CustomFeed;
  } catch {
    if (looksLikeHtml(text)) {
      throw new Error(
        `更新源返回的是 HTML 页面而不是 JSON，请检查更新源 URL 是否填写正确（应为 release API 或自定义 JSON 接口，而不是网页地址）。预览: ${truncate(text)}`
      );
    }
    throw new Error(`更新源返回内容无法解析为 JSON：${truncate(text)}`);
  }
  if (data && typeof data === 'object' && 'tag_name' in data && data.tag_name) {
    return parseGithubRelease(data);
  }
  return parseCustomFeed(data);
}

export async function performUpdateCheck(feedUrl: string): Promise<UpdateCheckResult> {
  const current = getCurrentVersion();
  const checkedAt = Date.now();
  if (!normalizeFeedUrl(feedUrl)) {
    return {
      hasUpdate: false,
      current,
      latest: null,
      checkedAt,
      error: '尚未配置更新源',
    };
  }
  try {
    const latest = await fetchLatestRelease(feedUrl);
    if (!latest) {
      return { hasUpdate: false, current, latest: null, checkedAt, error: '更新源数据无效' };
    }
    return {
      hasUpdate: isNewerVersion(latest.version, current),
      current,
      latest,
      checkedAt,
    };
  } catch (e) {
    return {
      hasUpdate: false,
      current,
      latest: null,
      checkedAt,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 仅当扩展通过 Chrome Web Store 安装且 manifest 中带 update_url 时，
 * Chrome 才能真正地自动更新。该函数封装这一原生流程，返回是否成功触发更新。
 */
export async function tryNativeUpdate(): Promise<{
  status: 'no_update' | 'throttled' | 'update_available' | 'unsupported' | 'error';
  reloaded?: boolean;
  message?: string;
}> {
  if (!chrome.runtime?.requestUpdateCheck) {
    return { status: 'unsupported', message: '当前运行环境不支持原生更新' };
  }
  try {
    const result = await new Promise<{ status: string }>((resolve, reject) => {
      try {
        chrome.runtime.requestUpdateCheck((status, details) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'requestUpdateCheck failed'));
            return;
          }
          resolve({ status: String(status), ...(details || {}) });
        });
      } catch (err) {
        reject(err);
      }
    });
    if (result.status === 'update_available') {
      setTimeout(() => {
        try {
          chrome.runtime.reload();
        } catch {
          /* ignore */
        }
      }, 200);
      return { status: 'update_available', reloaded: true };
    }
    if (result.status === 'throttled') {
      return { status: 'throttled', message: 'Chrome 更新检查被限流，请稍后再试' };
    }
    return { status: 'no_update' };
  } catch (e) {
    return {
      status: 'unsupported',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 判断当前扩展是否是通过 Chrome Web Store 正常安装的。
 * 开发者模式加载 (installType === 'development') 时无法自动更新。
 */
export async function isStoreInstalled(): Promise<boolean> {
  if (!chrome.management?.getSelf) return false;
  try {
    const info = await chrome.management.getSelf();
    return info.installType === 'normal' && Boolean(info.updateUrl);
  } catch {
    return false;
  }
}

export function clampIntervalHours(h: number): number {
  if (!Number.isFinite(h) || h <= 0) return 24;
  return Math.max(0.5, Math.min(168, h));
}

export { isNewerVersion };
