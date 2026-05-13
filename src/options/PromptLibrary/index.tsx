import { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Check,
  Pin,
  X,
  Loader2,
  Search,
  Download,
  Eraser,
  ArrowUpDown,
  Sparkles,
  Images,
  Layers,
  SlidersHorizontal,
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
import type { HistoryItem, PromptVersion, RefineResponse } from '@/lib/types';
import type { ExpandedTab, SortKey, ViewMode } from './types';
import { VIEW_STORAGE_KEY } from './types';
import { ItemRow } from './ItemRow';
import { ItemGridCard } from './ItemGridCard';
import { ExpandedPanel } from './ExpandedPanel';
import { StatCard } from './parts/StatCard';
import { ViewToggle } from './parts/ViewToggle';
import { FilterGroup } from './parts/FilterGroup';
import { BulkActionBar } from './parts/BulkActionBar';
import { EmptyState } from './parts/EmptyState';
import { NoMatchState } from './parts/NoMatchState';

/**
 * 提示词管理后台。
 *
 * 功能概览：
 * - 列表 / 网格双视图展示所有图片的提示词
 * - 顶部统计卡片 + 大搜索框 + chip 化筛选与排序
 * - 单条展开：内部 Tab 切换「编辑器 / 版本历史 / AI 调整 / 详情」
 * - 多选时底部出现批量操作浮条，支持批量删除 / 导出 / 复制
 * - 与 popup 共享同一份 history（chrome.storage.local），任何变更都通过 storage 层完成
 */
/**
 * `focusId`：浮动面板点「在提示词库中编辑」时传过来的目标记录 id。
 *
 * 加载完成后会自动展开这一条、切到"编辑器" Tab、滚动到视口中央，并清掉所有
 * 当前筛选避免目标条目被过滤掉看不到。
 *
 * 处理完后通过 `onConsumeFocus` 回调通知父组件清空 focusId，
 * 否则用户每次切 Tab 回来都会被反复重定位，会很烦。
 */
interface PromptLibraryProps {
  focusId?: string | null;
  onConsumeFocus?: () => void;
}

export default function PromptLibrary({ focusId, onConsumeFocus }: PromptLibraryProps) {
  const [list, setList] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [keyword, setKeyword] = useState('');
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [filterStyle, setFilterStyle] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      return saved === 'grid' ? 'grid' : 'list';
    } catch {
      return 'list';
    }
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedTab, setExpandedTab] = useState<ExpandedTab>('editor');

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

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  // deep-link：父组件传来 focusId 时，等首批 list 加载完后自动展开 + 滚动到目标。
  // - 用 list/loading 联合监听，避免 list 还没就绪就尝试聚焦。
  // - 清掉所有筛选，否则目标条目可能被 keyword / provider / style filter 隐藏。
  // - 处理完调用 onConsumeFocus 释放 focusId，防止反复触发。
  useEffect(() => {
    if (!focusId || loading) return;
    const target = list.find((i) => i.id === focusId);
    if (!target) {
      // 目标不存在（被删了？），直接消费掉避免死循环
      onConsumeFocus?.();
      return;
    }
    setKeyword('');
    setFilterProvider('all');
    setFilterStyle('all');
    setShowPinnedOnly(false);
    setExpandedId(focusId);
    setExpandedTab('editor');
    // 等一帧让上面的 state 渲染到 DOM 后再滚动定位
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-history-id="${focusId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onConsumeFocus?.();
    }, 80);
    return () => window.clearTimeout(t);
  }, [focusId, loading, list, onConsumeFocus]);

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

  // ===== 衍生数据 =====

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
    const aiRefined = list.reduce(
      (n, i) => n + (i.versions?.filter((v) => v.source === 'refined').length || 0),
      0
    );
    return { totalImages, totalVersions, pinnedCount, aiRefined };
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

  const hasActiveFilter =
    keyword.trim() !== '' ||
    filterProvider !== 'all' ||
    filterStyle !== 'all' ||
    showPinnedOnly;

  const clearFilters = () => {
    setKeyword('');
    setFilterProvider('all');
    setFilterStyle('all');
    setShowPinnedOnly(false);
  };

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

  const selectAllVisible = () => {
    setSelectedIds(new Set(filtered.map((i) => i.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const onTogglePin = async (item: HistoryItem) => {
    await patchHistoryItem(item.id, { pinned: !item.pinned });
    await load();
  };

  const onExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      setExpandedTab('editor');
    }
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
    const text = target
      .map((i, idx) => `# ${idx + 1}. ${i.pageTitle || i.id}\n${i.prompt}`)
      .join('\n\n---\n\n');
    await navigator.clipboard.writeText(text);
    showTip(true, `已复制 ${target.length} 条提示词`);
  };

  // 「召回到悬浮窗」：把这条记录扔到当前活跃网页 tab 的浮动面板里继续编辑。
  // 因为 options 自己就是一个 tab，用户在这里点的瞬间 active tab = options 页本身，
  // 没法注入 content script。background 的 pickPanelTargetTab 会自动挑一个最近
  // 访问过的"普通网页 tab"作为目标，并把那张 tab 切到前台 —— 这条链路用户视线
  // 会从 options 切走，所以这里仅在失败时弹一条 actionTip，让用户知道为啥没召回。
  const onRecallToPanel = (item: HistoryItem) => {
    chrome.runtime.sendMessage(
      { type: 'OPEN_IN_PANEL', payload: { historyId: item.id } },
      (resp: { ok: boolean; error?: string } | undefined) => {
        if (chrome.runtime.lastError || !resp) {
          showTip(false, chrome.runtime.lastError?.message || '后台未响应');
          return;
        }
        if (!resp.ok) {
          showTip(false, resp.error || '召回失败');
          return;
        }
        showTip(true, '已召回到悬浮窗');
      }
    );
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
    <div className="space-y-5">
      {/* 顶部统计指标 */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Images className="w-4 h-4" />}
          label="图片记录"
          value={stats.totalImages}
          tone="violet"
        />
        <StatCard
          icon={<Layers className="w-4 h-4" />}
          label="提示词版本"
          value={stats.totalVersions}
          tone="indigo"
        />
        <StatCard
          icon={<Pin className="w-4 h-4" />}
          label="置顶收藏"
          value={stats.pinnedCount}
          tone="amber"
        />
        <StatCard
          icon={<Sparkles className="w-4 h-4" />}
          label="AI 调整生成"
          value={stats.aiRefined}
          tone="fuchsia"
        />
      </section>

      {/* 工具栏：搜索 + 筛选 chips + 视图切换 */}
      <section className="card !p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              className="input !pl-9 !py-2.5"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索 prompt / 备注 / 页面标题 / URL…"
            />
            {keyword && (
              <button
                onClick={() => setKeyword('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-none">
            <ViewToggle view={view} onChange={setView} />
            <div className="h-7 w-px bg-zinc-200 dark:bg-zinc-700" />
            <button
              onClick={onCopyAllPrompts}
              disabled={list.length === 0}
              className="btn-ghost text-xs !px-2.5 !py-1.5 disabled:opacity-50"
              title="复制（选中或全部筛选结果）的提示词"
            >
              <Copy className="w-3.5 h-3.5" /> 复制
            </button>
            <button
              onClick={onExport}
              disabled={list.length === 0}
              className="btn-ghost text-xs !px-2.5 !py-1.5 disabled:opacity-50"
              title="导出选中或全部记录为 JSON"
            >
              <Download className="w-3.5 h-3.5" /> 导出
            </button>
            <button
              onClick={onClearAll}
              disabled={list.length === 0}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-rose-300 dark:hover:border-rose-500/40 hover:text-rose-500 disabled:opacity-50 transition"
              title="清空全部记录"
            >
              <Eraser className="w-3.5 h-3.5" /> 清空
            </button>
          </div>
        </div>

        {/* 筛选 chips */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterGroup
            icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
            label="供应商"
            options={[{ value: 'all', label: '全部' }, ...providerOptions.map((p) => ({ value: p, label: p }))]}
            value={filterProvider}
            onChange={setFilterProvider}
          />
          <FilterGroup
            label="风格"
            options={[{ value: 'all', label: '全部' }, ...styleOptions.map((p) => ({ value: p, label: p }))]}
            value={filterStyle}
            onChange={setFilterStyle}
          />
          <FilterGroup
            icon={<ArrowUpDown className="w-3.5 h-3.5" />}
            label="排序"
            options={[
              { value: 'updated', label: '最近更新' },
              { value: 'created', label: '最早创建' },
              { value: 'versions', label: '版本数' },
            ]}
            value={sortKey}
            onChange={(v) => setSortKey(v as SortKey)}
          />
          <button
            onClick={() => setShowPinnedOnly((v) => !v)}
            className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition ${
              showPinnedOnly
                ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-amber-300 dark:hover:border-amber-500/30'
            }`}
          >
            <Pin className="w-3 h-3" /> 只看置顶
          </button>

          {hasActiveFilter && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 transition"
            >
              <X className="w-3 h-3" /> 清除筛选
            </button>
          )}

          <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-500">
            {filtered.length !== list.length && (
              <span>
                匹配 <b className="text-zinc-700 dark:text-zinc-200">{filtered.length}</b> /{' '}
                {list.length}
              </span>
            )}
            {actionTip && (
              <span
                className={`inline-flex items-center gap-1 ${
                  actionTip.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                }`}
              >
                {actionTip.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                {actionTip.msg}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 列表区 */}
      {loading ? (
        <div className="card text-center text-sm text-zinc-500 py-10">
          <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin text-violet-500" />
          加载中…
        </div>
      ) : list.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <NoMatchState onClear={clearFilters} />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((item) => (
            <ItemGridCard
              key={item.id}
              item={item}
              checked={selectedIds.has(item.id)}
              expanded={expandedId === item.id}
              copiedKey={copiedKey}
              onToggleSelect={() => toggleSelect(item.id)}
              onCopy={onCopy}
              onTogglePin={() => onTogglePin(item)}
              onExpand={() => onExpand(item.id)}
              onDelete={() => onDeleteItem(item)}
              onRecallToPanel={() => onRecallToPanel(item)}
            />
          ))}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <li
                key={item.id}
                data-history-id={item.id}
                className={`card !p-0 overflow-hidden transition-all duration-200 ${
                  expanded
                    ? 'ring-2 ring-violet-500/40 shadow-lg shadow-violet-500/5'
                    : 'hover:shadow-md hover:-translate-y-px'
                } ${
                  item.pinned
                    ? 'border-l-4 !border-l-amber-400 dark:!border-l-amber-500/60'
                    : ''
                }`}
              >
                <ItemRow
                  item={item}
                  checked={selectedIds.has(item.id)}
                  expanded={expanded}
                  copiedKey={copiedKey}
                  onToggleSelect={() => toggleSelect(item.id)}
                  onCopy={onCopy}
                  onTogglePin={() => onTogglePin(item)}
                  onExpand={() => onExpand(item.id)}
                  onDelete={() => onDeleteItem(item)}
                  onRecallToPanel={() => onRecallToPanel(item)}
                />
                {expanded && (
                  <ExpandedPanel
                    item={item}
                    tab={expandedTab}
                    onChangeTab={setExpandedTab}
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

      {/* 批量操作浮条 */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          allVisibleSelected={filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id))}
          onSelectAll={selectAllVisible}
          onClear={clearSelection}
          onCopy={onCopyAllPrompts}
          onExport={onExport}
          onDelete={onBulkDelete}
        />
      )}
    </div>
  );
}
