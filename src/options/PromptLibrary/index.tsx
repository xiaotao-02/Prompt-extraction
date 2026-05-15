import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
  Layers,
  SlidersHorizontal,
  FolderTree as FolderTreeIcon,
  Inbox,
} from 'lucide-react';
import {
  appendPromptVersion,
  clearHistory,
  createFolder,
  exportAllHistoryPublic,
  getFolders,
  getHistoryItem,
  LIBRARY_REV_KEY,
  listHistoryGlobalDescPage,
  moveHistoryItemsToFolder,
  patchFolder,
  patchHistoryItem,
  removeFolder,
  removeHistory,
  removeHistoryItems,
  removePromptVersion,
  renameFolder,
  restorePromptVersion,
  scanHistoryLibraryStats,
  getSettings,
  saveSettings,
} from '@/lib/storage';
import { SETTINGS_KEY } from '@/lib/storage/keys';
import { sendOpenInPanel } from '@/lib/messaging/openSurfaces';
import type {
  HistoryItem,
  LibraryFolder,
  OneClickRewriteRandomness,
  PromptVersion,
  RefineResponse,
} from '@/lib/types';
import {
  buildOneClickRewriteInstruction,
  makeRewriteNonce,
  normalizeOneClickRewriteRandomness,
} from '@/lib/oneClickRewrite';
import type { HistoryLibraryStats } from '@/lib/storage/historyDb';
import type { SortKey, ViewMode, LibraryDockIntent, LibraryRefineJob } from './types';
import {
  MAX_PARALLEL_LIBRARY_REFINES,
  PROJECT_COLORS,
  SYSTEM_NODE,
  TREE_EXPANDED_KEY,
  TREE_SELECTED_KEY,
  TREE_WIDTH_KEY,
  VIEW_STORAGE_KEY,
} from './types';
import { FolderTree, type SelectedNodeId } from './FolderTree';
import { ItemRow } from './ItemRow';
import { ItemGridCard } from './ItemGridCard';
import { ExpandedPanel } from './ExpandedPanel';
import { ViewToggle } from './parts/ViewToggle';
import { FilterGroup } from './parts/FilterGroup';
import { BulkActionBar } from './parts/BulkActionBar';
import { EmptyState } from './parts/EmptyState';
import { NoMatchState } from './parts/NoMatchState';

const LIBRARY_PAGE_SIZE = 80;

/**
 * 提示词管理后台。
 *
 * 功能概览：
 * - 列表 / 网格双视图展示所有图片的提示词
 * - 顶部统计卡片 + 大搜索框 + chip 化筛选与排序
 * - 单条展开：内部 Tab 切换「编辑器 / 版本历史 / AI 调整 / 详情」
 * - 多选时底部出现批量操作浮条，支持批量删除 / 导出 / 复制
 * - 与 popup / background 共享同一套 IndexedDB + `library_rev` 变更戳；写入走 storage 层。
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
  /** Popup / hash 出库：展开后一次性打开「AI 调整」或「历史版本」侧栏 */
  dockIntent?: LibraryDockIntent;
  onConsumeDockIntent?: () => void;
}

