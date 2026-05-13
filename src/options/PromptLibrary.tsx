import { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Check,
  Pin,
  PinOff,
  Pencil,
  Save,
  X,
  Trash2,
  RotateCcw,
  Wand2,
  Loader2,
  History as HistoryIcon,
  Search,
  ExternalLink,
  Download,
  ImageOff,
  ChevronUp,
  Filter,
  ArrowUpDown,
  Eraser,
  StickyNote,
  ImageIcon,
} from 'lucide-react';
import {
  appendPromptVersion,
  clearHistory,
  getHistory,
  patchHistoryItem,
  removeHistory,
  removeHistoryItems,
  removePromptVersion,
  restorePromptVersion,
} from '@/lib/storage';
import type {
  HistoryItem,
  PromptVersion,
  PromptVersionSource,
  RefineResponse,
} from '@/lib/types';

type SortKey = 'updated' | 'created' | 'versions';

const REFINE_SUGGESTIONS = [
  '翻译成英文',
  '翻译成中文',
  '改得更电影感',
  '加上 8k, masterpiece, best quality',
  '删掉色调描述',
  '改成 SD tag 格式',
  '精简成不超过 30 字',
];

/**
 * 提示词管理后台。
 *
 * 功能概览：
 * - 列表展示所有图片的提示词（缩略图 + 元数据 + 当前 prompt 摘要）
 * - 搜索（prompt / 备注 / 页面标题）、按供应商 / 风格筛选、按时间/版本数排序
 * - 单条展开：完整 prompt 编辑器、版本历史、AI 调整、备注、置顶
 * - 多选 / 批量删除 / 全部清空 / 导出 JSON
 *
 * 设计原则：和 popup 共享同一份 history 数据（chrome.storage.local），
 * 任何变更都通过 storage 层的辅助函数完成，popup 重新打开后能立刻看到最新结果。
 */
