import { extractPrompt, refinePrompt } from '@/lib/api';
import {
  addHistory,
  appendPromptVersion,
  getSettings,
  getUpdateSettings,
  patchUpdateSettings,
  saveUpdateResult,
} from '@/lib/storage';
import type {
  HistoryItem,
  RefineResponse,
  RuntimeMessage,
  UpdateCheckResult,
} from '@/lib/types';
import {
  UPDATE_ALARM_NAME,
  MIN_INTERVAL_MINUTES,
  clampIntervalHours,
  getCurrentVersion,
  isStoreInstalled,
  performUpdateCheck,
  tryNativeUpdate,
} from '@/lib/updater';
import { isNewerVersion } from '@/lib/version';

const MENU_ID = 'extract-image-prompt';
const UPDATE_NOTIFICATION_ID = 'image-prompt-update-available';

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create(
    {
      id: MENU_ID,
      title: '🎨 提取图片提示词',
      contexts: ['image'],
    },
    () => void chrome.runtime.lastError
  );
  await rescheduleUpdateAlarm();
  // 安装/更新后清掉旧徽章，并立刻做一次轻量检查（不阻塞）
  await refreshActionBadge();
  void runScheduledCheck({ silent: true });
});

chrome.runtime.onStartup.addListener(async () => {
  await rescheduleUpdateAlarm();
  await refreshActionBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab?.id) return;
  const imageUrl = info.srcUrl;
  if (!imageUrl) return;
  await runExtraction({
    tabId: tab.id,
    imageUrl,
    pageUrl: tab.url || '',
    pageTitle: tab.title || '',
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === 'CHECK_UPDATE') {
    runUpdateCheck({ force: Boolean(message.payload?.force) }).then((result) => {
      sendResponse({ ok: true, result });
    });
    return true;
  }
  if (message?.type === 'APPLY_UPDATE') {
    applyUpdate().then((res) => sendResponse(res));
    return true;
  }
  if (message?.type === 'DISMISS_UPDATE') {
    const v = message.payload?.version || '';
    patchUpdateSettings({ dismissedVersion: v }).then(async () => {
      await refreshActionBadge();
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.type === 'REFINE_PROMPT') {
    const { historyId, instruction, current } = message.payload || {};
    if (!historyId || !instruction || typeof current !== 'string') {
      sendResponse({ ok: false, error: '参数缺失' } satisfies RefineResponse);
      return true;
    }
    runRefine(historyId, current, instruction).then((res) => sendResponse(res));
    return true;
  }
  if (message?.type === 'EXTRACT_PROMPT') {
    const { imageUrl, pageUrl, pageTitle, requestId } = message.payload || {};
    const tabId = sender.tab?.id;
    if (!tabId || !imageUrl) {
      sendResponse({ ok: false, error: 'invalid params' });
      return true;
    }
    runExtraction({
      tabId,
      imageUrl,
      pageUrl: pageUrl || sender.tab?.url || '',
      pageTitle: pageTitle || sender.tab?.title || '',
      requestId,
    });
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

async function runExtraction(params: {
  tabId: number;
  imageUrl: string;
  pageUrl: string;
  pageTitle: string;
  requestId?: string;
}): Promise<void> {
  const { tabId, imageUrl, pageUrl, pageTitle } = params;
  const requestId = params.requestId || crypto.randomUUID();

  await ensureContentScript(tabId);

  await sendToTab(tabId, {
    type: 'EXTRACT_PENDING',
    payload: { requestId, imageUrl },
  });

  try {
    const settings = await getSettings();
    const result = await extractPrompt({ imageUrl, settings });

    await sendToTab(tabId, {
      type: 'EXTRACT_RESULT',
      payload: {
        requestId,
        ok: true,
        prompt: result.prompt,
        provider: result.provider,
        model: result.model,
        style: result.style,
      },
    });

    if (settings.saveHistory) {
      const now = Date.now();
      const item: HistoryItem = {
        id: requestId,
        imageUrl,
        thumbnail: imageUrl,
        prompt: result.prompt,
        provider: result.provider,
        model: result.model,
        style: result.style,
        pageUrl,
        pageTitle,
        createdAt: now,
        updatedAt: now,
        versions: [
          {
            id: requestId + ':v0',
            prompt: result.prompt,
            createdAt: now,
            source: 'extracted',
          },
        ],
      };
      await addHistory(item);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendToTab(tabId, {
      type: 'EXTRACT_ERROR',
      payload: { requestId, ok: false, error: message },
    });
  }
}

async function runRefine(
  historyId: string,
  current: string,
  instruction: string
): Promise<RefineResponse> {
  try {
    const settings = await getSettings();
    const result = await refinePrompt({ settings, current, instruction });
    if (!result.prompt) {
      return { ok: false, error: '模型返回了空提示词' };
    }
    const updated = await appendPromptVersion(historyId, result.prompt, 'refined', instruction);
    const versionId = updated?.versions[0]?.id || `${historyId}:r_${Date.now()}`;
    return {
      ok: true,
      prompt: result.prompt,
      provider: result.provider,
      model: result.model,
      versionId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'PING' } satisfies RuntimeMessage);
    if (reply) return;
  } catch {
    // 没有响应说明 content script 未注入
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/index.ts'],
    });
  } catch (err) {
    console.warn('[ImagePrompt] inject content script failed', err);
  }
}

async function sendToTab(tabId: number, message: RuntimeMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    console.warn('[ImagePrompt] sendToTab failed', err);
  }
}

// ============== 自动更新 ==============

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== UPDATE_ALARM_NAME) return;
  void runScheduledCheck({ silent: false });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (!changes['app_settings_v1']) return;
  // 设置变更后重新调度 alarm，并刷新徽章
  void rescheduleUpdateAlarm();
  void refreshActionBadge();
});

