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
  ArrowUpDown,
  Eraser,
  StickyNote,
  ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Sparkles,
  Images,
  Layers,
  CheckCheck,
  SlidersHorizontal,
  Info,
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
type ViewMode = 'list' | 'grid';
type ExpandedTab = 'editor' | 'versions' | 'refine' | 'meta';

const REFINE_SUGGESTIONS = [
  '翻译成英文',
  '翻译成中文',
  '改得更电影感',
  '加上 8k, masterpiece, best quality',
  '删掉色调描述',
  '改成 SD tag 格式',
  '精简成不超过 30 字',
];

const VIEW_STORAGE_KEY = 'prompt_library_view_v1';

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
export default function PromptLibrary() {
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

// ============== 顶部统计卡 ==============

const STAT_TONE: Record<
  'violet' | 'indigo' | 'amber' | 'fuchsia',
  { iconBg: string; iconText: string }
> = {
  violet: {
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
    iconText: 'text-violet-600 dark:text-violet-300',
  },
  indigo: {
    iconBg: 'bg-indigo-100 dark:bg-indigo-500/15',
    iconText: 'text-indigo-600 dark:text-indigo-300',
  },
  amber: {
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    iconText: 'text-amber-600 dark:text-amber-300',
  },
  fuchsia: {
    iconBg: 'bg-fuchsia-100 dark:bg-fuchsia-500/15',
    iconText: 'text-fuchsia-600 dark:text-fuchsia-300',
  },
};

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: keyof typeof STAT_TONE;
}) {
  const t = STAT_TONE[tone];
  return (
    <div className="card !p-4 flex items-center gap-3 hover:-translate-y-px transition-transform">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${t.iconBg} ${t.iconText}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{label}</div>
        <div className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {value}
        </div>
      </div>
    </div>
  );
}

// ============== 视图切换 ==============

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex items-center p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/60">
      <button
        onClick={() => onChange('list')}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition ${
          view === 'list'
            ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-300 shadow-sm'
            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-100'
        }`}
        title="列表视图"
      >
        <ListIcon className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onChange('grid')}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition ${
          view === 'grid'
            ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-300 shadow-sm'
            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-100'
        }`}
        title="网格视图"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ============== 筛选 Chip 组 ==============

