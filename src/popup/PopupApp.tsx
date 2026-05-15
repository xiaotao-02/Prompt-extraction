import { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  Settings,
  Sparkles,
  Trash2,
  Check,
  Pencil,
  History,
  X,
  Wand2,
  PanelTopOpen,
  ChevronRight,
} from 'lucide-react';
import {
  LIBRARY_REV_KEY,
  listRecentHistory,
  removeHistory,
  getSettings,
} from '@/lib/storage';
import { SETTINGS_KEY } from '@/lib/storage/keys';
import type { HistoryItem } from '@/lib/types';
import { formatTime } from '@/lib/format/time';
import { sendOpenInPanel, sendOpenOptions } from '@/lib/messaging/openSurfaces';
import { PopupVersionsInline } from './PopupVersionsInline';
import { usePopupVersionsDetail } from './usePopupVersionsDetail';

type OpenLibraryDock = 'refine' | 'versions';

type ToolbarPromptMode = 'edit' | 'refine';

function openLibraryItem(itemId: string, dock?: OpenLibraryDock) {
  sendOpenOptions(
    {
      tab: 'library',
      focusId: itemId,
      ...(dock ? { dock } : {}),
    },
    () => void chrome.runtime.lastError
  );
}

function sendRecallToPanel(
  item: HistoryItem,
  setTip: (s: string | null) => void,
  dock?: OpenLibraryDock
) {
  setTip(null);
  sendOpenInPanel(item.id, {
    dock,
    onResponse: (resp, lastErr) => {
      if (lastErr || !resp) {
        setTip(lastErr || '后台未响应');
        return;
      }
      if (!resp.ok) {
        setTip(resp.error || '召回失败');
        return;
      }
      setTimeout(() => window.close(), 60);
    },
  });
}