if (chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener(async (id) => {
    if (id !== UPDATE_NOTIFICATION_ID) return;
    chrome.notifications.clear(id);
    await applyUpdate();
  });
}

if (chrome.notifications?.onButtonClicked) {
  chrome.notifications.onButtonClicked.addListener(async (id, btnIdx) => {
    if (id !== UPDATE_NOTIFICATION_ID) return;
    chrome.notifications.clear(id);
    if (btnIdx === 0) {
      await applyUpdate();
    } else {
      const u = await getUpdateSettings();
      if (u.lastResult?.latest?.version) {
        await patchUpdateSettings({ dismissedVersion: u.lastResult.latest.version });
        await refreshActionBadge();
      }
    }
  });
}

async function rescheduleUpdateAlarm(): Promise<void> {
  if (!chrome.alarms) return;
  const u = await getUpdateSettings();
  await chrome.alarms.clear(UPDATE_ALARM_NAME).catch(() => false);
  if (!u.enabled) return;
  const periodInMinutes = Math.max(
    MIN_INTERVAL_MINUTES,
    Math.round(clampIntervalHours(u.intervalHours) * 60)
  );
  chrome.alarms.create(UPDATE_ALARM_NAME, {
    periodInMinutes,
    delayInMinutes: 1,
  });
}

interface RunCheckOpts {
  force?: boolean;
  silent?: boolean;
}

async function runUpdateCheck(opts: RunCheckOpts = {}): Promise<UpdateCheckResult> {
  const u = await getUpdateSettings();
  const result = await performUpdateCheck(u.feedUrl);
  await saveUpdateResult(result);
  await refreshActionBadge();
  if (result.hasUpdate && result.latest && !opts.silent) {
    await maybeNotify(result);
  }
  return result;
}

