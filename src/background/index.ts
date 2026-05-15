import { extractPrompt, refinePrompt } from '@/lib/api';
import { fetchImageAsBase64, makeStorageThumbnail } from '@/lib/image';
import {
  addHistory,
  appendPromptVersion,
  getHistoryItem,
  getSettings,
  removePromptVersion,
  restorePromptVersion,
  saveSettings,
  saveUpdateResult,
} from '@/lib/storage';
import { ensureLibraryReady } from '@/lib/storage/history';
import { getByDedupeKey, naturalDedupeKey, toPublicHistory } from '@/lib/storage/historyDb';
import type { HistoryItem, RefineResponse, RuntimeMessage, StrategyId, UpdateCheckResult } from '@/lib/types';
import { PROMPT_EXTRACTO_KEEPALIVE_PORT } from '@/lib/keepalivePort';
import { DEFAULT_FEED_URL, getCurrentVersion, performUpdateCheck } from '@/lib/updater';

const MENU_ID = 'extract-image-prompt';
/**
 * 兜底菜单：当原生 'image' / 'video' 上下文没被 Chrome 命中时（CSS 背景图、canvas、
 * 内联 SVG、被遮罩覆盖的图片 / 视频等），由内容脚本动态把它切到 visible:true。
 */
const MENU_ID_FALLBACK = 'extract-image-prompt-fallback';

/**
 * 最近一次内容脚本探测到的"鼠标位置图片"。每个 tab 一份，避免不同
 * 标签页相互覆盖。fallback 菜单点击时从这里取 URL。
 */
const pendingFallbackImage = new Map<number, { imageUrl: string; at: number }>();

/** 各标签页内若干 frame 各自 connect；仅存引用便于 disconnect 时清理，不参与业务逻辑。 */
const keepalivePortsByTab = new Map<number, Set<chrome.runtime.Port>>();
const keepalivePortsWithoutTab = new Set<chrome.runtime.Port>();

function registerKeepalivePort(port: chrome.runtime.Port): void {
  const tabId = port.sender?.tab?.id;
  if (tabId != null) {
    let set = keepalivePortsByTab.get(tabId);
    if (!set) {
      set = new Set();
      keepalivePortsByTab.set(tabId, set);
    }
    set.add(port);
  } else {
    keepalivePortsWithoutTab.add(port);
  }
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    const tid = port.sender?.tab?.id;
    if (tid != null) {
      const set = keepalivePortsByTab.get(tid);
      if (set) {
        set.delete(port);
        if (set.size === 0) keepalivePortsByTab.delete(tid);
      }
    } else {
      keepalivePortsWithoutTab.delete(port);
    }
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PROMPT_EXTRACTO_KEEPALIVE_PORT) return;
  registerKeepalivePort(port);
});

