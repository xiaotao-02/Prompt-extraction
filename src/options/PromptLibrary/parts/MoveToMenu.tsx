import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderInput, Inbox, Search } from 'lucide-react';
import type { LibraryFolder } from '@/lib/types';
import { getProjectColor } from '../types';

/**
 * 「移动到…」下拉菜单。展开后展示树形 folders 列表 + 「未分类」。
 *
 * 实现要点：使用 `createPortal` 把菜单渲染到 `document.body`，并以 `fixed` 定位
 * 跟随触发器位置浮动。这样可以**穿透所有 `overflow: hidden` 的祖先**（列表
 * 行的 `<li>` 为了保留卡片圆角强制裁切，会把普通 absolute 弹层切掉），同时
 * 自动判断空间不够时弹向触发器上方而不是下方。
 *
 * 调用方需要把触发按钮的 ref 传进来（`anchorRef`），无需自己管 placement。
 */
export function MoveToMenu({
  anchorRef,
  folders,
  currentFolderId,
  onPick,
  onClose,
  align = 'right',
  /** 给菜单内容区加最大高度滚动；默认 280px。整菜单实际高度 ≈ 该值 + 搜索框 56px */
  maxHeight = 280,
}: {
  /**
   * 触发按钮的 ref。菜单会跟随它的视口位置定位；如果触发器从 DOM 中卸载或被
   * 滚动到不可见，菜单会自动跟随，不会出现错位。
   */
  anchorRef: React.RefObject<HTMLElement | null>;
  folders: LibraryFolder[];
  currentFolderId?: string | null;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
  /** 菜单与触发器的对齐方式：right = 右对齐，left = 左对齐 */
  align?: 'left' | 'right';
  maxHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [keyword, setKeyword] = useState('');
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placeAbove: boolean;
  } | null>(null);

  const MENU_WIDTH = 256;
  // 估算菜单总高度：搜索框 ~56px + 内容区 maxHeight。仅用于空间不足时的「弹向上方」决策
  const MENU_HEIGHT_ESTIMATE = maxHeight + 56;

  // 计算并跟踪触发器位置：首次渲染 + window resize/scroll 都重算
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const update = () => {
      const a = anchorRef.current;
      if (!a) return;
      const rect = a.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top;
      // 如果下方空间放不下完整菜单、且上方空间更宽裕 → 弹向上方
      const placeAbove = spaceBelow < MENU_HEIGHT_ESTIMATE && spaceAbove > spaceBelow;
      const top = placeAbove ? rect.top - 4 : rect.bottom + 4;
      const rawLeft =
        align === 'right' ? rect.right - MENU_WIDTH : rect.left;
      // 限制水平边界，避免菜单溢出视口
      const left = Math.max(8, Math.min(rawLeft, vw - MENU_WIDTH - 8));
      setPos({ top, left, placeAbove });
    };

    update();
    // capture: true → 监听所有滚动祖先（包括 sticky header 内部容器），保证
    // 菜单永远跟着触发器走
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorRef, align, MENU_HEIGHT_ESTIMATE]);

  // 外部点击关闭：菜单本身或触发器内部点击不算外部
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const flat = useMemo(() => flattenFolders(folders), [folders]);
  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return flat;
    return flat.filter((f) => f.folder.name.toLowerCase().includes(q));
  }, [flat, keyword]);

  if (!pos || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[2147483600] w-64 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl shadow-black/20 overflow-hidden"
      style={{
        top: pos.top,
        left: pos.left,
        // 弹向上方时通过 translateY(-100%) 把锚点对齐到菜单底部
        transform: pos.placeAbove ? 'translateY(-100%)' : undefined,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-2 border-b border-zinc-100 dark:border-zinc-800">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            autoFocus
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索文件夹…"
            className="w-full pl-7 pr-2 py-1.5 text-[12px] rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 outline-none focus:ring-2 focus:ring-violet-500/40"
          />
        </div>
      </div>
      <div className="overflow-auto" style={{ maxHeight }}>
        <button
          onClick={() => onPick(null)}
          className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
        >
          <Inbox className="w-3.5 h-3.5 text-zinc-400 flex-none" />
          <span className="flex-1 text-left">未分类</span>
          {currentFolderId == null && <Check className="w-3.5 h-3.5 text-violet-500" />}
        </button>
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-zinc-400 text-center">
            {flat.length === 0 ? '还没有项目，先去左侧目录新建' : '没有匹配的文件夹'}
          </div>
        ) : (
          filtered.map(({ folder, depth }) => {
            const isProject = folder.parentId === null;
            const color = getProjectColor(folder.color);
            return (
              <button
                key={folder.id}
                onClick={() => onPick(folder.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                style={{ paddingLeft: 12 + depth * 14 }}
              >
                {isProject ? (
                  <span
                    className={`flex-none w-2.5 h-2.5 rounded-full ${color.dot}`}
                    aria-hidden="true"
                  />
                ) : (
                  <FolderInput className="w-3.5 h-3.5 text-amber-500 flex-none" />
                )}
                <span className={`flex-1 text-left truncate ${isProject ? 'font-medium' : ''}`}>
                  {folder.name}
                </span>
                {currentFolderId === folder.id && (
                  <Check className="w-3.5 h-3.5 text-violet-500" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>,
    document.body
  );
}

interface FlatFolderRow {
  folder: LibraryFolder;
  depth: number;
}

function flattenFolders(folders: LibraryFolder[]): FlatFolderRow[] {
  const byParent = new Map<string | null, LibraryFolder[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    const arr = byParent.get(key) || [];
    arr.push(f);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      const ka = a.sortKey ?? 0;
      const kb = b.sortKey ?? 0;
      if (ka !== kb) return ka - kb;
      return a.name.localeCompare(b.name);
    });
  }
  const out: FlatFolderRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const list = byParent.get(parentId) || [];
    for (const f of list) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
