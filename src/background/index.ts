import { extractPrompt, refinePrompt } from '@/lib/api';
import { fetchImageAsBase64, makeStorageThumbnail } from '@/lib/image';
import { addHistory, appendPromptVersion, getSettings, saveUpdateResult } from '@/lib/storage';
import type { HistoryItem, RefineResponse, RuntimeMessage, UpdateCheckResult } from '@/lib/types';
import { DEFAULT_FEED_URL, getCurrentVersion, performUpdateCheck } from '@/lib/updater';

const MENU_ID = 'extract-image-prompt';
/**
 * 兜底菜单：当原生 'image' 上下文没被 Chrome 命中时（CSS 背景图、canvas、
 * 内联 SVG、被遮罩覆盖的图片等），由内容脚本动态把它切到 visible:true。
 */
const MENU_ID_FALLBACK = 'extract-image-prompt-fallback';

/**
 * 最近一次内容脚本探测到的"鼠标位置图片"。每个 tab 一份，避免不同
 * 标签页相互覆盖。fallback 菜单点击时从这里取 URL。
 */
const pendingFallbackImage = new Map<number, { imageUrl: string; at: number }>();

function ensureContextMenus(): void {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: '🎨 提取图片 / 动图提示词',
        contexts: ['image'],
      },
      () => void chrome.runtime.lastError
    );
    chrome.contextMenus.create(
      {
        id: MENU_ID_FALLBACK,
        // fallback 主要服务于 <video>（含"假 GIF"）、<canvas>、内联 SVG、
        // CSS 背景图等场景，所以文案要把"视频 / 动图"显式标出来。
        title: '🎨 提取视频帧 / 动图提示词',
        // 这里覆盖 image 以外的常见上下文，再用 visible 动态控制显隐，
        // 避免在普通文本/页面上无脑出现菜单项。
        contexts: ['page', 'frame', 'link', 'selection', 'editable', 'video', 'audio'],
        visible: false,
      },
      () => void chrome.runtime.lastError
    );
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureContextMenus();
  // 首次安装：自动打开设置页，引导用户配置 API 并设置「数据目录」。
  // 这是"卸载/重装后能自动识别数据"工作流的关键一步 —— 用户必须在数据丢失前
  // 主动挑一个目录绑定。reason === 'install' 只在第一次安装时触发，更新/启用不会。
  if (details.reason === 'install') {
    try {
      chrome.runtime.openOptionsPage();
    } catch {
      /* ignore */
    }
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenus();
});