function FilterGroup({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon?: React.ReactNode;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-zinc-400 dark:text-zinc-500 inline-flex items-center gap-1">
        {icon}
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                active
                  ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/40'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-violet-300 dark:hover:border-violet-500/30'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============== 列表行卡片 ==============

function ItemRow({
  item,
  checked,
  expanded,
  copiedKey,
  onToggleSelect,
  onCopy,
  onTogglePin,
  onExpand,
  onDelete,
}: {
  item: HistoryItem;
  checked: boolean;
  expanded: boolean;
  copiedKey: string | null;
  onToggleSelect: () => void;
  onCopy: (text: string, key: string) => void;
  onTogglePin: () => void;
  onExpand: () => void;
  onDelete: () => void;
}) {
  const versionCount = item.versions?.length || 0;
  return (
    <div className="group flex gap-3 p-3.5">
      <input
        type="checkbox"
        className="mt-1 w-4 h-4 accent-violet-500 flex-none cursor-pointer"
        checked={checked}
        onChange={onToggleSelect}
        title="选中此条"
      />
      <Thumb item={item} size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-zinc-500 mb-1">
          {item.pinned && (
            <span className="px-1.5 py-px rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1 font-medium">
              <Pin className="w-3 h-3" /> 置顶
            </span>
          )}
          <span className="px-1.5 py-px rounded bg-zinc-100 dark:bg-zinc-800 font-medium">
            {item.provider}
          </span>
          <span className="font-mono truncate max-w-[200px] text-zinc-500">{item.model}</span>
          <span className="text-zinc-300 dark:text-zinc-600">·</span>
          <span>{item.style}</span>
          <span className="text-zinc-300 dark:text-zinc-600">·</span>
          <span>{formatTime(item.updatedAt || item.createdAt)}</span>
          {versionCount > 0 && (
            <span className="px-1.5 py-px rounded bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300">
              v{versionCount}
            </span>
          )}
          {item.note && (
            <span className="px-1.5 py-px rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1 max-w-[220px] truncate">
              <StickyNote className="w-3 h-3 flex-none" />
              <span className="truncate">{item.note}</span>
            </span>
          )}
        </div>
        <p
          className={`text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words ${
            expanded ? '' : 'line-clamp-3'
          }`}
        >
          {item.prompt || <span className="text-zinc-400 italic">（空）</span>}
        </p>

        <div className="mt-2 flex items-center gap-1 flex-wrap text-[11px]">
          <button
            onClick={() => onCopy(item.prompt, `cur:${item.id}`)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition"
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
            onClick={onExpand}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition ${
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
                <Pencil className="w-3 h-3" /> 编辑 / 历史
              </>
            )}
          </button>
          <button
            onClick={onTogglePin}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition ${
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
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition"
              title={item.pageTitle || item.pageUrl}
            >
              <ExternalLink className="w-3 h-3" /> 来源
            </a>
          )}
          <button
            onClick={onDelete}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-rose-50 dark:hover:bg-rose-500/10 text-zinc-400 hover:text-rose-500 transition opacity-0 group-hover:opacity-100 focus:opacity-100"
            title="删除这条记录"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== 网格卡片 ==============

function ItemGridCard({
  item,
  checked,
  expanded,
  copiedKey,
  onToggleSelect,
  onCopy,
  onTogglePin,
  onExpand,
  onDelete,
}: {
  item: HistoryItem;
  checked: boolean;
  expanded: boolean;
  copiedKey: string | null;
  onToggleSelect: () => void;
  onCopy: (text: string, key: string) => void;
  onTogglePin: () => void;
  onExpand: () => void;
  onDelete: () => void;
}) {
  const versionCount = item.versions?.length || 0;
  return (
    <div
      className={`group card !p-0 overflow-hidden flex flex-col transition-all duration-200 ${
        expanded ? 'ring-2 ring-violet-500/40 shadow-lg shadow-violet-500/5' : 'hover:shadow-md hover:-translate-y-0.5'
      } ${item.pinned ? 'border-amber-300 dark:border-amber-500/40' : ''}`}
    >
      <div className="relative aspect-[4/3] bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <Thumb item={item} size="full" />
        <div className="absolute inset-x-0 top-0 p-2 flex items-start justify-between pointer-events-none">
          <label className="pointer-events-auto inline-flex items-center justify-center w-6 h-6 rounded-md bg-white/85 dark:bg-zinc-900/85 backdrop-blur ring-1 ring-black/5 dark:ring-white/10 cursor-pointer transition opacity-0 group-hover:opacity-100 has-[:checked]:opacity-100">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 accent-violet-500"
              checked={checked}
              onChange={onToggleSelect}
            />
          </label>
          <div className="pointer-events-auto flex items-center gap-1">
            {item.pinned && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/90 text-white text-[10px] font-medium shadow-sm">
                <Pin className="w-3 h-3" /> 置顶
              </span>
            )}
            {versionCount > 1 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-violet-500/90 text-white text-[10px] font-medium shadow-sm">
                v{versionCount}
              </span>
            )}
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-2 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
          <IconBtn
            onClick={() => onCopy(item.prompt, `cur:${item.id}`)}
            title="复制提示词"
            active={copiedKey === `cur:${item.id}`}
            activeColor="emerald"
          >
            {copiedKey === `cur:${item.id}` ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </IconBtn>
          <IconBtn onClick={onTogglePin} title={item.pinned ? '取消置顶' : '置顶'} active={item.pinned} activeColor="amber">
            <Pin className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn onClick={onDelete} title="删除" hoverColor="rose">
            <Trash2 className="w-3.5 h-3.5" />
          </IconBtn>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap text-[10.5px] text-zinc-500">
          <span className="px-1.5 py-px rounded bg-zinc-100 dark:bg-zinc-800 font-medium">
            {item.provider}
          </span>
          <span>{item.style}</span>
          <span className="text-zinc-300 dark:text-zinc-600">·</span>
          <span>{formatTime(item.updatedAt || item.createdAt)}</span>
        </div>
        <p className="text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300 line-clamp-3 whitespace-pre-wrap break-words flex-1">
          {item.prompt || <span className="text-zinc-400 italic">（空）</span>}
        </p>
        <button
          onClick={onExpand}
          className={`mt-1 inline-flex items-center justify-center gap-1 text-[11px] py-1.5 rounded-md transition ${
            expanded
              ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
              : 'bg-zinc-50 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" /> 收起
            </>
          ) : (
            <>
              <Pencil className="w-3 h-3" /> 编辑 / 历史
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  active,
  activeColor,
  hoverColor,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  activeColor?: 'emerald' | 'amber' | 'violet';
  hoverColor?: 'rose';
}) {
  const activeMap = {
    emerald: 'text-emerald-500',
    amber: 'text-amber-400',
    violet: 'text-violet-400',
  } as const;
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 rounded-md inline-flex items-center justify-center bg-white/85 dark:bg-zinc-900/85 backdrop-blur ring-1 ring-black/5 dark:ring-white/10 transition ${
        active ? activeMap[activeColor || 'violet'] : 'text-zinc-600 dark:text-zinc-200'
      } ${hoverColor === 'rose' ? 'hover:text-rose-500' : 'hover:text-violet-600 dark:hover:text-violet-300'}`}
    >
      {children}
    </button>
  );
}

// ============== 缩略图 ==============

function Thumb({ item, size }: { item: HistoryItem; size: 'md' | 'lg' | 'full' }) {
  const [failed, setFailed] = useState(false);
  const cls =
    size === 'full'
      ? 'absolute inset-0 w-full h-full object-cover'
      : size === 'lg'
        ? 'w-28 h-28 rounded-lg object-cover'
        : 'w-24 h-24 rounded-lg object-cover';
  const placeholderCls =
    size === 'full'
      ? 'absolute inset-0 flex items-center justify-center text-zinc-400'
      : size === 'lg'
        ? 'w-28 h-28 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-none text-zinc-400'
        : 'w-24 h-24 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-none text-zinc-400';

  if (failed || !item.thumbnail) {
    return (
      <div className={placeholderCls}>
        <ImageOff className="w-5 h-5" />
      </div>
    );
  }
  return (
    <img
      src={item.thumbnail}
      alt=""
      onError={() => setFailed(true)}
      className={`${cls} ${size === 'full' ? '' : 'flex-none bg-zinc-100 dark:bg-zinc-800'}`}
    />
  );
}

// ============== 展开面板 ==============

function ExpandedPanel({
  item,
  tab,
  onChangeTab,
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
  tab: ExpandedTab;
  onChangeTab: (t: ExpandedTab) => void;
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
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/30 px-4 py-4 space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* 左侧：大图 */}
        <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-center min-h-[220px] max-h-[320px]">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt=""
              className="max-w-full max-h-[320px] object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <ImageIcon className="w-10 h-10 text-zinc-300" />
          )}
        </div>

        {/* 右侧：Tab + 内容 */}
        <div className="space-y-3 min-w-0">
          <TabBar
            tab={tab}
            onChange={onChangeTab}
            versionCount={item.versions.length}
            dirty={dirty}
          />

          {tab === 'editor' && (
            <EditorTab
              item={item}
              draft={draft}
              draftNote={draftNote}
              onChangeDraft={onChangeDraft}
              onChangeNote={onChangeNote}
              onSaveDraft={onSaveDraft}
              onResetDraft={onResetDraft}
              onCopy={onCopy}
              copiedKey={copiedKey}
              dirty={dirty}
            />
          )}
          {tab === 'versions' && (
            <VersionsTab
              item={item}
              onCopy={onCopy}
              copiedKey={copiedKey}
              onRestoreVersion={onRestoreVersion}
              onDeleteVersion={onDeleteVersion}
            />
          )}
          {tab === 'refine' && (
            <RefineInline
              value={refineInput}
              loading={refineLoading}
              error={refineError}
              onChange={onChangeRefine}
              onSubmit={onRunRefine}
              onPick={onPickRefineSuggestion}
            />
          )}
          {tab === 'meta' && <MetaTab item={item} />}
        </div>
      </div>
    </div>
  );
}

