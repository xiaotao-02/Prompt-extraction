/**
 * 「立即更新」：先与 GitHub latest 比对并落盘检查结果，再请求浏览器侧扩展更新；
 * 无法在浏览器内应用时仅返回说明文案（不打开 Release / 下载页）。
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

  const status = await requestBrowserExtensionUpdateCheck();
  if (status === 'update_available') {
    return { applied: true, willReload: true };
  }
  if (status === 'throttled') {
    return {
      applied: false,
      reason: 'throttled',
      message:
        '浏览器更新检查被限流，请稍后再试。也可打开 chrome://extensions（Edge：edge://extensions）查看扩展是否有「更新」。',
    };
  }
  return {
    applied: false,
    reason: 'manual_required',
    message:
      'GitHub 上已有较新版本，但浏览器尚未提供可安装的商店更新（商店同步延迟），或你正在使用「加载已解压的扩展」而无法从商店自动升级。请稍后再试，或在扩展管理页（chrome://extensions / edge://extensions）检查「更新」；解压加载时请在扩展管理页对本扩展点「重新加载」。',
  };
}
