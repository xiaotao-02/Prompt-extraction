import { useEffect, useState } from 'react';
import {
  Copy,
  Settings,
  Sparkles,
  Trash2,
  ExternalLink,
  Check,
  Pencil,
  History,
  X,
  Save,
  RotateCcw,
  Wand2,
  Loader2,
  PanelTopOpen,
} from 'lucide-react';
import {
  appendPromptVersion,
  clearHistory,
  getHistory,
  removeHistory,
  removePromptVersion,
  restorePromptVersion,
} from '@/lib/storage';
import type { HistoryItem, PromptVersion, RefineResponse } from '@/lib/types';
import { getVersionOrdinalLabel, type VersionOrdinalKind } from '@/lib/versionLabel';
import { STRATEGY_LABELS } from '@/lib/strategies-meta';
import { formatTime } from '../options/_shared/time';

const VERSION_ORD_TAG_CLASS: Record<VersionOrdinalKind, string> = {
  current: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  initial: 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300',
  middle: 'bg-zinc-200/70 dark:bg-zinc-700/70 text-zinc-700 dark:text-zinc-200',
};

const VERSION_LIST_VISIBLE_COUNT = 15;
const VERSION_LIST_ROW_HEIGHT = 82;
const VERSION_LIST_MAX_HEIGHT = VERSION_LIST_VISIBLE_COUNT * VERSION_LIST_ROW_HEIGHT;

const REFINE_SUGGESTIONS = [
  '翻译成英文',
  '改得更电影感',
  '加上 8k, masterpiece, best quality',
  '删掉色调描述',
  '改成 SD tag 格式',
];

