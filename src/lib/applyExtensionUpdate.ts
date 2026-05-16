/**
 * 「立即更新」：先与 GitHub latest 比对并落盘检查结果，再请求浏览器侧扩展更新；
 * 无法在浏览器内应用时由 background 打开 Release 页（本模块只返回 openUrl）。
 */
import type { ApplyExtensionUpdateResult } from './types';
import { performUpdateCheck } from './updater';
import { saveUpdateResult } from './storage/updates';

export async function requestBrowserExtensionUpdateCheck(): Promise<
  'throttled' | 'no_update' | 'update_available'
> {
  return new Promise((resolve, reject) => {
    chrome.runtime.requestUpdateCheck((status) => {
      const lastErr = chrome.runtime.lastError;
      if (lastErr?.message) {
        reject(new Error(lastErr.message));
        return;
      }
      resolve(status);
    });
  });
}

export async function applyExtensionUpdateFromFeed(feedUrl: string): Promise<ApplyExtensionUpdateResult> {
  const result = await performUpdateCheck(feedUrl);
  await saveUpdateResult(result);
  if (result.error) {
    throw new Error(result.error);
  }
  if (!result.hasUpdate || !result.latest) {
    return { applied: false, reason: 'already_latest' };
  }
  const latest = result.latest;
  const openUrlRaw = (latest.releaseUrl || latest.downloadUrl || '').trim();
  const openUrl = openUrlRaw || undefined;

  const status = await requestBrowserExtensionUpdateCheck();
  if (status === 'update_available') {
    return { applied: true, willReload: true };
  }
  if (status === 'throttled') {
    return {
      applied: false,
      reason: 'throttled',
      message:
        '浏览器更新检查被限流，请稍后再试。若急需更新，可通过发布页手动安装。',
      openUrl,
    };
  }
  return {
    applied: false,
    reason: 'manual_required',
    message:
      '浏览器侧暂无待安装更新（常见于商店尚未同步或当前为「加载已解压的扩展」）。请前往 GitHub Release 下载最新包手动更新。',
    openUrl,
  };
}
