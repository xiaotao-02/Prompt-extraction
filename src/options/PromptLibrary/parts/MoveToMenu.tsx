import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FolderInput, Inbox, Search } from 'lucide-react';
import type { LibraryFolder } from '@/lib/types';
import { getProjectColor } from '../types';

/**
 * 「移动到…」下拉菜单。展开后展示树形 folders 列表 + 「未分类」。
 *
 * 通过 absolute 定位悬浮在触发按钮下方，外部点击自动关闭；
 * 调用方负责把它放在 `relative` 的容器里。
 */
export function MoveToMenu({
  folders,
  currentFolderId,
  onPick,
  onClose,
  align = 'right',
  placement = 'bottom',
  /** 给菜单加最大高度滚动；默认 280px */
  maxHeight = 280,
}: {
  folders: LibraryFolder[];
  currentFolderId?: string | null;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
  align?: 'left' | 'right';
  /** 菜单出现在触发器的下方（默认）还是上方（用于贴底浮条） */
  placement?: 'top' | 'bottom';
  maxHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current) return;
      if (!ref.current.contains(t)) onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  // 把 folders 拍平成「带缩进的列表」并按层级 + sortKey 排序
  const flat = useMemo(() => flattenFolders(folders), [folders]);
  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return flat;
    return flat.filter((f) => f.folder.name.toLowerCase().includes(q));
  }, [flat, keyword]);

  return (
    <div
      ref={ref}
      className={`absolute z-40 w-64 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl shadow-black/10 overflow-hidden ${
        align === 'right' ? 'right-0' : 'left-0'
      } ${placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'}`}
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
    </div>
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