export default function PromptLibrary({
  focusId,
  onConsumeFocus,
  dockIntent,
  onConsumeDockIntent,
}: PromptLibraryProps) {
  const [list, setList] = useState<HistoryItem[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [libraryStats, setLibraryStats] = useState<HistoryLibraryStats | null>(null);
  const [listCursor, setListCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const listCursorRef = useRef<string | undefined>(undefined);

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

  // 侧边栏：当前选中的节点（系统节点 / folder.id）
  const [selectedNode, setSelectedNode] = useState<SelectedNodeId>(() => {
    try {
      const saved = localStorage.getItem(TREE_SELECTED_KEY);
      if (saved) return saved as SelectedNodeId;
    } catch {
      /* ignore */
    }
    return SYSTEM_NODE.ALL;
  });
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(TREE_EXPANDED_KEY);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(TREE_WIDTH_KEY);
      const n = saved ? Number(saved) : NaN;
      if (Number.isFinite(n) && n >= 180 && n <= 480) return n;
    } catch {
      /* ignore */
    }
    return 248;
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedIdRef = useRef<string | null>(null);
  expandedIdRef.current = expandedId;
  const prevExpandedForDraftRef = useRef<string | null>(null);

  const [draft, setDraft] = useState<string>('');
  const [draftNote, setDraftNote] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [refineInput, setRefineInput] = useState('');
  const [refineJobs, setRefineJobs] = useState<LibraryRefineJob[]>([]);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [rewriteRandomness, setRewriteRandomness] =
    useState<OneClickRewriteRandomness>('moderate');
  const [actionTip, setActionTip] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    void getSettings().then((s) =>
      setRewriteRandomness(normalizeOneClickRewriteRandomness(s.oneClickRewriteRandomness))
    );
  }, []);

  useEffect(() => {
    const onStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName
    ) => {
      if (area !== 'sync' && area !== 'local') return;
      const ch = changes[SETTINGS_KEY];
      if (!ch?.newValue || typeof ch.newValue !== 'object') return;
      const rr = (ch.newValue as { oneClickRewriteRandomness?: OneClickRewriteRandomness })
        .oneClickRewriteRandomness;
      if (rr !== undefined) {
        setRewriteRandomness(normalizeOneClickRewriteRandomness(rr));
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  useEffect(() => {
    listCursorRef.current = listCursor;
  }, [listCursor]);

  const deferredKeyword = useDeferredValue(keyword);

  const usesFullLibraryScan = useCallback(() => {
    return (
      deferredKeyword.trim() !== '' ||
      filterProvider !== 'all' ||
      filterStyle !== 'all' ||
      showPinnedOnly ||
      selectedNode !== SYSTEM_NODE.ALL ||
      sortKey !== 'updated'
    );
  }, [deferredKeyword, filterProvider, filterStyle, showPinnedOnly, selectedNode, sortKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const full = usesFullLibraryScan();
      const [stats, fs] = await Promise.all([scanHistoryLibraryStats(), getFolders()]);
      setLibraryStats(stats);
      setFolders(fs);
      if (full) {
        const data = await exportAllHistoryPublic();
        setList(data);
        setListCursor(undefined);
        setHasMore(false);
      } else {
        const { items, nextCursor } = await listHistoryGlobalDescPage(LIBRARY_PAGE_SIZE);
        setList(items);
        setListCursor(nextCursor);
        setHasMore(Boolean(nextCursor) && stats.total > items.length);
      }
    } finally {
      setLoading(false);
    }
  }, [usesFullLibraryScan]);

  const reloadHistory = useCallback(async () => {
    try {
      const full = usesFullLibraryScan();
      const stats = await scanHistoryLibraryStats();
      setLibraryStats(stats);
      if (full) {
        const data = await exportAllHistoryPublic();
        setList(data);
        setListCursor(undefined);
        setHasMore(false);
      } else {
        const { items, nextCursor } = await listHistoryGlobalDescPage(LIBRARY_PAGE_SIZE);
        setList(items);
        setListCursor(nextCursor);
        setHasMore(Boolean(nextCursor) && stats.total > items.length);
      }
    } catch {
      /* ignore */
    }
  }, [usesFullLibraryScan]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading || usesFullLibraryScan()) return;
    setLoadingMore(true);
    try {
      const cur = listCursorRef.current;
      const { items, nextCursor } = await listHistoryGlobalDescPage(LIBRARY_PAGE_SIZE, cur);
      if (items.length === 0) {
        setHasMore(false);
        return;
      }
      setList((prev) => [...prev, ...items]);
      setListCursor(nextCursor);
      setHasMore(Boolean(nextCursor));
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loading, usesFullLibraryScan]);

  // folders 单独 reload，用于树操作后只刷新树（避免 loading 闪烁）
  const reloadFolders = async () => {
    const fs = await getFolders();
    setFolders(fs);
  };

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: chrome.storage.AreaName
    ) => {
      if (area !== 'local') return;
      if (LIBRARY_REV_KEY in changes) void reloadHistory();
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, [reloadHistory]);

  useEffect(() => {
    const onMsg = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      if ((message as { type: string }).type !== 'REFINE_PROGRESS') return;
      const payload = (
        message as {
          payload?: { historyId?: string; refineJobId?: string; partial?: string };
        }
      ).payload;
      const hid = payload?.historyId;
      if (!hid || hid !== expandedIdRef.current) return;
      const partial = payload?.partial;
      if (partial === undefined) return;

      setRefineJobs((prev) => {
        let jid = payload?.refineJobId;
        if (!jid && prev.length === 1) jid = prev[0]?.jobId;
        if (!jid) return prev;
        return prev.map((j) => (j.jobId === jid ? { ...j, partial } : j));
      });
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem(TREE_SELECTED_KEY, String(selectedNode));
    } catch {
      /* ignore */
    }
  }, [selectedNode]);

  useEffect(() => {
    try {
      localStorage.setItem(TREE_EXPANDED_KEY, JSON.stringify(Array.from(expandedFolderIds)));
    } catch {
      /* ignore */
    }
  }, [expandedFolderIds]);

  useEffect(() => {
    try {
      localStorage.setItem(TREE_WIDTH_KEY, String(sidebarWidth));
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);

  // deep-link：父组件传来 focusId 时，等首批 list 加载完后自动展开 + 滚动到目标。
  // - 用 list/loading 联合监听，避免 list 还没就绪就尝试聚焦。
  // - 清掉所有筛选，否则目标条目可能被 keyword / provider / style filter 隐藏。
  // - 处理完调用 onConsumeFocus 释放 focusId，防止反复触发。
  useEffect(() => {
    if (!focusId || loading) return;
    const target = list.find((i) => i.id === focusId);
    if (!target) {
      void getHistoryItem(focusId).then((one) => {
        if (!one) onConsumeFocus?.();
        else setList((prev) => (prev.some((x) => x.id === one.id) ? prev : [one, ...prev]));
      });
      return;
    }
    setView('list');
    setKeyword('');
    setFilterProvider('all');
    setFilterStyle('all');
    setShowPinnedOnly(false);
    setSelectedNode(SYSTEM_NODE.ALL);
    setExpandedId(focusId);
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-history-id="${focusId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onConsumeFocus?.();
    }, 80);
    return () => window.clearTimeout(t);
  }, [focusId, loading, list, onConsumeFocus]);

  useEffect(() => {
    setRefineJobs([]);
    setRefineError(null);
  }, [expandedId]);

  // 当展开切换时，把编辑草稿同步到当前展开项（并行 REFINE 进行中时不要覆盖草稿）
  useEffect(() => {
    if (!expandedId) {
      prevExpandedForDraftRef.current = null;
      setDraft('');
      setDraftNote('');
      setRefineInput('');
      setRefineError(null);
      return;
    }

    const expandedChanged = prevExpandedForDraftRef.current !== expandedId;
    prevExpandedForDraftRef.current = expandedId;

    if (!expandedChanged && refineJobs.length > 0) return;

    const row = list.find((i) => i.id === expandedId);
    if (row) {
      setDraft(row.prompt);
      setDraftNote(row.note || '');
      return;
    }
    void getHistoryItem(expandedId).then((one) => {
      if (!one || expandedIdRef.current !== expandedId) return;
      setDraft(one.prompt);
      setDraftNote(one.note || '');
    });
  }, [expandedId, list, refineJobs.length]);

  const showTip = (ok: boolean, msg: string) => {
    setActionTip({ ok, msg });
    setTimeout(() => setActionTip(null), 1800);
  };

  // ===== 衍生数据 =====

  const providerOptions = useMemo(
    () => libraryStats?.providers ?? [],
    [libraryStats]
  );

  const styleOptions = useMemo(() => libraryStats?.styles ?? [], [libraryStats]);

  const countByFolderId = useMemo(
    () => libraryStats?.byFolderId ?? new Map<string, number>(),
    [libraryStats]
  );

  const collectSubtreeIds = useCallback(
    (rootId: string): Set<string> => {
      const acc = new Set<string>([rootId]);
      const stack = [rootId];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const f of folders) {
          if ((f.parentId ?? null) === cur && !acc.has(f.id)) {
            acc.add(f.id);
            stack.push(f.id);
          }
        }
      }
      return acc;
    },
    [folders]
  );

  const filterLibraryItems = useCallback(
    (source: HistoryItem[]) => {
      const lower = keyword.trim().toLowerCase();
      let nm: HistoryItem[];
      if (selectedNode === SYSTEM_NODE.ALL) nm = source;
      else if (selectedNode === SYSTEM_NODE.UNSORTED) nm = source.filter((i) => !i.folderId);
      else if (selectedNode === SYSTEM_NODE.PINNED) nm = source.filter((i) => !!i.pinned);
      else {
        const subtree = collectSubtreeIds(selectedNode as string);
        nm = source.filter((i) => i.folderId && subtree.has(i.folderId));
      }
      let result = nm.filter((i) => {
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
      result = result.sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        if (sortKey === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
        if (sortKey === 'versions') return (b.versions?.length || 0) - (a.versions?.length || 0);
        return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
      });
      return result;
    },
    [
      keyword,
      selectedNode,
      collectSubtreeIds,
      showPinnedOnly,
      filterProvider,
      filterStyle,
      sortKey,
    ]
  );

  const filtered = useMemo(() => filterLibraryItems(list), [list, filterLibraryItems]);

  const nodeMatchCount = useMemo(() => {
    if (selectedNode === SYSTEM_NODE.ALL) return libraryStats?.total ?? 0;
    if (selectedNode === SYSTEM_NODE.UNSORTED) return libraryStats?.unsorted ?? 0;
    if (selectedNode === SYSTEM_NODE.PINNED) return libraryStats?.pinned ?? 0;
    const subtree = collectSubtreeIds(selectedNode as string);
    let n = 0;
    for (const fid of subtree) {
      n += countByFolderId.get(fid) || 0;
    }
    return n;
  }, [selectedNode, libraryStats, collectSubtreeIds, countByFolderId]);

  const systemCounts = useMemo(
    () => ({
      all: libraryStats?.total ?? 0,
      unsorted: libraryStats?.unsorted ?? 0,
      pinned: libraryStats?.pinned ?? 0,
    }),
    [libraryStats]
  );

  useEffect(() => {
    if (!hasMore || loading || usesFullLibraryScan()) return;
    const el = loadMoreSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { root: null, rootMargin: '280px', threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore, loading, usesFullLibraryScan, filtered.length, list.length]);

  const hasActiveFilter =
    keyword.trim() !== '' ||
    filterProvider !== 'all' ||
    filterStyle !== 'all' ||
    showPinnedOnly ||
    selectedNode !== SYSTEM_NODE.ALL;

  const clearFilters = () => {
    setKeyword('');
    setFilterProvider('all');
    setFilterStyle('all');
    setShowPinnedOnly(false);
    setSelectedNode(SYSTEM_NODE.ALL);
  };

  // 当前选中节点的可读标题（用于面包屑 / 列表头部）
  const selectedNodeLabel = useMemo(() => {
    if (selectedNode === SYSTEM_NODE.ALL) return '全部';
    if (selectedNode === SYSTEM_NODE.UNSORTED) return '未分类';
    if (selectedNode === SYSTEM_NODE.PINNED) return '置顶';
    const f = folders.find((x) => x.id === selectedNode);
    if (!f) return '全部';
    // 拼出从顶层项目到当前节点的路径，例如「项目 A › 子文件夹 B」
    const path: string[] = [];
    let cur: string | null = f.id;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const node = folders.find((x) => x.id === cur);
      if (!node) break;
      path.unshift(node.name);
      cur = node.parentId ?? null;
    }
    return path.join(' › ');
  }, [selectedNode, folders]);

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
    await reloadHistory();
  };

  const onExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
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
    await reloadHistory();
    showTip(true, '已保存为新版本');
  };

  const onRestoreVersion = async (item: HistoryItem, v: PromptVersion) => {
    await restorePromptVersion(item.id, v.id);
    await reloadHistory();
    showTip(true, '已恢复为最新版本');
  };

  const onDeleteVersion = async (item: HistoryItem, v: PromptVersion) => {
    if (item.versions.length <= 1) {
      showTip(false, '至少保留一个版本');
      return;
    }
    const isCurrent = item.versions[0]?.id === v.id;
    const msg = isCurrent
      ? '确定删除「当前版本」吗？删除后将由下一条版本自动顶替为新的当前版本，此操作不可撤销'
      : '确定删除该版本吗？此操作不可撤销';
    if (!confirm(msg)) return;
    await removePromptVersion(item.id, v.id);
    await reloadHistory();
    if (isCurrent) showTip(true, '已删除当前版本，已切换到下一版本');
  };

  const onDeleteItem = async (item: HistoryItem) => {
    if (!confirm(`删除这条记录？(${item.versions?.length || 0} 个版本将一同丢失)`)) return;
    await removeHistory(item.id);
    if (expandedId === item.id) setExpandedId(null);
    selectedIds.delete(item.id);
    setSelectedIds(new Set(selectedIds));
    await reloadHistory();
  };

  const onBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedIds.size} 条记录吗？`)) return;
    await removeHistoryItems(Array.from(selectedIds));
    if (expandedId && selectedIds.has(expandedId)) setExpandedId(null);
    setSelectedIds(new Set());
    await reloadHistory();
  };

  const onClearAll = async () => {
    const total = libraryStats?.total ?? 0;
    if (total === 0) return;
    if (!confirm(`确定清空全部 ${total} 条记录吗？此操作不可撤销`)) return;
    await clearHistory();
    setExpandedId(null);
    setSelectedIds(new Set());
    await reloadHistory();
  };

  const onExport = async () => {
    const full = await exportAllHistoryPublic();
    const exportList =
      selectedIds.size > 0 ? full.filter((i) => selectedIds.has(i.id)) : filterLibraryItems(full);
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
    const full = await exportAllHistoryPublic();
    const target =
      selectedIds.size > 0 ? full.filter((i) => selectedIds.has(i.id)) : filterLibraryItems(full);
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

  // ===== 项目 / 文件夹 操作 =====

  const handleToggleExpand = (id: string) => {
    setExpandedFolderIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateProject = async () => {
    const name = prompt('给新项目起个名字（例如「电商插画」「卡通头像」…）');
    if (!name || !name.trim()) return;
    const colorIdx = Math.floor(Math.random() * PROJECT_COLORS.length);
    const f = await createFolder({
      name: name.trim(),
      parentId: null,
      color: PROJECT_COLORS[colorIdx].id,
    });
    await reloadFolders();
    setSelectedNode(f.id);
    showTip(true, `已创建项目「${f.name}」`);
  };

  const handleCreateChild = async (parentId: string) => {
    const name = prompt('新建子文件夹的名字');
    if (!name || !name.trim()) return;
    const f = await createFolder({ name: name.trim(), parentId });
    setExpandedFolderIds((s) => new Set(s).add(parentId));
    await reloadFolders();
    setSelectedNode(f.id);
    showTip(true, `已创建文件夹「${f.name}」`);
  };

  const handleRename = async (folder: LibraryFolder) => {
    const next = prompt('重命名为：', folder.name);
    if (next == null) return;
    if (!next.trim() || next.trim() === folder.name) return;
    await renameFolder(folder.id, next.trim());
    await reloadFolders();
    showTip(true, '已重命名');
  };

  const handleDelete = async (folder: LibraryFolder) => {
    const subtreeIds = collectSubtreeIds(folder.id);
    let itemsInside = 0;
    for (const fid of subtreeIds) {
      itemsInside += countByFolderId.get(fid) || 0;
    }
    const childCount = subtreeIds.size - 1;
    const isProject = folder.parentId === null;

    let cascade = false;
    if (childCount > 0 || itemsInside > 0) {
      const summary = [
        childCount > 0 ? `${childCount} 个子文件夹` : null,
        itemsInside > 0 ? `${itemsInside} 条记录` : null,
      ]
        .filter(Boolean)
        .join('、');
      const choice = window.confirm(
        `「${folder.name}」下包含 ${summary}。\n\n` +
          `点「确定」继续删除：${isProject ? '项目' : '文件夹'}本身会被删除，记录会变为「未分类」（不会丢）。\n` +
          `点「取消」放弃此次操作。`
      );
      if (!choice) return;
      if (childCount > 0) {
        cascade = window.confirm(
          `是否级联删除「${folder.name}」下的全部子文件夹？\n\n` +
            `点「确定」= 一并删除整个子树（记录依旧变为「未分类」，不会丢）。\n` +
            `点「取消」= 仅删除当前${isProject ? '项目' : '文件夹'}，子文件夹自动上移。`
        );
      }
    } else {
      if (!confirm(`确认删除${isProject ? '项目' : '文件夹'}「${folder.name}」？`)) return;
    }

    await removeFolder(folder.id, { cascade });
    if (selectedNode === folder.id) setSelectedNode(SYSTEM_NODE.ALL);
    await reloadFolders();
    await reloadHistory();
    showTip(true, '已删除');
  };

  const handleChangeColor = async (folder: LibraryFolder, color: string) => {
    await patchFolder(folder.id, { color });
    await reloadFolders();
  };

  const handleMoveItems = async (itemIds: string[], folderId: string | null) => {
    if (itemIds.length === 0) return;
    const moved = await moveHistoryItemsToFolder(itemIds, folderId);
    await reloadHistory();
    if (moved > 0) {
      const targetName =
        folderId == null
          ? '未分类'
          : folders.find((f) => f.id === folderId)?.name || '目标文件夹';
      showTip(true, `已移动 ${moved} 条到「${targetName}」`);
    } else {
      showTip(true, '已在该位置，无需移动');
    }
  };

  const handleMoveOne = (item: HistoryItem) => async (folderId: string | null) => {
    await handleMoveItems([item.id], folderId);
  };

  const onBulkMove = async (folderId: string | null) => {
    if (selectedIds.size === 0) return;
    await handleMoveItems(Array.from(selectedIds), folderId);
    setSelectedIds(new Set());
  };

  // 「召回到悬浮窗」：把这条记录扔到当前活跃网页 tab 的浮动面板里继续编辑。
  // 因为 options 自己就是一个 tab，用户在这里点的瞬间 active tab = options 页本身，
  // 没法注入 content script。background 的 pickPanelTargetTab 会自动挑一个最近
  // 访问过的"普通网页 tab"作为目标，并把那张 tab 切到前台 —— 这条链路用户视线
  // 会从 options 切走，所以这里仅在失败时弹一条 actionTip，让用户知道为啥没召回。
  const onRecallToPanel = (item: HistoryItem) => {
    sendOpenInPanel(item.id, {
      onResponse: (resp, lastErr) => {
        if (lastErr || !resp) {
          showTip(false, lastErr || '后台未响应');
          return;
        }
        if (!resp.ok) {
          showTip(false, resp.error || '召回失败');
          return;
        }
        showTip(true, '已召回到悬浮窗');
      },
    });
  };

  const persistRewriteRandomness = (level: OneClickRewriteRandomness) => {
    setRewriteRandomness(level);
    void getSettings().then((s) => saveSettings({ ...s, oneClickRewriteRandomness: level }));
  };

  const sendLibraryRefine = (
    item: HistoryItem,
    instruction: string,
    kind: LibraryRefineJob['kind']
  ) => {
    const baseline = draft || item.prompt;
    if (!baseline.trim()) return;

    let newJobId: string | null = null;
    setRefineJobs((prev) => {
      if (expandedIdRef.current !== item.id) return prev;
      if (prev.length >= MAX_PARALLEL_LIBRARY_REFINES) return prev;
      newJobId = crypto.randomUUID();
      return [
        {
          jobId: newJobId,
          kind,
          baselinePrompt: baseline,
          instruction,
        },
        ...prev,
      ];
    });

    if (!newJobId) {
      if (expandedIdRef.current === item.id) {
        showTip(false, `最多同时 ${MAX_PARALLEL_LIBRARY_REFINES} 条 AI 调整任务`);
      }
      return;
    }

    setRefineError(null);
    chrome.runtime.sendMessage(
      {
        type: 'REFINE_PROMPT',
        payload: {
          historyId: item.id,
          instruction,
          current: baseline,
          refineJobId: newJobId,
        },
      },
      (resp: RefineResponse | undefined) => {
        const dropJob = () =>
          setRefineJobs((prev) => prev.filter((j) => j.jobId !== newJobId));

        if (chrome.runtime.lastError || !resp) {
          dropJob();
          setRefineError(chrome.runtime.lastError?.message || '后台未响应');
          return;
        }
        if (!resp.ok) {
          dropJob();
          setRefineError(resp.error);
          return;
        }
        setRefineInput('');
        dropJob();
        void reloadHistory().then(() => {
          showTip(true, 'AI 已生成新版本');
        });
      }
    );
  };

  const runRefine = (item: HistoryItem) => {
    const instruction = refineInput.trim();
    if (!instruction) {
      setRefineError('请先输入修改要求');
      return;
    }
    sendLibraryRefine(item, instruction, 'refine');
  };

  const runOneClickRewrite = (item: HistoryItem) => {
    const text = (draft || item.prompt).trim();
    if (!text) return;
    sendLibraryRefine(
      item,
      buildOneClickRewriteInstruction(rewriteRandomness, makeRewriteNonce()),
      'rewrite'
    );
  };

  // ===== UI =====

  return (
    <div className="flex gap-5 items-start">
      {/* 左侧目录树侧边栏：可折叠，宽度可拖拽并持久化 */}
      {showSidebar && (
        <div className="hidden md:flex sticky top-[88px] max-h-[calc(100vh-120px)] flex-none items-stretch">
          <aside
            className="card !p-3 overflow-auto"
            style={{ width: sidebarWidth }}
          >
            <FolderTree
              folders={folders}
              countByFolderId={countByFolderId}
              systemCounts={systemCounts}
              selectedId={selectedNode}
              expandedIds={expandedFolderIds}
              onSelect={setSelectedNode}
              onToggleExpand={handleToggleExpand}
              onCreateProject={handleCreateProject}
              onCreateChild={handleCreateChild}
              onRename={handleRename}
              onDelete={handleDelete}
              onChangeColor={handleChangeColor}
              onDropItems={(ids, fid) => void handleMoveItems(ids, fid)}
            />
          </aside>
          {/* 拖拽手柄：按下后跟随鼠标调宽度，松开持久化 */}
          <div
            role="separator"
            aria-orientation="vertical"
            title="拖动调整目录宽度"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = sidebarWidth;
              const onMove = (ev: MouseEvent) => {
                const next = Math.max(180, Math.min(480, startW + (ev.clientX - startX)));
                setSidebarWidth(next);
              };
              const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
            className="w-1.5 mx-1 rounded-full cursor-col-resize bg-transparent hover:bg-violet-300/40 dark:hover:bg-violet-500/30 transition"
          />
        </div>
      )}

      <div
        className={`flex-1 min-w-0 space-y-5 ${
          selectedIds.size > 0 ? 'pb-24 max-sm:pb-28' : ''
        }`}
      >
      {/* 工具栏：面包屑 + 搜索 + 操作按钮 + 筛选 chips 合并为单层 */}
      <section className="card !p-3 space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 侧栏折叠 */}
          <button
            onClick={() => setShowSidebar((v) => !v)}
            className="hidden md:inline-flex items-center justify-center w-7 h-7 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-300 hover:border-violet-300 dark:hover:border-violet-500/40 transition flex-none"
            title={showSidebar ? '隐藏目录侧栏' : '显示目录侧栏'}
            aria-label={showSidebar ? '隐藏目录侧栏' : '显示目录侧栏'}
          >
            <FolderTreeIcon className="w-3.5 h-3.5" />
          </button>

          {/* 当前节点标签 */}
          {(() => {
            const NodeIcon =
              selectedNode === SYSTEM_NODE.UNSORTED
                ? Inbox
                : selectedNode === SYSTEM_NODE.PINNED
                  ? Pin
                  : Layers;
            return (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 flex-none">
                <NodeIcon className="w-3 h-3 text-zinc-500 dark:text-zinc-400" />
                <span className="truncate max-w-[200px]" title={selectedNodeLabel}>{selectedNodeLabel}</span>
                <span className="text-zinc-400 dark:text-zinc-500 tabular-nums">{nodeMatchCount}</span>
              </span>
            );
          })()}

          {/* 搜索框 */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              className="input !pl-8 !py-1.5 !text-xs"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索 prompt / 备注 / 页面标题 / URL…"
            />
            {keyword && (
              <button
                onClick={() => setKeyword('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* 操作按钮组 */}
          <div className="flex items-center gap-1.5 flex-none">
            <ViewToggle view={view} onChange={setView} />
            <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
            <button
              onClick={onCopyAllPrompts}
              disabled={(libraryStats?.total ?? 0) === 0}
              className="btn-ghost text-[11px] !px-2 !py-1 disabled:opacity-50"
              title="复制（选中或全部筛选结果）的提示词"
            >
              <Copy className="w-3 h-3" /> 复制
            </button>
            <button
              onClick={onExport}
              disabled={(libraryStats?.total ?? 0) === 0}
              className="btn-ghost text-[11px] !px-2 !py-1 disabled:opacity-50"
              title="导出选中或全部记录为 JSON"
            >
              <Download className="w-3 h-3" /> 导出
            </button>
            <button
              onClick={onClearAll}
              disabled={(libraryStats?.total ?? 0) === 0}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-rose-300 dark:hover:border-rose-500/40 hover:text-rose-500 disabled:opacity-50 transition"
              title="清空全部记录"
            >
              <Eraser className="w-3 h-3" /> 清空
            </button>
          </div>
        </div>

        {/* 筛选 chips */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
      ) : (libraryStats?.total ?? 0) === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <NoMatchState onClear={clearFilters} />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          {filtered.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <div
                key={item.id}
                className={`min-h-0 ${expanded ? 'col-span-full' : ''}`}
              >
                <ItemGridCard
                  item={item}
                  checked={selectedIds.has(item.id)}
                  expanded={expanded}
                  copiedKey={copiedKey}
                  folders={folders}
                  selectedIds={selectedIds}
                  onToggleSelect={() => toggleSelect(item.id)}
                  onCopy={onCopy}
                  onTogglePin={() => onTogglePin(item)}
                  onExpand={() => onExpand(item.id)}
                  onDelete={() => onDeleteItem(item)}
                  onRecallToPanel={() => onRecallToPanel(item)}
                  onMoveTo={handleMoveOne(item)}
                />
                {expanded && (
                  <div className="mt-3 card !p-0 overflow-hidden">
                    <ExpandedPanel
                      item={item}
                      draft={draft}
                      draftNote={draftNote}
                      onChangeDraft={setDraft}
                      onChangeNote={setDraftNote}
                      onSaveDraft={() => onSaveDraft(item)}
                      rewriteRandomness={rewriteRandomness}
                      onRewriteRandomnessChange={persistRewriteRandomness}
                      onOneClickRewrite={() => runOneClickRewrite(item)}
                      onCopy={onCopy}
                      copiedKey={copiedKey}
                      onRestoreVersion={(v) => onRestoreVersion(item, v)}
                      onDeleteVersion={(v) => onDeleteVersion(item, v)}
                      refineInput={refineInput}
                      refineJobs={refineJobs}
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
                      initialDock={
                        dockIntent && expandedId === item.id ? dockIntent : null
                      }
                      onInitialDockConsumed={onConsumeDockIntent}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <li
                key={item.id}
                data-history-id={item.id}
                className={`card !p-0 transition-all duration-200 ${
                  expanded
                    ? 'ring-2 ring-violet-500/40 shadow-lg shadow-violet-500/5'
                    : 'overflow-hidden hover:shadow-md hover:-translate-y-px'
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
                  folders={folders}
                  selectedIds={selectedIds}
                  onToggleSelect={() => toggleSelect(item.id)}
                  onCopy={onCopy}
                  onTogglePin={() => onTogglePin(item)}
                  onExpand={() => onExpand(item.id)}
                  onDelete={() => onDeleteItem(item)}
                  onRecallToPanel={() => onRecallToPanel(item)}
                  onMoveTo={handleMoveOne(item)}
                />
                {expanded && (
                  <ExpandedPanel
                    item={item}
                    draft={draft}
                    draftNote={draftNote}
                    onChangeDraft={setDraft}
                    onChangeNote={setDraftNote}
                    onSaveDraft={() => onSaveDraft(item)}
                    rewriteRandomness={rewriteRandomness}
                    onRewriteRandomnessChange={persistRewriteRandomness}
                    onOneClickRewrite={() => runOneClickRewrite(item)}
                    onCopy={onCopy}
                    copiedKey={copiedKey}
                    onRestoreVersion={(v) => onRestoreVersion(item, v)}
                    onDeleteVersion={(v) => onDeleteVersion(item, v)}
                    refineInput={refineInput}
                    refineJobs={refineJobs}
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
                    initialDock={
                      dockIntent && expandedId === item.id ? dockIntent : null
                    }
                    onInitialDockConsumed={onConsumeDockIntent}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && !usesFullLibraryScan() && (
        <div
          ref={loadMoreSentinelRef}
          className="flex justify-center items-center gap-2 py-8 text-xs text-zinc-500"
        >
          {loadingMore ? <Loader2 className="w-4 h-4 animate-spin text-violet-500" /> : null}
          <span>{loadingMore ? '加载更多…' : '下滑加载更多'}</span>
        </div>
      )}

      {/* 批量操作浮条 */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          allVisibleSelected={filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id))}
          folders={folders}
          onSelectAll={selectAllVisible}
          onClear={clearSelection}
          onCopy={onCopyAllPrompts}
          onExport={onExport}
          onDelete={onBulkDelete}
          onMoveTo={onBulkMove}
        />
      )}
      </div>
    </div>
  );
}