function TabBar({
  tab,
  onChange,
  versionCount,
  dirty,
}: {
  tab: ExpandedTab;
  onChange: (t: ExpandedTab) => void;
  versionCount: number;
  dirty: boolean;
}) {
  const tabs: { id: ExpandedTab; icon: React.ReactNode; label: string; badge?: React.ReactNode }[] = [
    {
      id: 'editor',
      icon: <Pencil className="w-3.5 h-3.5" />,
      label: '编辑',
      badge: dirty ? (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
      ) : null,
    },
    {
      id: 'versions',
      icon: <HistoryIcon className="w-3.5 h-3.5" />,
      label: '版本',
      badge: (
        <span className="ml-1 text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
          {versionCount}
        </span>
      ),
    },
    {
      id: 'refine',
      icon: <Wand2 className="w-3.5 h-3.5" />,
      label: 'AI 调整',
    },
    {
      id: 'meta',
      icon: <Info className="w-3.5 h-3.5" />,
      label: '详情',
    },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/60 flex-wrap">
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition ${
              active
                ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-300 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-white'
            }`}
          >
            {t.icon}
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

function EditorTab({
  item,
  draft,
  draftNote,
  onChangeDraft,
  onChangeNote,
  onSaveDraft,
  onResetDraft,
  onCopy,
  copiedKey,
  dirty,
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
  dirty: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="label flex items-center justify-between">
          <span>当前提示词（编辑后会保存为新版本）</span>
          <span className="text-[10px] text-zinc-400 tabular-nums">{draft.length} 字</span>
        </label>
        <textarea
          value={draft}
          onChange={(e) => onChangeDraft(e.target.value)}
          spellCheck={false}
          className="input min-h-[200px] max-h-[460px] resize-y leading-relaxed font-mono text-[13px]"
        />
        <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px]">
          <button
            onClick={onSaveDraft}
            disabled={!dirty}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-violet-500 text-white transition"
          >
            <Save className="w-3.5 h-3.5" /> 保存为新版本
          </button>
          <button
            onClick={onResetDraft}
            disabled={!dirty}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 text-zinc-600 dark:text-zinc-300 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" /> 撤销改动
          </button>
          <button
            onClick={() => onCopy(draft, `draft:${item.id}`)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition"
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
            <span className="text-amber-600 dark:text-amber-300 inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
              有未保存改动
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
    </div>
  );
}

function VersionsTab({
  item,
  onCopy,
  copiedKey,
  onRestoreVersion,
  onDeleteVersion,
}: {
  item: HistoryItem;
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
  onRestoreVersion: (v: PromptVersion) => void;
  onDeleteVersion: (v: PromptVersion) => void;
}) {
  return (
    <ul className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
      {item.versions.map((v, i) => {
        const isCurrent = i === 0;
        const cid = `ver:${item.id}::${v.id}`;
        return (
          <li
            key={v.id}
            className={`p-3 ${isCurrent ? 'bg-emerald-50/60 dark:bg-emerald-500/10' : ''}`}
          >
            <div className="flex items-center gap-2 text-[11px] mb-1.5 flex-wrap">
              <SourceTag source={v.source} />
              <span className="text-zinc-500">{new Date(v.createdAt).toLocaleString()}</span>
              {v.note && (
                <span className="text-zinc-500 italic truncate max-w-[260px]">· {v.note}</span>
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
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition"
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
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20 transition"
                >
                  <RotateCcw className="w-3 h-3" /> 恢复此版本
                </button>
              )}
              {!isCurrent && (
                <button
                  onClick={() => onDeleteVersion(v)}
                  className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MetaTab({ item }: { item: HistoryItem }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-[12px] space-y-1.5">
      <MetaRow label="ID" value={<span className="font-mono break-all">{item.id}</span>} />
      <MetaRow label="供应商" value={item.provider} />
      <MetaRow label="模型" value={<span className="font-mono">{item.model}</span>} />
      <MetaRow label="风格" value={item.style} />
      <MetaRow label="创建时间" value={new Date(item.createdAt).toLocaleString()} />
      {item.updatedAt && item.updatedAt !== item.createdAt && (
        <MetaRow label="更新时间" value={new Date(item.updatedAt).toLocaleString()} />
      )}
      {item.pageUrl && (
        <MetaRow
          label="来源"
          value={
            <a
              href={item.pageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-violet-500 hover:underline break-all inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3 flex-none" />
              {item.pageTitle || item.pageUrl}
            </a>
          }
        />
      )}
      {item.imageUrl && (
        <MetaRow
          label="图片地址"
          value={<span className="font-mono text-[11px] break-all text-zinc-500">{item.imageUrl}</span>}
        />
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <div className="text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className="text-zinc-700 dark:text-zinc-200 min-w-0">{value}</div>
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
        className="input min-h-[80px] max-h-[160px] resize-y text-[12px] disabled:opacity-60"
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
            className="text-[11px] px-2 py-0.5 rounded-full border border-violet-200 dark:border-violet-500/30 bg-white/70 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20 disabled:opacity-50 transition"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          onClick={onSubmit}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-md bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white inline-flex items-center gap-1 hover:brightness-110 disabled:opacity-60 transition"
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

// ============== 状态卡 ==============

function EmptyState() {
  return (
    <div className="card text-center py-14">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-500/20 dark:to-violet-500/20 flex items-center justify-center mb-4">
        <HistoryIcon className="w-7 h-7 text-violet-500" />
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

function NoMatchState({ onClear }: { onClear: () => void }) {
  return (
    <div className="card text-center py-12 space-y-3">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
        <Search className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm text-zinc-700 dark:text-zinc-200 mb-1">没有匹配的记录</p>
        <p className="text-xs text-zinc-500">试试换个关键词，或者清除当前筛选</p>
      </div>
      <button
        onClick={onClear}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-500/40 hover:text-violet-600 dark:hover:text-violet-300 transition"
      >
        <X className="w-3.5 h-3.5" /> 清除筛选
      </button>
    </div>
  );
}

// ============== 多选浮条 ==============

function BulkActionBar({
  count,
  allVisibleSelected,
  onSelectAll,
  onClear,
  onCopy,
  onExport,
  onDelete,
}: {
  count: number;
  allVisibleSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onCopy: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-20 flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-2xl bg-zinc-900/95 dark:bg-zinc-800/95 text-zinc-100 shadow-2xl shadow-black/20 backdrop-blur ring-1 ring-white/10">
        <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-white/10">
          <CheckCheck className="w-3.5 h-3.5 text-violet-300" />
          <span>已选 {count}</span>
        </span>
        {!allVisibleSelected && (
          <button
            onClick={onSelectAll}
            className="text-xs px-2 py-1 rounded-md hover:bg-white/10 transition"
          >
            全选当前
          </button>
        )}
        <div className="h-5 w-px bg-white/15" />
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:bg-white/10 transition"
        >
          <Copy className="w-3.5 h-3.5" /> 复制
        </button>
        <button
          onClick={onExport}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:bg-white/10 transition"
        >
          <Download className="w-3.5 h-3.5" /> 导出
        </button>
        <button
          onClick={onDelete}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-rose-300 hover:bg-rose-500/20 transition"
        >
          <Trash2 className="w-3.5 h-3.5" /> 删除
        </button>
        <div className="h-5 w-px bg-white/15" />
        <button
          onClick={onClear}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-white/10 transition"
          title="取消选择"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
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