async function runScheduledCheck(opts: RunCheckOpts = {}): Promise<void> {
  const u = await getUpdateSettings();
  if (!u.enabled) return;
  // 距上次检查不足 1 小时则跳过（避免重复触发）
  if (!opts.force && u.lastCheckedAt && Date.now() - u.lastCheckedAt < 30 * 60_000) {
    return;
  }
  await runUpdateCheck(opts);
}

async function maybeNotify(result: UpdateCheckResult): Promise<void> {
  const u = await getUpdateSettings();
  const latest = result.latest;
  if (!latest) return;
  if (u.dismissedVersion && !isNewerVersion(latest.version, u.dismissedVersion)) {
    return;
  }
  if (!u.notifyDesktop || !chrome.notifications?.create) return;
  try {
    chrome.notifications.create(
      UPDATE_NOTIFICATION_ID,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: '图片提示词提取器 · 有新版本',
        message: `新版本 v${latest.version} 已发布。\n当前版本 v${result.current}。`,
        contextMessage: latest.name || '',
        buttons: [{ title: '立即更新' }, { title: '忽略此版本' }],
        priority: 1,
        requireInteraction: false,
      },
      () => void chrome.runtime.lastError
    );
  } catch (err) {
    console.warn('[ImagePrompt] notify failed', err);
  }
}

async function refreshActionBadge(): Promise<void> {
  if (!chrome.action) return;
  const u = await getUpdateSettings();
  const latest = u.lastResult?.latest;
  const showDot =
    !!latest &&
    !!u.lastResult?.hasUpdate &&
    isNewerVersion(latest.version, u.dismissedVersion || '0.0.0');
  try {
    if (showDot) {
      await chrome.action.setBadgeText({ text: 'NEW' });
      await chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
      await chrome.action.setTitle({
        title: `图片提示词提取器\n有新版本 v${latest!.version} 可用`,
      });
    } else {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: '图片提示词提取器' });
    }
  } catch {
    /* ignore */
  }
}

async function applyUpdate(): Promise<{
  ok: boolean;
  mode: 'native' | 'manual';
  message?: string;
  downloadUrl?: string;
  releaseUrl?: string;
}> {
  const u = await getUpdateSettings();
  const latest = u.lastResult?.latest;

  // 优先尝试 Chrome 商店原生更新（一键更新 + 自动 reload）
  if (await isStoreInstalled()) {
    const r = await tryNativeUpdate();
    if (r.status === 'update_available') {
      return { ok: true, mode: 'native', message: '已触发 Chrome 商店更新，正在重新加载…' };
    }
    if (r.status === 'no_update') {
      return { ok: true, mode: 'native', message: '当前已是最新版本' };
    }
    if (r.status === 'throttled') {
      return { ok: false, mode: 'native', message: r.message };
    }
    // 不支持 → 走手动模式
  }

  // 手动模式：打开下载/发布页让用户手动加载新版
  const url = latest?.downloadUrl || latest?.releaseUrl;
  if (!url) {
    return {
      ok: false,
      mode: 'manual',
      message: '尚未检测到新版本下载地址，请先在「设置 → 检查更新」中检查',
    };
  }
  try {
    await chrome.tabs.create({ url, active: true });
    return {
      ok: true,
      mode: 'manual',
      message: '已打开下载页面，下载后请到 chrome://extensions 重新加载已解压的扩展',
      downloadUrl: latest?.downloadUrl,
      releaseUrl: latest?.releaseUrl,
    };
  } catch (e) {
    return {
      ok: false,
      mode: 'manual',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// 兜底：service worker 启动时如果没有 alarm，则补建
void (async () => {
  if (!chrome.alarms) return;
  const all = await chrome.alarms.getAll();
  if (!all.find((a) => a.name === UPDATE_ALARM_NAME)) {
    await rescheduleUpdateAlarm();
  }
  await refreshActionBadge();
})();

// 暴露给 console 调试
(globalThis as unknown as { __imagePromptVersion?: string }).__imagePromptVersion =
  getCurrentVersion();