export default function PromptLibrary() {
  const [list, setList] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 列表筛选/排序状态
  const [keyword, setKeyword] = useState('');
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [filterStyle, setFilterStyle] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);

  // 选中态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 编辑/AI 调整局部状态
  const [draft, setDraft] = useState<string>('');
  const [draftNote, setDraftNote] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [refineInput, setRefineInput] = useState('');
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [actionTip, setActionTip] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getHistory();
      setList(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // 当展开切换时，把编辑草稿同步到当前展开项
  useEffect(() => {
    if (!expandedId) {
      setDraft('');
      setDraftNote('');
      setRefineInput('');
      setRefineError(null);
      return;
    }
    const item = list.find((i) => i.id === expandedId);
    if (item) {
      setDraft(item.prompt);
      setDraftNote(item.note || '');
    }
  }, [expandedId, list]);

  const showTip = (ok: boolean, msg: string) => {
    setActionTip({ ok, msg });
    setTimeout(() => setActionTip(null), 1800);
  };

  // ===== 衍生数据：可用筛选项 & 统计 & 过滤后列表 =====

  const providerOptions = useMemo(() => {
    const s = new Set<string>();
    list.forEach((i) => s.add(i.provider));
    return Array.from(s).sort();
  }, [list]);

  const styleOptions = useMemo(() => {
    const s = new Set<string>();
    list.forEach((i) => s.add(i.style));
    return Array.from(s).sort();
  }, [list]);

  const stats = useMemo(() => {
    const totalImages = list.length;
    const totalVersions = list.reduce((sum, i) => sum + (i.versions?.length || 0), 0);
    const pinnedCount = list.filter((i) => i.pinned).length;
    return { totalImages, totalVersions, pinnedCount };
  }, [list]);

  const filtered = useMemo(() => {
    const lower = keyword.trim().toLowerCase();
    let result = list.filter((i) => {
      if (showPinnedOnly && !i.pinned) return false;
      if (filterProvider !== 'all' && i.provider !== filterProvider) return false;
      if (filterStyle !== 'all' && i.style !== filterStyle) return false;
      if (lower) {
        const hay =
          (i.prompt || '') +
          ' ' +
          (i.note || '') +
          ' ' +
          (i.pageTitle || '') +
          ' ' +
          (i.pageUrl || '');
        if (!hay.toLowerCase().includes(lower)) return false;
      }
      return true;
    });
    // 置顶优先；同分组内按用户选的排序键
    result = result.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (sortKey === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
      if (sortKey === 'versions') return (b.versions?.length || 0) - (a.versions?.length || 0);
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
    return result;
  }, [list, keyword, filterProvider, filterStyle, sortKey, showPinnedOnly]);

  // ===== 操作 handlers =====

  const onCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onTogglePin = async (item: HistoryItem) => {
    await patchHistoryItem(item.id, { pinned: !item.pinned });
    await load();
  };

  const onSaveDraft = async (item: HistoryItem) => {
    const next = draft;
    if (next.trim() === item.prompt.trim() && (draftNote || '') === (item.note || '')) {
      showTip(true, '没有变更');
      return;
    }
    if ((draftNote || '') !== (item.note || '')) {
      await patchHistoryItem(item.id, { note: draftNote });
    }
    if (next.trim() !== item.prompt.trim()) {
      await appendPromptVersion(item.id, next, 'edited');
    }
    await load();
    showTip(true, '已保存为新版本');
  };

  const onRestoreVersion = async (item: HistoryItem, v: PromptVersion) => {
    await restorePromptVersion(item.id, v.id);
    await load();
    showTip(true, '已恢复为最新版本');
  };

  const onDeleteVersion = async (item: HistoryItem, v: PromptVersion) => {
    if (item.versions[0]?.id === v.id) {
      showTip(false, '不能删除「当前版本」，请先切换/恢复其它版本');
      return;
    }
    if (item.versions.length <= 1) {
      showTip(false, '至少保留一个版本');
      return;
    }
    if (!confirm('确定删除该版本吗？此操作不可撤销')) return;
    await removePromptVersion(item.id, v.id);
    await load();
  };

  const onDeleteItem = async (item: HistoryItem) => {
    if (!confirm(`删除这条记录？(${item.versions?.length || 0} 个版本将一同丢失)`)) return;
    await removeHistory(item.id);
    if (expandedId === item.id) setExpandedId(null);
    selectedIds.delete(item.id);
    setSelectedIds(new Set(selectedIds));
    await load();
  };

  const onBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedIds.size} 条记录吗？`)) return;
    await removeHistoryItems(Array.from(selectedIds));
    if (expandedId && selectedIds.has(expandedId)) setExpandedId(null);
    setSelectedIds(new Set());
    await load();
  };

  const onClearAll = async () => {
    if (list.length === 0) return;
    if (!confirm(`确定清空全部 ${list.length} 条记录吗？此操作不可撤销`)) return;
    await clearHistory();
    setExpandedId(null);
    setSelectedIds(new Set());
    await load();
  };

  const onExport = () => {
    const exportList = selectedIds.size > 0 ? list.filter((i) => selectedIds.has(i.id)) : list;
    if (exportList.length === 0) {
      showTip(false, '没有可导出的记录');
      return;
    }
    const data = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        count: exportList.length,
        items: exportList,
      },
      null,
      2
    );
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `prompt-library-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showTip(true, `已导出 ${exportList.length} 条 JSON`);
  };

  const onCopyAllPrompts = async () => {
    const target = selectedIds.size > 0 ? list.filter((i) => selectedIds.has(i.id)) : filtered;
    if (target.length === 0) {
      showTip(false, '没有可复制的提示词');
      return;
    }
    const text = target.map((i, idx) => `# ${idx + 1}. ${i.pageTitle || i.id}\n${i.prompt}`).join(
      '\n\n---\n\n'
    );
    await navigator.clipboard.writeText(text);
    showTip(true, `已复制 ${target.length} 条提示词`);
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
          current: draft || item.prompt,
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
        showTip(true, 'AI 已生成新版本');
        void load();
      }
    );
  };

  // ===== UI =====

  return (
    <div className="space-y-4">
      {/* 统计 + 工具栏 */}
      <section className="card !p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            <span>
              共 <b className="text-zinc-800 dark:text-zinc-100 text-sm">{stats.totalImages}</b>{' '}
              张图片
            </span>
            <span>
              <b className="text-zinc-800 dark:text-zinc-100 text-sm">{stats.totalVersions}</b>{' '}
              个版本
            </span>
            {stats.pinnedCount > 0 && (
              <span>
                <Pin className="inline w-3 h-3 mr-0.5 text-amber-500" />
                {stats.pinnedCount} 项置顶
              </span>
            )}
            {selectedIds.size > 0 && (
              <span className="px-1.5 py-px rounded bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300">
                已选 {selectedIds.size} 项
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={onCopyAllPrompts}
              disabled={list.length === 0}
              className="btn-ghost text-xs px-2.5 py-1.5 disabled:opacity-50"
              title="复制（选中或全部筛选结果）的提示词"
            >
              <Copy className="w-3.5 h-3.5" /> 复制提示词
            </button>
            <button
              onClick={onExport}
              disabled={list.length === 0}
              className="btn-ghost text-xs px-2.5 py-1.5 disabled:opacity-50"
              title="导出选中或全部记录为 JSON"
            >
              <Download className="w-3.5 h-3.5" /> 导出 JSON
            </button>
            {selectedIds.size > 0 ? (
              <button
                onClick={onBulkDelete}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-500/40 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" /> 删除选中（{selectedIds.size}）
              </button>
            ) : (
              <button
                onClick={onClearAll}
                disabled={list.length === 0}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-rose-300 dark:hover:border-rose-500/40 hover:text-rose-500 disabled:opacity-50"
                title="清空全部记录"
              >
                <Eraser className="w-3.5 h-3.5" /> 清空全部
              </button>
            )}
          </div>
        </div>

        {/* 搜索 / 筛选 / 排序 */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <div className="md:col-span-5 relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              className="input pl-8"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索 prompt / 备注 / 页面标题…"
            />
            {keyword && (
              <button
                onClick={() => setKeyword('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="md:col-span-3">
            <div className="relative">
              <Filter className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                className="input pl-8 appearance-none"
                value={filterProvider}
                onChange={(e) => setFilterProvider(e.target.value)}
              >
                <option value="all">全部供应商</option>
                {providerOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="md:col-span-2">
            <select
              className="input"
              value={filterStyle}
              onChange={(e) => setFilterStyle(e.target.value)}
            >
              <option value="all">全部风格</option>
              {styleOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <div className="relative">
              <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                className="input pl-8 appearance-none"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                <option value="updated">最近更新</option>
                <option value="created">最早创建</option>
                <option value="versions">版本数</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showPinnedOnly}
              onChange={(e) => setShowPinnedOnly(e.target.checked)}
              className="w-3.5 h-3.5 accent-amber-500"
            />
            只看置顶
          </label>
          {filtered.length !== list.length && (
            <span>
              筛选出 <b className="text-zinc-700 dark:text-zinc-200">{filtered.length}</b> /{' '}
              {list.length} 条
            </span>
          )}
          {actionTip && (
            <span
              className={`ml-auto inline-flex items-center gap-1 ${
                actionTip.ok ? 'text-emerald-600' : 'text-rose-500'
              }`}
            >
              {actionTip.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
              {actionTip.msg}
            </span>
          )}
        </div>
      </section>

      {/* 列表 */}
      {loading ? (
        <div className="card text-center text-sm text-zinc-500 py-8">加载中…</div>
      ) : list.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <div className="card text-center text-sm text-zinc-500 py-8">
          没有匹配的记录，试试调整搜索或筛选条件
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => {
            const expanded = expandedId === item.id;
            const checked = selectedIds.has(item.id);
            const versionCount = item.versions?.length || 0;
            return (
              <li
                key={item.id}
                className={`card !p-0 overflow-hidden transition ${
                  expanded ? 'ring-2 ring-violet-500/40' : ''
                } ${item.pinned ? 'border-amber-300 dark:border-amber-500/40' : ''}`}
              >
                <div className="flex gap-3 p-3">
                  <input
                    type="checkbox"
                    className="mt-1 w-4 h-4 accent-violet-500 flex-none"
                    checked={checked}
                    onChange={() => toggleSelect(item.id)}
                    title="选中此条"
                  />
                  <Thumb item={item} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-zinc-500 mb-1">
                      {item.pinned && (
                        <span className="px-1.5 py-px rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1 font-medium">
                          <Pin className="w-3 h-3" /> 置顶
                        </span>
                      )}
                      <span className="px-1.5 py-px rounded bg-zinc-100 dark:bg-zinc-800">
                        {item.provider}
                      </span>
                      <span className="font-mono truncate max-w-[180px]">{item.model}</span>
                      <span>·</span>
                      <span>{item.style}</span>
                      <span>·</span>
                      <span>{formatTime(item.updatedAt || item.createdAt)}</span>
                      {versionCount > 0 && (
                        <span className="px-1.5 py-px rounded bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300">
                          v{versionCount}
                        </span>
                      )}
                      {item.note && (
                        <span className="px-1.5 py-px rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1 max-w-[200px] truncate">
                          <StickyNote className="w-3 h-3 flex-none" />
                          <span className="truncate">{item.note}</span>
                        </span>
                      )}
                    </div>
                    <p
                      className={`text-xs leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words ${
                        expanded ? '' : 'line-clamp-3'
                      }`}
                    >
                      {item.prompt || <span className="text-zinc-400 italic">（空）</span>}
                    </p>

                    <div className="mt-2 flex items-center gap-1 flex-wrap text-[11px]">
                      <button
                        onClick={() => onCopy(item.prompt, `cur:${item.id}`)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                      >
                        {copiedKey === `cur:${item.id}` ? (
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
                        onClick={() => setExpandedId(expanded ? null : item.id)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md ${
                          expanded
                            ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
                            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                        }`}
                      >
                        {expanded ? (
                          <>
                            <ChevronUp className="w-3 h-3" /> 收起
                          </>
                        ) : (
                          <>
                            <Pencil className="w-3 h-3" /> 编辑 / 详情
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => onTogglePin(item)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md ${
                          item.pinned
                            ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                            : 'hover:bg-amber-50 dark:hover:bg-amber-500/10 text-amber-600 dark:text-amber-300'
                        }`}
                        title={item.pinned ? '取消置顶' : '置顶'}
                      >
                        {item.pinned ? (
                          <>
                            <PinOff className="w-3 h-3" /> 取消置顶
                          </>
                        ) : (
                          <>
                            <Pin className="w-3 h-3" /> 置顶
                          </>
                        )}
                      </button>
                      {item.pageUrl && (
                        <a
                          href={item.pageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                          title={item.pageTitle || item.pageUrl}
                        >
                          <ExternalLink className="w-3 h-3" /> 来源
                        </a>
                      )}
                      <button
                        onClick={() => onDeleteItem(item)}
                        className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-rose-50 dark:hover:bg-rose-500/10 text-zinc-400 hover:text-rose-500"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

                {expanded && (
                  <ExpandedPanel
                    item={item}
                    draft={draft}
                    draftNote={draftNote}
                    onChangeDraft={setDraft}
                    onChangeNote={setDraftNote}
                    onSaveDraft={() => onSaveDraft(item)}
                    onResetDraft={() => {
                      setDraft(item.prompt);
                      setDraftNote(item.note || '');
                    }}
                    onCopy={onCopy}
                    copiedKey={copiedKey}
                    onRestoreVersion={(v) => onRestoreVersion(item, v)}
                    onDeleteVersion={(v) => onDeleteVersion(item, v)}
                    refineInput={refineInput}
                    refineLoading={refineLoading}
                    refineError={refineError}
                    onChangeRefine={(v) => {
                      setRefineInput(v);
                      if (refineError) setRefineError(null);
                    }}
                    onRunRefine={() => runRefine(item)}
                    onPickRefineSuggestion={(s) => {
                      setRefineInput((prev) => {
                        const t = prev.trim();
                        return t ? `${t}；${s}` : s;
                      });
                      if (refineError) setRefineError(null);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ============== 子组件 ==============

function Thumb({ item }: { item: HistoryItem }) {
  const [failed, setFailed] = useState(false);
  if (failed || !item.thumbnail) {
    return (
      <div className="w-20 h-20 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-none text-zinc-400">
        <ImageOff className="w-5 h-5" />
      </div>
    );
  }
  return (
    <img
      src={item.thumbnail}
      alt=""
      onError={() => setFailed(true)}
      className="w-20 h-20 rounded-lg object-cover bg-zinc-100 dark:bg-zinc-800 flex-none"
    />
  );
}

function ExpandedPanel({
  item,
  draft,
  draftNote,
  onChangeDraft,
  onChangeNote,
  onSaveDraft,
  onResetDraft,
  onCopy,
  copiedKey,
  onRestoreVersion,
  onDeleteVersion,
  refineInput,
  refineLoading,
  refineError,
  onChangeRefine,
  onRunRefine,
  onPickRefineSuggestion,
}: {
  item: HistoryItem;
  draft: string;
  draftNote: string;
  onChangeDraft: (v: string) => void;
  onChangeNote: (v: string) => void;
  onSaveDraft: () => void;
  onResetDraft: () => void;
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
  onRestoreVersion: (v: PromptVersion) => void;
  onDeleteVersion: (v: PromptVersion) => void;
  refineInput: string;
  refineLoading: boolean;
  refineError: string | null;
  onChangeRefine: (v: string) => void;
  onRunRefine: () => void;
  onPickRefineSuggestion: (s: string) => void;
}) {
  const dirtyPrompt = draft.trim() !== item.prompt.trim();
  const dirtyNote = (draftNote || '') !== (item.note || '');
  const dirty = dirtyPrompt || dirtyNote;

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/30 px-4 py-4 space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* 左侧：大图 + meta */}
        <div className="space-y-2">
          <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-center min-h-[200px] max-h-[300px]">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt=""
                className="max-w-full max-h-[300px] object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <ImageIcon className="w-10 h-10 text-zinc-300" />
            )}
          </div>
          <div className="text-[11px] text-zinc-500 space-y-1">
            <div>
              <b>id</b> · <span className="font-mono break-all">{item.id}</span>
            </div>
            <div>
              <b>创建于</b> · {new Date(item.createdAt).toLocaleString()}
            </div>
            {item.updatedAt && item.updatedAt !== item.createdAt && (
              <div>
                <b>更新于</b> · {new Date(item.updatedAt).toLocaleString()}
              </div>
            )}
            {item.pageUrl && (
              <div className="break-all">
                <b>来源</b> ·{' '}
                <a
                  href={item.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-violet-500 hover:underline"
                >
                  {item.pageTitle || item.pageUrl}
                </a>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：编辑器 + 备注 + 版本 + AI */}
        <div className="space-y-4">
          <div>
            <label className="label flex items-center justify-between">
              <span>当前提示词（编辑后会保存为新版本）</span>
              <span className="text-[10px] text-zinc-400">
                {draft.length} 字
              </span>
            </label>
            <textarea
              value={draft}
              onChange={(e) => onChangeDraft(e.target.value)}
              spellCheck={false}
              className="input min-h-[180px] max-h-[420px] resize-y leading-relaxed font-mono text-[13px]"
            />
            <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px]">
              <button
                onClick={onSaveDraft}
                disabled={!dirty}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white"
              >
                <Save className="w-3.5 h-3.5" /> 保存为新版本
              </button>
              <button
                onClick={onResetDraft}
                disabled={!dirty}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 text-zinc-600 dark:text-zinc-300"
              >
                <RotateCcw className="w-3.5 h-3.5" /> 撤销改动
              </button>
              <button
                onClick={() => onCopy(draft, `draft:${item.id}`)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
              >
                {copiedKey === `draft:${item.id}` ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-emerald-500">已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> 复制当前内容
                  </>
                )}
              </button>
              {dirty && (
                <span className="text-amber-600 dark:text-amber-300 ml-1">
                  · 有未保存改动
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="label flex items-center gap-1">
              <StickyNote className="w-3 h-3" /> 备注 / 标签（仅本地保存，可用于搜索）
            </label>
            <input
              className="input"
              value={draftNote}
              onChange={(e) => onChangeNote(e.target.value)}
              placeholder="例如：MJ 上次跑的人物参考、SDXL 风格化测试…"
            />
          </div>

          {/* AI 调整 */}
          <RefineInline
            value={refineInput}
            loading={refineLoading}
            error={refineError}
            onChange={onChangeRefine}
            onSubmit={onRunRefine}
            onPick={onPickRefineSuggestion}
          />

          {/* 版本列表 */}
          <div>
            <div className="text-xs font-semibold flex items-center gap-1.5 mb-2 text-zinc-600 dark:text-zinc-300">
              <HistoryIcon className="w-3.5 h-3.5" />
              版本历史（{item.versions.length}）
            </div>
            <ul className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
              {item.versions.map((v, i) => {
                const isCurrent = i === 0;
                const cid = `ver:${item.id}::${v.id}`;
                return (
                  <li
                    key={v.id}
                    className={`p-3 ${
                      isCurrent ? 'bg-emerald-50/60 dark:bg-emerald-500/10' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 text-[11px] mb-1.5 flex-wrap">
                      <SourceTag source={v.source} />
                      <span className="text-zinc-500">{new Date(v.createdAt).toLocaleString()}</span>
                      {v.note && (
                        <span className="text-zinc-500 italic truncate max-w-[260px]">
                          · {v.note}
                        </span>
                      )}
                      {isCurrent && (
                        <span className="ml-auto px-1.5 py-px rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium">
                          当前
                        </span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">
                      {v.prompt}
                    </p>
                    <div className="mt-2 flex items-center gap-1 text-[11px]">
                      <button
                        onClick={() => onCopy(v.prompt, cid)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                      >
                        {copiedKey === cid ? (
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
                          onClick={() => onRestoreVersion(v)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20"
                        >
                          <RotateCcw className="w-3 h-3" /> 恢复此版本
                        </button>
                      )}
                      {!isCurrent && (
                        <button
                          onClick={() => onDeleteVersion(v)}
                          className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
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
        </div>
      </div>
    </div>
  );
}

function RefineInline({
  value,
  loading,
  error,
  onChange,
  onSubmit,
  onPick,
}: {
  value: string;
  loading: boolean;
  error: string | null;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onPick: (s: string) => void;
}) {
  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-500/30 bg-gradient-to-b from-violet-50/70 to-white dark:from-violet-500/10 dark:to-zinc-900/40 p-3 space-y-2">
      <div className="text-xs font-semibold text-violet-700 dark:text-violet-300 inline-flex items-center gap-1.5">
        <Wand2 className="w-3.5 h-3.5" /> 让 AI 调整这条提示词
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
        className="input min-h-[60px] max-h-[140px] resize-y text-[12px] disabled:opacity-60"
      />
      {error && (
        <div className="text-[11px] px-2 py-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          {error}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {REFINE_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={loading}
            onClick={() => onPick(s)}
            className="text-[11px] px-2 py-0.5 rounded-full border border-violet-200 dark:border-violet-500/30 bg-white/70 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20 disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          onClick={onSubmit}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-md bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white inline-flex items-center gap-1 hover:brightness-110 disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 调整中…
            </>
          ) : (
            <>
              <Wand2 className="w-3.5 h-3.5" /> 让 AI 生成新版本
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function SourceTag({ source }: { source: PromptVersionSource }) {
  const map: Record<PromptVersionSource, { label: string; className: string }> = {
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
  return <span className={`px-1.5 py-px rounded font-medium ${cfg.className}`}>{cfg.label}</span>;
}

function EmptyState() {
  return (
    <div className="card text-center py-12">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-500/20 dark:to-violet-500/20 flex items-center justify-center mb-4">
        <HistoryIcon className="w-6 h-6 text-violet-500" />
      </div>
      <h3 className="text-sm font-semibold mb-1">提示词库还是空的</h3>
      <p className="text-xs text-zinc-500 leading-relaxed">
        在任意网页上 <b>右键图片</b> → 选择「🎨 提取图片提示词」，
        <br />
        提取出的结果会自动出现在这里，方便你统一管理、编辑和导出。
      </p>
    </div>
  );
}

function formatTime(t: number): string {
  const d = new Date(t);
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