export default function PopupApp() {
  const [list, setList] = useState<HistoryItem[]>([]);
  const [toolbarPromptTarget, setToolbarPromptTarget] = useState<'library' | 'panel'>('library');
  const [recallTip, setRecallTip] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = useCallback(() => listRecentHistory(80).then(setList), []);
  const {
    versionsExpandedId,
    versionsDetailItem,
    versionsDetailLoading,
    toggleVersionsPanel,
    refreshVersionsDetailAfterMutation,
    collapseVersionsForItem,
  } = usePopupVersionsDetail(load);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void getSettings().then((s) => setToolbarPromptTarget(s.popupToolbarPromptAction ?? 'library'));
  }, []);

  useEffect(() => {
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: chrome.storage.AreaName
    ) => {
      if (area === 'local' && LIBRARY_REV_KEY in changes) load();
      if (area === 'sync' && SETTINGS_KEY in changes) {
        void getSettings().then((s) => setToolbarPromptTarget(s.popupToolbarPromptAction ?? 'library'));
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, [load]);

  const runToolbarPromptMode = (item: HistoryItem, mode: ToolbarPromptMode) => {
    if (toolbarPromptTarget === 'panel') {
      const dock = mode === 'refine' ? 'refine' : undefined;
      sendRecallToPanel(item, setRecallTip, dock);
    } else {
      if (mode === 'edit') openLibraryItem(item.id);
      else openLibraryItem(item.id, 'refine');
    }
  };

  const onCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1200);
  };

  const onDelete = async (item: HistoryItem) => {
    collapseVersionsForItem(item.id);
    await removeHistory(item.id);
    load();
  };

  const openExtensionPanel = () => {
    chrome.runtime.openOptionsPage();
  };

  const openOptionsSettingsTab = () => {
    sendOpenOptions({ tab: 'settings' }, () => void chrome.runtime.lastError);
  };

  const recallToPanel = (item: HistoryItem) => sendRecallToPanel(item, setRecallTip);

  return (
    <div className="flex flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-200/90 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/40 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src={chrome.runtime.getURL('icons/icon-48.png')}
            alt="Prompt Extracto"
            className="w-8 h-8 rounded-lg object-cover flex-none ring-1 ring-zinc-200/80 dark:ring-zinc-700"
          />
          <div className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 truncate">
            Prompt Extracto
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          <button
            type="button"
            onClick={openExtensionPanel}
            title="打开扩展选项页面（插件面板）"
            aria-label="打开扩展选项页面（插件面板）"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-violet-600 hover:bg-violet-500 text-white shadow-sm"
          >
            进入插件面板
            <ChevronRight className="w-3.5 h-3.5 opacity-90" aria-hidden />
          </button>
        </div>
      </header>

      {recallTip && (
        <div className="px-4 py-2 text-[11px] leading-snug bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-b border-rose-200/60 dark:border-rose-500/30 flex items-start gap-2">
          <X className="w-3 h-3 mt-0.5 flex-none" />
          <span className="flex-1">{recallTip}</span>
          <button
            onClick={() => setRecallTip(null)}
            className="p-0.5 rounded hover:bg-rose-100 dark:hover:bg-rose-500/20"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="bg-zinc-50/50 dark:bg-zinc-950/35">
        {list.length === 0 ? (
          <EmptyState
            onOpenExtensionPanel={openExtensionPanel}
            onOpenSettingsTab={openOptionsSettingsTab}
          />
        ) : (
          <ul className="px-2 py-2 space-y-2">
            {list.map((item) => {
              const versionCount = item.versions?.length || 0;
              const canToggleVersions = versionCount > 1;
              return (
                <li
                  key={item.id}
                  className="rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/45 p-3 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
                >
                  <div
                    className={`flex gap-3 items-start w-full rounded-lg outline-none transition-colors ${
                      canToggleVersions
                        ? `cursor-pointer hover:bg-zinc-50/90 dark:hover:bg-zinc-800/35 -m-1 p-1 ${
                            versionsExpandedId === item.id
                              ? 'ring-1 ring-violet-500/35 dark:ring-violet-400/25'
                              : ''
                          }`
                        : ''
                    }`}
                    role={canToggleVersions ? 'button' : undefined}
                    tabIndex={canToggleVersions ? 0 : undefined}
                    aria-expanded={canToggleVersions ? versionsExpandedId === item.id : undefined}
                    aria-label={canToggleVersions ? '展开或收起历史版本' : undefined}
                    title={canToggleVersions ? '点击展开或收起历史版本' : undefined}
                    onClick={canToggleVersions ? () => toggleVersionsPanel(item) : undefined}
                    onKeyDown={
                      canToggleVersions
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleVersionsPanel(item);
                            }
                          }
                        : undefined
                    }
                  >
                    <img
                      src={item.thumbnail}
                      alt=""
                      className="w-14 h-14 rounded-lg object-cover bg-zinc-100 dark:bg-zinc-800 flex-none"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-zinc-500 mb-1 flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-px rounded bg-zinc-100 dark:bg-zinc-800">
                          {item.provider}
                        </span>
                        <span className="truncate min-w-0 max-w-[220px]">{item.model}</span>
                        <span>·</span>
                        <span>{formatTime(item.updatedAt || item.createdAt)}</span>
                        {versionCount > 1 && (
                          <span className="px-1.5 py-px rounded bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300">
                            v{versionCount}
                          </span>
                        )}
                      </div>

                      <p className="text-[13px] leading-[1.6] text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words line-clamp-3">
                        {item.prompt}
                      </p>
                    </div>
                  </div>

                  <div
                    className="mt-2 flex gap-3 items-center min-w-0"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className="w-14 flex-shrink-0 pointer-events-none" aria-hidden />
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <div
                        className="flex flex-nowrap flex-1 min-w-0 gap-1 overflow-x-auto overflow-y-hidden py-px [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-600"
                      >
                        <button
                          type="button"
                          onClick={() => onCopy(item.prompt, item.id)}
                          className="inline-flex flex-none items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[11px]"
                        >
                          {copiedKey === item.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-500" />
                              <span className="text-emerald-500">已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" /> 复制
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => runToolbarPromptMode(item, 'edit')}
                          title="编辑（默认打开提示词库；可在「设置」中改为网页浮动面板）"
                          className="inline-flex flex-none items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[11px]"
                        >
                          <Pencil className="w-3 h-3" /> 编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => runToolbarPromptMode(item, 'refine')}
                          title="AI 调整（默认在提示词库；可在设置中改为浮动面板）"
                          className="inline-flex flex-none items-center gap-1 px-2 py-1 rounded-md hover:bg-violet-50 dark:hover:bg-violet-500/10 text-violet-600 dark:text-violet-300 text-[11px]"
                        >
                          <Wand2 className="w-3 h-3" /> AI 调整
                        </button>
                        <button
                          type="button"
                          onClick={() => recallToPanel(item)}
                          className="inline-flex flex-none items-center gap-1 px-2 py-1 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 text-[11px]"
                          title="把这条提示词召回到当前网页的编辑弹窗，继续手动调整 / AI 调整"
                        >
                          <PanelTopOpen className="w-3 h-3" /> 弹窗编辑
                        </button>
                        {versionCount > 1 && (
                          <button
                            type="button"
                            onClick={() => toggleVersionsPanel(item)}
                            title="在此弹窗中查看与管理历史版本"
                            className={`inline-flex flex-none items-center gap-1 px-2 py-1 rounded-md text-[11px] ${
                              versionsExpandedId === item.id
                                ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                                : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                            }`}
                          >
                            <History className="w-3 h-3" /> 版本 · {versionCount}
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onDelete(item)}
                        className="inline-flex flex-none items-center gap-1 px-2 py-1 rounded-md hover:bg-rose-50 dark:hover:bg-rose-500/10 text-zinc-400 hover:text-rose-500 text-[11px]"
                        title="删除此条"
                        aria-label="删除此条记录"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {versionsExpandedId === item.id && (
                    <div className="w-full min-w-0">
                      {versionsDetailLoading && versionsDetailItem?.id !== item.id ? (
                        <div className="mt-3 rounded-lg border border-zinc-200/80 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-950/40 px-3 py-6 text-center text-[11px] text-zinc-500">
                          正在加载历史版本…
                        </div>
                      ) : versionsDetailItem && versionsDetailItem.id === item.id ? (
                        <PopupVersionsInline
                          item={versionsDetailItem}
                          copiedKey={copiedKey}
                          onCopy={onCopy}
                          onAfterMutation={refreshVersionsDetailAfterMutation}
                        />
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  onOpenExtensionPanel,
  onOpenSettingsTab,
}: {
  onOpenExtensionPanel: () => void;
  onOpenSettingsTab: () => void;
}) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-500/20 dark:to-violet-500/20 flex items-center justify-center mb-4 ring-1 ring-zinc-200/60 dark:ring-zinc-700/60">
        <Sparkles className="w-6 h-6 text-violet-500" />
      </div>
      <h3 className="text-sm font-semibold mb-1 text-zinc-900 dark:text-zinc-100">还没有任何记录</h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-5">
        在任意网页上 <b>右键点击图片</b>，
        <br />
        选择"🎨 提取图片提示词"开始使用
      </p>
      <div className="flex flex-col gap-2 max-w-[280px] mx-auto">
        <button
          type="button"
          onClick={onOpenExtensionPanel}
          title="打开扩展选项页面（插件面板）"
          aria-label="打开扩展选项页面（插件面板）"
          className="inline-flex items-center justify-center gap-1 w-full rounded-lg text-xs font-medium px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white shadow-sm"
        >
          进入插件面板
          <ChevronRight className="w-3.5 h-3.5 opacity-90" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onOpenSettingsTab}
          title="打开设置页并定位到模型与 API Key"
          aria-label="打开设置页配置 API Key"
          className="inline-flex items-center justify-center gap-1.5 w-full rounded-lg text-xs font-medium px-3 py-2 border border-zinc-200 dark:border-zinc-700 bg-white/90 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          <Settings className="w-3.5 h-3.5" aria-hidden />
          配置 API Key
        </button>
      </div>
    </div>
  );
}