// 标签关闭时清理待处理的 fallback 图片缓存
chrome.tabs?.onRemoved.addListener((tabId) => {
  pendingFallbackImage.delete(tabId);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === MENU_ID) {
    // 原生 image 上下文 —— info.srcUrl 一定有
    const imageUrl = info.srcUrl;
    if (!imageUrl) return;
    await runExtraction({
      tabId: tab.id,
      imageUrl,
      pageUrl: tab.url || '',
      pageTitle: tab.title || '',
    });
    return;
  }

  if (info.menuItemId === MENU_ID_FALLBACK) {
    // 取出内容脚本最近一次探测到的 URL（CSS 背景图 / canvas / svg / …）
    const cached = pendingFallbackImage.get(tab.id);
    pendingFallbackImage.delete(tab.id);
    // 用完立刻把菜单藏回去，避免下次右键到非图片处仍然显示
    chrome.contextMenus.update(MENU_ID_FALLBACK, { visible: false }, () => {
      void chrome.runtime.lastError;
    });
    // 优先用缓存（带 data:/blob: 等），其次退回 info.srcUrl / linkUrl
    const imageUrl = cached?.imageUrl || info.srcUrl || info.linkUrl || '';
    if (!imageUrl) return;
    await runExtraction({
      tabId: tab.id,
      imageUrl,
      pageUrl: tab.url || '',
      pageTitle: tab.title || '',
    });
    return;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === 'CHECK_UPDATE') {
    runUpdateCheck().then((result) => {
      sendResponse({ ok: true, result });
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
  if (message?.type === 'CTX_MENU_PREP') {
    const tabId = sender.tab?.id;
    const imageUrl: string = message.payload?.imageUrl || '';
    if (tabId) {
      if (imageUrl) {
        pendingFallbackImage.set(tabId, { imageUrl, at: Date.now() });
      } else {
        pendingFallbackImage.delete(tabId);
      }
      // 只在"原生 image 上下文未命中"时才需要兜底菜单。
      // 如果是原生 <img>，Chrome 会同时显示 MENU_ID（image context），
      // 这里再显示 fallback 就会重复 —— 所以内容脚本只在非原生场景才
      // 发送非空 imageUrl，下面只需老实根据 imageUrl 是否存在切换 visible。
      chrome.contextMenus.update(
        MENU_ID_FALLBACK,
        { visible: !!imageUrl },
        () => void chrome.runtime.lastError
      );
    }
    sendResponse({ ok: true });
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

  // 立刻并行启动三件耗时的事：
  //   1) 读 settings (chrome.storage)
  //   2) 下载 / 规整图片
  //   3) 「乐观」发送 EXTRACT_PENDING 让 panel 立刻显示 loading
  //
  // 关键变化（这一版的核心优化）：不再先 PING content script、不再 await
  // sendToTab(EXTRACT_PENDING)。manifest 已声明 content_scripts: ['<all_urls>']
  // @ document_idle，所以 content script 在绝大多数页面上已经自动注入，PING
  // 唯一的"价值"就是消耗 10–50ms 阻塞主路径。我们改为「乐观发」：直接发消息，
  // 失败时（chrome:// / about: / 新装的扩展遇上已打开的旧 tab 等极少数场景）
  // 通过 chrome.runtime.lastError 回调发现，再异步注入 + 重发。这条兜底路径
  // 不阻塞主流程；用户点完菜单几乎瞬时就能看到 panel。
  const settingsPromise = getSettings();
  const imagePromise = fetchImageAsBase64(imageUrl);
  imagePromise.catch(() => undefined);

  postToTab(tabId, {
    type: 'EXTRACT_PENDING',
    payload: { requestId, imageUrl },
  });

  // 图片下载经常不是瞬间完成（跨域 / blob / 动图扁平化 / 视频抓帧 base64
  // 化都可能在 100ms～几秒级别）。如果 80ms 内还没完成，先把面板切到
  // 'fetching' 阶段；否则就让 extractPrompt 自己 emit 'calling'，避免
  // 在快路径上闪现一个无意义的 fetching。
  let imageReady = false;
  imagePromise.then(
    () => {
      imageReady = true;
    },
    () => {
      imageReady = true;
    }
  );
  setTimeout(() => {
    if (imageReady) return;
    postToTab(tabId, {
      type: 'EXTRACT_PROGRESS',
      payload: { requestId, stage: 'fetching' },
    });
  }, 80);

  try {
    const [settings, prefetched] = await Promise.all([settingsPromise, imagePromise]);
    const result = await extractPrompt({
      imageUrl,
      settings,
      prefetched,
      onProgress: (ev) => {
        // 流式阶段已经在 API 层节流到 ≈80ms 一次，这里直接转发到 content。
        postToTab(tabId, {
          type: 'EXTRACT_PROGRESS',
          payload: { requestId, stage: ev.stage, partial: ev.partial },
        });
      },
    });

    postToTab(tabId, {
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
      // 历史落库不阻塞下一次提取：用户连续抽几张图时不再排队，缩略图
      // 重新编码 + storage 写入都在后台完成。失败只打 debug，不影响 UI。
      void persistHistory({
        requestId,
        imageUrl,
        prompt: result.prompt,
        provider: result.provider,
        model: result.model,
        style: result.style,
        pageUrl,
        pageTitle,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postToTab(tabId, {
      type: 'EXTRACT_ERROR',
      payload: { requestId, ok: false, error: message },
    });
  }
}

async function persistHistory(params: {
  requestId: string;
  imageUrl: string;
  prompt: string;
  provider: HistoryItem['provider'];
  model: string;
  style: HistoryItem['style'];
  pageUrl: string;
  pageTitle: string;
}): Promise<void> {
  try {
    const now = Date.now();
    // 视频帧 / canvas / 扁平化动图传过来的 imageUrl 经常是大 dataUrl，
    // 直接整条塞进 chrome.storage.local 几十条就会撑爆 5MB 配额。
    // 这里统一压成 ≤32KB 的小缩略图后再入库（http(s) URL 原样保留）。
    const storedUrl = await makeStorageThumbnail(params.imageUrl);
    const item: HistoryItem = {
      id: params.requestId,
      imageUrl: storedUrl,
      thumbnail: storedUrl,
      prompt: params.prompt,
      provider: params.provider,
      model: params.model,
      style: params.style,
      pageUrl: params.pageUrl,
      pageTitle: params.pageTitle,
      createdAt: now,
      updatedAt: now,
      versions: [
        {
          id: params.requestId + ':v0',
          prompt: params.prompt,
          createdAt: now,
          source: 'extracted',
        },
      ],
    };
    await addHistory(item);
  } catch (err) {
    console.debug('[PromptExtracto] persist history failed', err);
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

/**
 * 「乐观」向 tab 发送消息：不 await content script ACK，不阻塞主流程。
 *
 * 因为 manifest 已声明 content_scripts: ['<all_urls>'] @ document_idle，content script
 * 在 99% 的页面上已经自动注入，第一次发送就能命中。只有极少数场景（chrome:// /
 * about: / file:// 等 manifest 不允许注入的页，或扩展刚装好遇上旧 tab 还没刷新）
 * 会通过 chrome.runtime.lastError 报错，那时我们再异步走「注入 → 重发」兜底，**绝
 * 不让 panel 弹出 / 结果回传等用户感知最强的路径多等任何一次跨进程往返**。
 */
function postToTab(tabId: number, message: RuntimeMessage): void {
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      const err = chrome.runtime.lastError;
      if (!err) return;
      // 异步兜底：注入 content script 后再重发一次。仍然 fire-and-forget。
      void injectContentScript(tabId).then((ok) => {
        if (!ok) {
          console.warn('[PromptExtracto] postToTab fallback inject failed:', err.message);
          return;
        }
        chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError);
      });
    });
  } catch (err) {
    console.warn('[PromptExtracto] postToTab threw synchronously', err);
  }
}

async function injectContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/index.ts'],
    });
    return true;
  } catch (err) {
    console.warn('[PromptExtracto] inject content script failed', err);
    return false;
  }
}

// ============== 检查更新（仅手动） ==============

async function runUpdateCheck(): Promise<UpdateCheckResult> {
  const result = await performUpdateCheck(DEFAULT_FEED_URL);
  await saveUpdateResult(result);
  return result;
}

// 兜底：service worker 冷启动时确保右键菜单一定存在。
ensureContextMenus();

(globalThis as unknown as { __imagePromptVersion?: string }).__imagePromptVersion =
  getCurrentVersion();