function ensureContextMenus(): void {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: '提取图片提示词',
        // 与 contexts: ['video'] 一并注册：原生 <video> 右键时 Chrome 走 video 上下文，
        // 不依赖 CTX_MENU_PREP 异步切换可见性，避免 MV3 SW 竞态导致菜单项不出现。
        contexts: ['image', 'video'],
      },
      () => void chrome.runtime.lastError
    );
    chrome.contextMenus.create(
      {
        id: MENU_ID_FALLBACK,
        // 兜底：遮罩下的 <img>、CSS 背景图、canvas、内联 SVG 等非原生 image/video 上下文。
        title: '提取图片提示词',
        contexts: ['page', 'frame', 'link', 'selection', 'editable'],
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
    // 原生 image / video 上下文 —— Chrome 会提供 srcUrl（个别站点可能为空，直接忽略）
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
    const { tab, focusId, dock } = (message.payload || {}) as {
      tab?: 'settings' | 'library';
      focusId?: string;
      dock?: 'refine' | 'versions';
    };
    // 没有 deep-link 参数时直接走原生 API，保留默认行为
    if (!tab && !focusId) {
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return true;
    }
    // 构造带 hash 的 options URL；OptionsApp 会在 mount 时读取 hash 并消费
    const params = new URLSearchParams();
    if (tab) params.set('tab', tab);
    if (focusId) params.set('focus', focusId);
    if (dock === 'refine' || dock === 'versions') params.set('dock', dock);
    const optionsPath = 'src/options/index.html';
    const targetUrl = chrome.runtime.getURL(optionsPath) + '#' + params.toString();
    // 已经打开过 options 页时，复用那个 tab 并刷新到目标 url，避免开一堆重复 tab
    const existingMatch = chrome.runtime.getURL(optionsPath) + '*';
    chrome.tabs.query({ url: existingMatch }, (tabs) => {
      const found = tabs[0];
      if (found?.id != null) {
        chrome.tabs.update(found.id, { url: targetUrl, active: true });
        if (found.windowId != null) {
          chrome.windows.update(found.windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url: targetUrl });
      }
    });
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === 'SET_PROMPT_STRATEGY') {
    const strategy = message.payload?.strategy as StrategyId | undefined;
    if (!strategy) {
      sendResponse({ ok: false, error: '缺少 strategy' });
      return true;
    }
    void (async () => {
      try {
        const s = await getSettings();
        await saveSettings({ ...s, promptStrategy: strategy });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }
  if (message?.type === 'SET_ONE_CLICK_REWRITE_RANDOMNESS') {
    const level = message.payload?.level;
    if (level !== 'subtle' && level !== 'moderate' && level !== 'bold') {
      sendResponse({ ok: false, error: '缺少或无效的 level' });
      return true;
    }
    void (async () => {
      try {
        const s = await getSettings();
        await saveSettings({ ...s, oneClickRewriteRandomness: level });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }
  if (message?.type === 'GET_HISTORY_ITEM') {
    const id = message.payload?.id;
    if (!id) {
      sendResponse({ ok: false, error: '缺少 id' });
      return true;
    }
    void getHistoryItem(id).then((item) => sendResponse({ ok: true, item }));
    return true;
  }
  if (message?.type === 'APPEND_PROMPT_VERSION') {
    const p = message.payload;
    if (!p?.id || typeof p.prompt !== 'string') {
      sendResponse({ ok: false, error: '参数缺失' });
      return true;
    }
    void appendPromptVersion(p.id, p.prompt, p.source ?? 'edited', p.note, p.meta).then((item) =>
      sendResponse({ ok: true, item })
    );
    return true;
  }
  if (message?.type === 'RESTORE_PROMPT_VERSION') {
    const p = message.payload;
    if (!p?.id || !p.versionId) {
      sendResponse({ ok: false, error: '参数缺失' });
      return true;
    }
    void restorePromptVersion(p.id, p.versionId).then((item) => sendResponse({ ok: true, item }));
    return true;
  }
  if (message?.type === 'REMOVE_PROMPT_VERSION') {
    const p = message.payload;
    if (!p?.id || !p.versionId) {
      sendResponse({ ok: false, error: '参数缺失' });
      return true;
    }
    void removePromptVersion(p.id, p.versionId).then((item) => sendResponse({ ok: true, item }));
    return true;
  }
  if (message?.type === 'CHECK_UPDATE') {
    runUpdateCheck()
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((e) => {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return true;
  }
  if (message?.type === 'REFINE_PROMPT') {
    const { historyId, instruction, current } = message.payload || {};
    if (!historyId || !instruction || typeof current !== 'string') {
      sendResponse({ ok: false, error: '参数缺失' } satisfies RefineResponse);
      return true;
    }
    // sender.tab?.id 仅在 content script 浮动面板发起时存在；popup / options
    // 没有 tab，progress 直接 fire-and-forget 丢弃即可。
    runRefine(historyId, current, instruction, sender.tab?.id)
      .then((res) => sendResponse(res))
      .catch((e) => {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } satisfies RefineResponse);
      });
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
  if (message?.type === 'OPEN_IN_PANEL') {
    const { historyId, dock } = (message.payload || {}) as {
      historyId?: string;
      dock?: 'refine' | 'versions';
    };
    if (!historyId) {
      sendResponse({ ok: false, error: '缺少 historyId' });
      return true;
    }
    void (async () => {
      try {
        const item = await getHistoryItem(historyId);
        if (!item) {
          sendResponse({ ok: false, error: '未找到该条历史记录' });
          return;
        }

        const appSettings = await getSettings();

        const pageUrl = item.pageUrl;
        const isHttpPage = /^https?:/i.test(pageUrl);

        let targetId: number | undefined;
        let targetWindowId: number | undefined;

        if (isHttpPage) {
          // 优先复用已经打开的来源页 tab，避免重复开新 tab
          const existing = await findTabByUrl(pageUrl);
          if (existing?.id) {
            targetId = existing.id;
            targetWindowId = existing.windowId ?? undefined;
            try {
              await chrome.tabs.update(targetId, { active: true });
              if (existing.windowId != null) {
                await chrome.windows.update(existing.windowId, { focused: true });
              }
            } catch { /* ignore */ }
            try {
              const live = await chrome.tabs.get(targetId);
              if (live.status !== 'complete') {
                await waitForTabComplete(targetId);
              }
            } catch { /* ignore */ }
          } else {
            const tab = await chrome.tabs.create({ url: pageUrl, active: true });
            if (!tab.id) {
              sendResponse({ ok: false, error: '打开来源页失败' });
              return;
            }
            targetId = tab.id;
            targetWindowId = tab.windowId;
            if (tab.windowId != null) {
              try { await chrome.windows.update(tab.windowId, { focused: true }); } catch { /* ignore */ }
            }
            await waitForTabComplete(targetId);
          }
        } else {
          // pageUrl 为空或非 http(s)，退回到原逻辑：找一个可注入的网页标签页
          const target = await pickPanelTargetTab();
          if (!target?.id) {
            sendResponse({
              ok: false,
              error: '未找到可注入悬浮窗的网页标签页，请先打开任意普通网页（http/https/file）',
            });
            return;
          }
          targetId = target.id;
          targetWindowId = target.windowId ?? undefined;
          try {
            await chrome.tabs.update(targetId, { active: true });
            if (target.windowId != null) {
              await chrome.windows.update(target.windowId, { focused: true });
            }
          } catch {
            /* ignore: tab/window 可能瞬时不可用 */
          }
        }

        const delivered = await sendToTabReliably(targetId, {
          type: 'PANEL_FROM_HISTORY',
          payload: {
            historyId,
            item,
            oneClickRewriteRandomness: appSettings.oneClickRewriteRandomness,
            ...(dock === 'refine' || dock === 'versions' ? { dock } : {}),
          },
        });
        if (!delivered) {
          sendResponse({
            ok: false,
            error: '无法在目标网页显示悬浮窗，请刷新该页面后重试',
          });
          return;
        }
        sendResponse({ ok: true, tabId: targetId, windowId: targetWindowId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error: msg });
      }
    })();
    return true;
  }
  if (message?.type === 'EXTRACT_PROMPT') {
    const { imageUrl, pageUrl, pageTitle, requestId, strategyOverride } = message.payload || {};
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
      strategyOverride,
    });
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

/**
 * 与 {@link addHistory} 使用相同的缩略图 + dedupe 键，在识图完成前查询是否已有同图记录；
 * 若有则通知浮窗预填 versions，并把缩略图字符串交给后续 persist 复用（避免二次编码）。
 *
 * Dedupe 与现库一致：HTTP(S) 通常为原 URL 字符串；大 data URL 为压限后的 JPEG dataUrl。
 */
async function prefetchLibraryVersionsForExtract(
  tabId: number,
  requestId: string,
  imageUrl: string,
): Promise<string | undefined> {
  try {
    await ensureLibraryReady();
    const storedUrl = await makeStorageThumbnail(imageUrl);
    const key = naturalDedupeKey({ imageUrl: storedUrl, thumbnail: storedUrl });
    if (key) {
      const row = await getByDedupeKey(key);
      if (row) {
        const item = toPublicHistory(row);
        postToTab(tabId, {
          type: 'HISTORY_PREFETCH',
          payload: {
            requestId,
            storageId: item.id,
            versions: item.versions,
            prompt: item.prompt,
          },
        });
      }
    }
    return storedUrl;
  } catch {
    return undefined;
  }
}

async function runExtraction(params: {
  tabId: number;
  imageUrl: string;
  pageUrl: string;
  pageTitle: string;
  requestId?: string;
  strategyOverride?: import('@/lib/strategies-meta').StrategyId;
}): Promise<void> {
  const { tabId, imageUrl, pageUrl, pageTitle, strategyOverride } = params;
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

  /** 与「是否写入提示词库」挂钩；saveHistory 为 false 时保持 resolved(undefined)。 */
  let thumbnailForPersistPromise: Promise<string | undefined> = Promise.resolve(undefined);

  postToTab(tabId, {
    type: 'EXTRACT_PENDING',
    payload: { requestId, imageUrl },
  });

  // settings 读取完成后立刻补发一次 strategy + provider + model 信息，
  // 让 loading 面板把「正在使用 X 策略 / 谁的什么模型」标签亮出来。
  // 不阻塞主链路：发送是 fire-and-forget。
  //
  // 之所以也带 provider/model：用户在 loading 阶段就想知道"这次到底用的
  // 哪个模型在跑"——尤其是配了多家 provider / 跑前刚切换过的场景。等到
  // EXTRACT_RESULT 才知道就太晚了（生成可能要十几秒）。
  //
  // 若开启入库：并行预取同图已有 versions（HISTORY_PREFETCH），并缓存缩略图供 persist 复用。
  //
  // 注意 stage 不带，由 content/index.ts 在 stage===undefined 时跳过覆盖，
  // 避免把已经推进到 'fetching' 的进度条踢回默认状态。
  void settingsPromise.then(
    (settings) => {
      const activeProvider = settings.activeProvider;
      const activeModel = settings.providers[activeProvider]?.model;
      postToTab(tabId, {
        type: 'EXTRACT_PROGRESS',
        payload: {
          requestId,
          strategy: strategyOverride ?? settings.promptStrategy,
          provider: activeProvider,
          model: activeModel,
          oneClickRewriteRandomness: settings.oneClickRewriteRandomness,
        },
      });
      if (settings.saveHistory) {
        thumbnailForPersistPromise = prefetchLibraryVersionsForExtract(tabId, requestId, imageUrl);
      }
    },
    () => undefined
  );

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
    const [rawSettings, prefetched] = await Promise.all([settingsPromise, imagePromise]);
    const settings = strategyOverride
      ? { ...rawSettings, promptStrategy: strategyOverride }
      : rawSettings;
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
      const precomputedThumbnail = await thumbnailForPersistPromise;
      // 历史落库不阻塞下一次提取：用户连续抽几张图时不再排队，缩略图
      // 重新编码 + storage 写入都在后台完成。失败只打 debug，不影响 UI。
      //
      // 落库完成后必须把「storage 里真实落地的 id + versions」回传给 content，
      // 因为 addHistory 对同图会合并到旧记录上、真实 id 可能与 requestId 不同。
      // 这条 HISTORY_READY 是浮窗后续 save / restore / syncVersions 不出 race
      // 的关键 —— content 收到后会把 panel.requestId 切到 actualId。
      void persistHistory({
        requestId,
        imageUrl,
        prompt: result.prompt,
        provider: result.provider,
        model: result.model,
        style: result.style,
        pageUrl,
        pageTitle,
        strategy: settings.promptStrategy,
        precomputedThumbnail,
      }).then((stored) => {
        if (!stored) return;
        postToTab(tabId, {
          type: 'HISTORY_READY',
          payload: {
            requestId,
            actualId: stored.id,
            versions: stored.versions,
            prompt: stored.prompt,
          },
        });
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
  strategy?: import('@/lib/strategies-meta').StrategyId;
  /** 与预取/去重同源时传入，避免对同一 imageUrl 二次 makeStorageThumbnail */
  precomputedThumbnail?: string;
}): Promise<HistoryItem | undefined> {
  try {
    const now = Date.now();
    // 视频帧 / canvas / 扁平化动图传过来的 imageUrl 经常是大 dataUrl，
    // 直接整条塞进 chrome.storage.local 几十条就会撑爆 5MB 配额。
    // 这里统一压成 ≤32KB 的小缩略图后再入库（http(s) URL 原样保留）。
    const storedUrl =
      params.precomputedThumbnail !== undefined
        ? params.precomputedThumbnail
        : await makeStorageThumbnail(params.imageUrl);
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
      strategy: params.strategy,
      versions: [
        {
          id: params.requestId + ':v0',
          prompt: params.prompt,
          versionNo: 0,
          createdAt: now,
          source: 'extracted',
          meta: {
            provider: params.provider,
            model: params.model,
            style: params.style,
            strategy: params.strategy,
          },
        },
      ],
    };
    // addHistory 返回「真正落库的那条」—— 同图反推时会是合并后的旧记录（id 不变），
    // 调用方据此把 content 那边的 requestId 切到真实 id。
    return await addHistory(item);
  } catch (err) {
    console.debug('[PromptExtracto] persist history failed', err);
    return undefined;
  }
}

async function runRefine(
  historyId: string,
  current: string,
  instruction: string,
  tabId?: number
): Promise<RefineResponse> {
  try {
    const settings = await getSettings();
    // 面板路径：把进度发到对应 tab 的 content script。
    // popup / options 无 tab：用 runtime.sendMessage 广播给扩展页（谁正在 refine 谁消费）。
    const onProgress = (ev: {
      stage: 'calling' | 'streaming';
      partial?: string;
    }) => {
      const payload = { historyId, stage: ev.stage, partial: ev.partial };
      if (tabId != null) {
        postToTab(tabId, { type: 'REFINE_PROGRESS', payload });
        return;
      }
      chrome.runtime.sendMessage({ type: 'REFINE_PROGRESS', payload }, () => {
        void chrome.runtime.lastError;
      });
    };
    const result = await refinePrompt({ settings, current, instruction, onProgress });
    if (!result.prompt) {
      return { ok: false, error: '模型返回了空提示词' };
    }
    const updated = await appendPromptVersion(
      historyId,
      result.prompt,
      'refined',
      instruction,
      {
        provider: result.provider,
        model: result.model,
        style: settings.outputStyle,
      }
    );
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
 * 可靠地向 tab 发送消息：轮询 PING + 校验业务消息是否 sendMessage 成功。
 *
 * 用于 OPEN_IN_PANEL 等用户主动操作——必须保证消息送达，不能 fire-and-forget。
 * 新建 tab 场景下 content script 在 document_idle 注入，`waitForTabComplete`
 * 只等页面 complete，listener 可能还没注册完，直接发消息会丢。这里通过
 * PING→ACK 轮询；多轮 PING 仍失败时再程序化注入，避免与 declarative 注入过早叠打。
 */
async function sendToTabReliably(
  tabId: number,
  message: RuntimeMessage,
  maxAttempts = 8,
  intervalMs = 150,
): Promise<boolean> {
  const INJECT_AFTER_ATTEMPTS = 3;
  let programmaticInjected = false;

  for (let i = 0; i < maxAttempts; i++) {
    const alive = await pingTab(tabId);
    if (alive) {
      const sent = await sendTabMessageOk(tabId, message);
      if (sent) return true;
    } else if (i >= INJECT_AFTER_ATTEMPTS && !programmaticInjected) {
      programmaticInjected = true;
      await injectContentScript(tabId);
    }
    await sleep(intervalMs);
  }
  const finalOk = await sendTabMessageOk(tabId, message);
  if (!finalOk) {
    console.warn('[PromptExtracto] sendToTabReliably: final send failed', tabId);
  }
  return finalOk;
}

/** tabs.sendMessage 是否无 lastError（用于确认业务消息送达）。 */
function sendTabMessageOk(tabId: number, message: RuntimeMessage): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        resolve(!chrome.runtime.lastError);
      });
    } catch {
      resolve(false);
    }
  });
}

function pingTab(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, () => {
        if (chrome.runtime.lastError) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch {
      resolve(false);
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

/**
 * 在所有已打开 tab 中找到 URL 匹配的那个（忽略 hash/fragment）。
 * 优先匹配 active tab，其次按 lastAccessed 取最近的。
 */
async function findTabByUrl(targetUrl: string): Promise<chrome.tabs.Tab | null> {
  try {
    const urlObj = new URL(targetUrl);
    // 构造不含 hash 的 origin + pathname + search 用于比对
    const canonical = urlObj.origin + urlObj.pathname + urlObj.search;
    const all = await chrome.tabs.query({});
    const matches = all.filter((t) => {
      if (!t.url) return false;
      try {
        const u = new URL(t.url);
        return (u.origin + u.pathname + u.search) === canonical;
      } catch { return false; }
    });
    if (matches.length === 0) return null;
    // 优先返回 active 的
    const active = matches.find((t) => t.active);
    if (active) return active;
    // 否则按 lastAccessed 排序取最近的
    matches.sort((a, b) => {
      const la = (a as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed || 0;
      const lb = (b as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed || 0;
      return lb - la;
    });
    return matches[0];
  } catch {
    return null;
  }
}

/**
 * 给「召回到悬浮窗」流程挑选一个能注入 content script 的目标 tab。
 *
 * 选择优先级：
 *   1. 当前 active tab（如果是普通网页）—— popup 发起的最常见情况
 *   2. 全部 tab 里按 lastAccessed 倒序找第一个普通网页 tab —— options 页
 *      自己是 chrome-extension://，active tab 落在它身上无法注入，
 *      此时找用户上一秒还在看的那张普通网页就是最自然的目标
 *   3. 都没有 → 返回 null，让上层提示用户先打开一个普通网页
 *
 * "普通网页" = url 协议是 http(s)/file/ftp。明确排除 chrome:// /
 * chrome-extension:// / edge:// / about: / view-source: / devtools://
 * 等扩展无法注入的内部页。
 */
async function pickPanelTargetTab(): Promise<chrome.tabs.Tab | null> {
  const isInjectable = (url?: string): boolean => {
    if (!url) return false;
    return /^(https?:|file:|ftp:)/.test(url);
  };

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (activeTab && isInjectable(activeTab.url)) return activeTab;
  } catch {
    /* ignore */
  }

  try {
    const all = await chrome.tabs.query({});
    const candidates = all
      .filter((t) => isInjectable(t.url))
      // chrome.tabs.Tab.lastAccessed 在 Chrome 121+ 上可用；旧版本上拿不到
      // 字段时 fallback 到 0，让排序退化为"以查询返回顺序大致接近最近"。
      .sort((a, b) => {
        const la = (a as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed || 0;
        const lb = (b as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed || 0;
        return lb - la;
      });
    return candidates[0] || null;
  } catch {
    return null;
  }
}

/**
 * 等待指定 tab 加载完成（status === 'complete'）。
 * 用于在新建 tab 打开原图后、注入面板前确保页面和 content script 已就绪。
 * 带 8 秒超时兜底，避免超慢页面永久挂起。
 */
function waitForTabComplete(tabId: number, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    // 可能在我们挂监听之前就已经 complete 了
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === 'complete') done();
    }).catch(() => done());
    setTimeout(done, timeoutMs);
  });
}

function getDeclarativeContentScriptFiles(): string[] {
  const m = chrome.runtime.getManifest() as chrome.runtime.ManifestV3;
  const js = m.content_scripts?.[0]?.js;
  return Array.isArray(js) ? js : [];
}

async function injectContentScript(tabId: number): Promise<boolean> {
  const files = getDeclarativeContentScriptFiles();
  if (files.length === 0) {
    console.warn('[PromptExtracto] injectContentScript: manifest has no content_scripts[0].js');
    return false;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files,
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