export default function PopupApp() {
  const [list, setList] = useState<HistoryItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [openVersionsId, setOpenVersionsId] = useState<string | null>(null);
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const [refineInput, setRefineInput] = useState('');
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  const load = () => getHistory().then(setList);

  useEffect(() => {
    load();
  }, []);

  const onCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1200);
  };

  const onDelete = async (item: HistoryItem) => {
    await removeHistory(item.id);
    if (editingId === item.id) setEditingId(null);
    if (openVersionsId === item.id) setOpenVersionsId(null);
    load();
  };

  const onClear = async () => {
    if (list.length === 0) return;
    if (!confirm('确定清空全部历史记录？')) return;
    await clearHistory();
    setEditingId(null);
    setOpenVersionsId(null);
    load();
  };

  const startEdit = (item: HistoryItem) => {
    setEditingId(item.id);
    setDraft(item.prompt);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  const saveEdit = async (item: HistoryItem) => {
    const next = draft;
    if (next === item.prompt) {
      cancelEdit();
      return;
    }
    await appendPromptVersion(item.id, next, 'edited');
    setEditingId(null);
    setDraft('');
    load();
  };

  const onRestore = async (item: HistoryItem, version: PromptVersion) => {
    await restorePromptVersion(item.id, version.id);
    load();
  };

  // 删除单个历史版本：
  // - 允许删"当前版本"（versions[0]）：删除后由下一条版本自动顶替为新的当前版本，
  //   storage 层会同步把它的 prompt / meta 镜像到 HistoryItem 顶层字段
  // - 至少保留 1 个版本
  // - 删完最后一个旧版本后版本数会退回 1，此时上层 `versionCount > 1` 折叠区会自动关闭，
  //   所以这里不需要手动 setOpenVersionsId(null)
  const onDeleteVersion = async (item: HistoryItem, version: PromptVersion) => {
    if ((item.versions?.length || 0) <= 1) return;
    const isCurrent = item.versions[0]?.id === version.id;
    const msg = isCurrent
      ? '确定删除「当前版本」吗？下一条版本会顶替为当前版本，此操作不可撤销'
      : '确定删除该版本吗？此操作不可撤销';
    if (!confirm(msg)) return;
    await removePromptVersion(item.id, version.id);
    load();
  };

  const openRefine = (item: HistoryItem) => {
    setRefiningId(item.id);
    setRefineInput('');
    setRefineError(null);
    setRefineLoading(false);
    setEditingId(null);
  };

  const closeRefine = () => {
    setRefiningId(null);
    setRefineInput('');
    setRefineError(null);
    setRefineLoading(false);
  };

  const runRefine = (item: HistoryItem) => {
    const instruction = refineInput.trim();
    if (!instruction) {
      setRefineError('请先输入修改要求');
      return;
    }
    setRefineLoading(true);
    setRefineError(null);
    chrome.runtime.sendMessage(
      {
        type: 'REFINE_PROMPT',
        payload: {
          historyId: item.id,
          instruction,
          current: item.prompt,
        },
      },
      (resp: RefineResponse | undefined) => {
        if (chrome.runtime.lastError || !resp) {
          setRefineLoading(false);
          setRefineError(chrome.runtime.lastError?.message || '后台未响应');
          return;
        }
        if (!resp.ok) {
          setRefineLoading(false);
          setRefineError(resp.error);
          return;
        }
        setRefineLoading(false);
        setRefineInput('');
        setRefiningId(null);
        setOpenVersionsId(item.id);
        load();
      }
    );
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  // 「在悬浮窗中编辑」：把这一条记录召回到当前活跃网页 tab 的浮动面板里继续编辑。
  // background 负责挑 tab + 激活 + 转发；这里只关心 sendResponse 成败：
  //   - ok=true → 用户视线已经被切到目标 tab，popup 自己再留着没意义，直接关掉
  //   - ok=false → 多半是因为 active tab 是 chrome:// / 设置页 / 新标签页等
  //     不能注入的内部页，把后台返回的 error 提示出来让用户先去打开普通网页
  const [recallTip, setRecallTip] = useState<string | null>(null);
  const recallToPanel = (item: HistoryItem) => {
    setRecallTip(null);
    chrome.runtime.sendMessage(
      { type: 'OPEN_IN_PANEL', payload: { historyId: item.id } },
      (resp: { ok: boolean; error?: string } | undefined) => {
        if (chrome.runtime.lastError || !resp) {
          setRecallTip(chrome.runtime.lastError?.message || '后台未响应');
          return;
        }
        if (!resp.ok) {
          setRecallTip(resp.error || '召回失败');
          return;
        }
        // 关 popup 之前留 60ms 让 tab 激活动画完成，避免在某些 Chrome 版本上
        // popup 关得太快导致 windows.update(focused) 还没生效。
        setTimeout(() => window.close(), 60);
      }
    );
  };

  return (
    <div className="flex flex-col max-h-[600px]">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <img
            src={chrome.runtime.getURL('icons/icon-48.png')}
            alt="Prompt Extracto"
            className="w-7 h-7 rounded-lg object-cover"
          />
          <div>
            <div className="text-sm font-semibold leading-none">提示词提取器</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">右键图片 → 提取提示词</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {list.length > 0 && (
            <button
              onClick={onClear}
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
              title="清空历史"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={openOptions}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            title="设置"
          >
            <Settings className="w-4 h-4" />
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

      <div className="flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <EmptyState onOpenOptions={openOptions} />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {list.map((item) => {
              const isEditing = editingId === item.id;
              const versionsOpen = openVersionsId === item.id;
              const versionCount = item.versions?.length || 0;
              const isRefining = refiningId === item.id;
              return (
                <li key={item.id} className="p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <div className="flex gap-3">
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
                        <span className="truncate max-w-[120px]">{item.model}</span>
                        <span>·</span>
                        <span>{formatTime(item.updatedAt || item.createdAt)}</span>
                        {versionCount > 1 && (
                          <span className="px-1.5 py-px rounded bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300">
                            v{versionCount}
                          </span>
                        )}
                      </div>

                      {isEditing ? (
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          spellCheck={false}
                          className="w-full text-xs leading-relaxed rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/30 resize-y min-h-[80px] max-h-[180px]"
                        />
                      ) : (
                        <p className="text-xs leading-relaxed line-clamp-3 text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">
                          {item.prompt}
                        </p>
                      )}

                      <div className="mt-2 flex items-center gap-1 text-[11px] flex-wrap">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => saveEdit(item)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-violet-500 hover:bg-violet-600 text-white"
                            >
                              <Save className="w-3 h-3" /> 保存为新版本
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                            >
                              <X className="w-3 h-3" /> 取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => onCopy(item.prompt, item.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                            >
                              {copiedId === item.id ? (
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
                              onClick={() => startEdit(item)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                            >
                              <Pencil className="w-3 h-3" /> 编辑
                            </button>
                            <button
                              onClick={() => (isRefining ? closeRefine() : openRefine(item))}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md ${
                                isRefining
                                  ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
                                  : 'hover:bg-violet-50 dark:hover:bg-violet-500/10 text-violet-600 dark:text-violet-300'
                              }`}
                            >
                              <Wand2 className="w-3 h-3" /> AI 调整
                            </button>
                            <button
                              onClick={() => recallToPanel(item)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                              title="把这条提示词召回到当前网页的悬浮编辑窗，继续手动调整 / AI 调整"
                            >
                              <PanelTopOpen className="w-3 h-3" /> 悬浮窗编辑
                            </button>
                            {versionCount > 1 && (
                              <button
                                onClick={() =>
                                  setOpenVersionsId(versionsOpen ? null : item.id)
                                }
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md ${
                                  versionsOpen
                                    ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
                                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                                }`}
                              >
                                <History className="w-3 h-3" /> 版本 · {versionCount}
                              </button>
                            )}
                            {item.pageUrl && (
                              <a
                                href={item.pageUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                                title={item.pageTitle}
                              >
                                <ExternalLink className="w-3 h-3" /> 来源
                              </a>
                            )}
                            <button
                              onClick={() => onDelete(item)}
                              className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-rose-50 dark:hover:bg-rose-500/10 text-zinc-400 hover:text-rose-500"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>

                      {isRefining && !isEditing && (
                        <RefineForm
                          value={refineInput}
                          loading={refineLoading}
                          error={refineError}
                          onChange={(v) => {
                            setRefineInput(v);
                            if (refineError) setRefineError(null);
                          }}
                          onSubmit={() => runRefine(item)}
                          onCancel={closeRefine}
                          onPickSuggestion={(s) => {
                            setRefineInput((prev) => {
                              const t = prev.trim();
                              return t ? `${t}；${s}` : s;
                            });
                            if (refineError) setRefineError(null);
                          }}
                        />
                      )}

                      {versionsOpen && !isEditing && (
                        <VersionList
                          item={item}
                          onCopy={(text, id) => onCopy(text, id)}
                          copiedId={copiedId}
                          onRestore={(v) => onRestore(item, v)}
                          onDelete={(v) => onDeleteVersion(item, v)}
                        />
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function VersionList({
  item,
  onCopy,
  copiedId,
  onRestore,
  onDelete,
}: {
  item: HistoryItem;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
  onRestore: (v: PromptVersion) => void;
  onDelete: (v: PromptVersion) => void;
}) {
  // 同图反推次数统计（用于头部副标题）
  const extractedCount = item.versions.filter((v) => v.source === 'extracted').length;
  return (
    <div className="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-900/50 overflow-hidden">
      <div className="px-2.5 py-1.5 text-[10px] font-semibold text-zinc-500 border-b border-zinc-200/70 dark:border-zinc-700/70 flex items-center justify-between gap-2">
        <span>共 {item.versions.length} 个版本（最新在上）</span>
        {extractedCount > 1 && (
          <span className="font-normal text-zinc-400">同一张图反推 {extractedCount} 次</span>
        )}
      </div>
      <ul
        className="divide-y divide-zinc-200/60 dark:divide-zinc-700/60 overflow-y-auto"
        style={{ maxHeight: VERSION_LIST_MAX_HEIGHT }}
      >
        {item.versions.map((v, i) => {
          const isCurrent = i === 0;
          const cid = `${item.id}::${v.id}`;
          const ord = getVersionOrdinalLabel(v.versionNo, isCurrent);
          const meta = v.meta ?? {
            provider: item.provider,
            model: item.model,
            style: item.style,
            strategy: item.strategy,
          };
          return (
            <li key={v.id} className={`p-2 ${isCurrent ? 'bg-emerald-50/60 dark:bg-emerald-500/10' : ''}`}>
              <div className="flex items-center gap-1.5 text-[10px] mb-1 flex-wrap">
                <span
                  className={`px-1.5 py-px rounded font-medium ${VERSION_ORD_TAG_CLASS[ord.kind]}`}
                >
                  {ord.label}
                </span>
                <SourceTag source={v.source} />
                <span className="text-zinc-500">{formatTime(v.createdAt)}</span>
                {meta.strategy && (
                  <span className="px-1.5 py-px rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
                    {STRATEGY_LABELS[meta.strategy] ?? meta.strategy}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-white/80 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 ring-1 ring-zinc-200/60 dark:ring-zinc-700/60">
                    <span className="font-medium">{meta.provider}</span>
                    <span className="text-zinc-300 dark:text-zinc-600">·</span>
                    <span className="font-mono truncate max-w-[110px]">{meta.model}</span>
                </span>
              </div>
              <p className="text-[11px] leading-relaxed line-clamp-2 text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">
                {v.prompt}
              </p>
              <div className="mt-1.5 flex items-center gap-1 text-[10px]">
                <button
                  onClick={() => onCopy(v.prompt, cid)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 text-zinc-600 dark:text-zinc-300"
                >
                  {copiedId === cid ? (
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
                {!isCurrent && (
                  <button
                    onClick={() => onRestore(v)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20"
                  >
                    <RotateCcw className="w-3 h-3" /> 恢复此版本
                  </button>
                )}
                {item.versions.length > 1 && (
                  <button
                    onClick={() => onDelete(v)}
                    title={isCurrent ? '删除当前版本（下一版本将顶替为当前）' : '删除此版本'}
                    className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SourceTag({ source }: { source: PromptVersion['source'] }) {
  const map: Record<PromptVersion['source'], { label: string; className: string }> = {
    extracted: {
      // "初始"已下放给基于时间顺序的序号标签使用，这里改名"反推"表达"来源 = 一次模型反推"，
      // 与 SettingsView 的 SourceTag 保持一致，避免一行里出现两个"初始"。
      label: '反推',
      className: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    },
    edited: {
      label: '手动编辑',
      className: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
    },
    restored: {
      label: '恢复',
      className: 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300',
    },
    refined: {
      label: 'AI 调整',
      className: 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300',
    },
  };
  const cfg = map[source];
  return (
    <span className={`px-1.5 py-px rounded font-medium ${cfg.className}`}>{cfg.label}</span>
  );
}

function RefineForm({
  value,
  loading,
  error,
  onChange,
  onSubmit,
  onCancel,
  onPickSuggestion,
}: {
  value: string;
  loading: boolean;
  error: string | null;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onPickSuggestion: (s: string) => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-violet-200 dark:border-violet-500/30 bg-gradient-to-b from-violet-50/70 to-white dark:from-violet-500/10 dark:to-zinc-900/40 p-2.5 space-y-2">
      <div className="flex items-center justify-between text-[11px] font-semibold text-violet-700 dark:text-violet-300">
        <span className="inline-flex items-center gap-1.5">
          <Wand2 className="w-3.5 h-3.5" /> 告诉我怎么调整这条提示词
        </span>
        <button
          onClick={onCancel}
          disabled={loading}
          className="p-0.5 rounded hover:bg-violet-100 dark:hover:bg-violet-500/20 disabled:opacity-50"
          title="收起"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <textarea
        value={value}
        disabled={loading}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder="例如：改得更电影感、翻译成英文、删掉色调、加上 8k 高清等参数…（Ctrl/⌘ + Enter 提交）"
        spellCheck={false}
        className="w-full text-[11px] leading-relaxed rounded-md border border-violet-200 dark:border-violet-500/30 bg-white/80 dark:bg-zinc-900/60 px-2 py-1.5 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/30 resize-y min-h-[56px] max-h-[140px] disabled:opacity-60"
      />
      {error && (
        <div className="text-[10px] leading-snug px-2 py-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          {error}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {REFINE_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={loading}
            onClick={() => onPickSuggestion(s)}
            className="text-[10px] px-2 py-0.5 rounded-full border border-violet-200 dark:border-violet-500/30 bg-white/70 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20 disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          onClick={onCancel}
          disabled={loading}
          className="text-[11px] px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={onSubmit}
          disabled={loading}
          className="text-[11px] px-2.5 py-1 rounded-md bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white inline-flex items-center gap-1 hover:brightness-110 disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> 调整中…
            </>
          ) : (
            <>
              <Wand2 className="w-3 h-3" /> 让 AI 调整
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onOpenOptions }: { onOpenOptions: () => void }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-500/20 dark:to-violet-500/20 flex items-center justify-center mb-4">
        <Sparkles className="w-6 h-6 text-violet-500" />
      </div>
      <h3 className="text-sm font-semibold mb-1">还没有任何记录</h3>
      <p className="text-xs text-zinc-500 leading-relaxed mb-4">
        在任意网页上 <b>右键点击图片</b>，
        <br />
        选择"🎨 提取图片提示词"开始使用
      </p>
      <button onClick={onOpenOptions} className="btn-primary text-xs px-3 py-1.5">
        <Settings className="w-3.5 h-3.5" /> 配置 API Key
      </button>
    </div>
  );
}
