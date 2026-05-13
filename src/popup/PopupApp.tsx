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
} from 'lucide-react';
import {
  appendPromptVersion,
  clearHistory,
  getHistory,
  removeHistory,
  restorePromptVersion,
} from '@/lib/storage';
import type { HistoryItem, PromptVersion, RefineResponse } from '@/lib/types';
import UpdateBanner from './UpdateBanner';

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

  return (
    <div className="flex flex-col max-h-[600px]">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
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

      <UpdateBanner />

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
}: {
  item: HistoryItem;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
  onRestore: (v: PromptVersion) => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-900/50 overflow-hidden">
      <div className="px-2.5 py-1.5 text-[10px] font-semibold text-zinc-500 border-b border-zinc-200/70 dark:border-zinc-700/70">
        共 {item.versions.length} 个版本（最新在上）
      </div>
      <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-700/60 max-h-[200px] overflow-y-auto">
        {item.versions.map((v, i) => {
          const isCurrent = i === 0;
          const cid = `${item.id}::${v.id}`;
          return (
            <li key={v.id} className={`p-2 ${isCurrent ? 'bg-emerald-50/60 dark:bg-emerald-500/10' : ''}`}>
              <div className="flex items-center gap-1.5 text-[10px] mb-1">
                <SourceTag source={v.source} />
                <span className="text-zinc-500">{formatTime(v.createdAt)}</span>
                {isCurrent && (
                  <span className="ml-auto px-1.5 py-px rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium">
                    当前
                  </span>
                )}
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
      label: '初始',
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

function formatTime(t: number): string {
  const d = new Date(t);
  const now = new Date();
  const diff = now.getTime() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
