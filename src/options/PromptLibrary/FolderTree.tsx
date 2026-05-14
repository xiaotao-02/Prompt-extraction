import * as React from 'react';
import { useMemo, useState } from 'react';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Inbox,
  Layers,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from 'lucide-react';
import type { LibraryFolder } from '@/lib/types';
import {
  PROJECT_COLORS,
  SYSTEM_NODE,
  type SystemNodeId,
  getProjectColor,
} from './types';

/**
 * 侧边栏目录树。
 *
 * 节点类型：
 * - **系统虚拟节点**：「全部 / 未分类 / 置顶」三个固定项，不参与 folders 数据
 * - **项目**：folder.parentId === null 的顶层节点，前缀有彩色圆点
 * - **文件夹**：项目下任意层级的子节点
 *
 * 交互：
 * - 单击切换选中（onSelect）；展开/收起箭头单独区域不会触发选中
 * - 每个 folder 行右侧悬浮出现「+ 新建子文件夹 / ⋯ 更多」
 * - 拖拽 HistoryItem（data-history-id 元素）到节点行可触发 onDropItem 把记录移动过去
 */
export type SelectedNodeId = string | SystemNodeId;

interface FolderTreeProps {
  folders: LibraryFolder[];
  /** 用于在节点右侧显示「N 条」徽标 */
  countByFolderId: Map<string, number>;
  /** 系统节点条目数 */
  systemCounts: { all: number; unsorted: number; pinned: number };
  selectedId: SelectedNodeId;
  expandedIds: Set<string>;
  onSelect: (id: SelectedNodeId) => void;
  onToggleExpand: (id: string) => void;
  onCreateProject: () => void;
  onCreateChild: (parentId: string) => void;
  onRename: (folder: LibraryFolder) => void;
  onDelete: (folder: LibraryFolder) => void;
  onChangeColor: (folder: LibraryFolder, color: string) => void;
  /** 拖拽落入：把 itemIds 移动到 folderId（null = 未分类） */
  onDropItems: (itemIds: string[], folderId: string | null) => void;
}

interface TreeNode {
  folder: LibraryFolder;
  children: TreeNode[];
  /** 该节点（含子树）累计的 history 数 */
  total: number;
}

function buildTree(folders: LibraryFolder[], countByFolderId: Map<string, number>): TreeNode[] {
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
  const build = (parentId: string | null): TreeNode[] => {
    const list = byParent.get(parentId) || [];
    return list.map((folder) => {
      const children = build(folder.id);
      const self = countByFolderId.get(folder.id) || 0;
      const total = children.reduce((s, c) => s + c.total, 0) + self;
      return { folder, children, total };
    });
  };
  return build(null);
}

export function FolderTree(props: FolderTreeProps) {
  const {
    folders,
    countByFolderId,
    systemCounts,
    selectedId,
    expandedIds,
    onSelect,
    onToggleExpand,
    onCreateProject,
    onCreateChild,
    onRename,
    onDelete,
    onChangeColor,
    onDropItems,
  } = props;

  const tree = useMemo(() => buildTree(folders, countByFolderId), [folders, countByFolderId]);

  return (
    <aside className="w-full">
      <div className="flex items-center justify-between mb-2 px-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          目录
        </h2>
        <button
          onClick={onCreateProject}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-zinc-500 hover:text-violet-600 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition"
          title="新建项目"
        >
          <Plus className="w-3.5 h-3.5" /> 新建项目
        </button>
      </div>

      {/* 系统节点 */}
      <div className="space-y-0.5 mb-2">
        <SystemNodeRow
          icon={<Layers className="w-3.5 h-3.5" />}
          label="全部"
          count={systemCounts.all}
          active={selectedId === SYSTEM_NODE.ALL}
          onClick={() => onSelect(SYSTEM_NODE.ALL)}
          onDropItems={(ids) => onDropItems(ids, null)}
          dropEnabled
        />
        <SystemNodeRow
          icon={<Inbox className="w-3.5 h-3.5" />}
          label="未分类"
          count={systemCounts.unsorted}
          active={selectedId === SYSTEM_NODE.UNSORTED}
          onClick={() => onSelect(SYSTEM_NODE.UNSORTED)}
          onDropItems={(ids) => onDropItems(ids, null)}
          dropEnabled
        />
        <SystemNodeRow
          icon={<Pin className="w-3.5 h-3.5" />}
          label="置顶"
          count={systemCounts.pinned}
          active={selectedId === SYSTEM_NODE.PINNED}
          onClick={() => onSelect(SYSTEM_NODE.PINNED)}
        />
      </div>

      <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-2" />

      {/* 项目 / 文件夹 */}
      {tree.length === 0 ? (
        <div className="px-2 py-6 text-center text-[11px] text-zinc-400">
          还没有项目
          <button
            onClick={onCreateProject}
            className="block mx-auto mt-2 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-violet-600 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition"
          >
            <FolderPlus className="w-3.5 h-3.5" /> 创建第一个项目
          </button>
        </div>
      ) : (
        <ul className="space-y-0.5">
          {tree.map((node) => (
            <FolderNodeView
              key={node.folder.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
              onChangeColor={onChangeColor}
              onDropItems={onDropItems}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}

function SystemNodeRow({
  icon,
  label,
  count,
  active,
  onClick,
  onDropItems,
  dropEnabled,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onDropItems?: (ids: string[]) => void;
  dropEnabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onDragOver={
        dropEnabled
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setHover(true);
            }
          : undefined
      }
      onDragLeave={dropEnabled ? () => setHover(false) : undefined}
      onDrop={
        dropEnabled && onDropItems
          ? (e) => {
              e.preventDefault();
              setHover(false);
              const raw = e.dataTransfer.getData('application/x-history-ids');
              if (!raw) return;
              try {
                const ids = JSON.parse(raw) as string[];
                if (Array.isArray(ids) && ids.length > 0) onDropItems(ids);
              } catch {
                /* ignore */
              }
            }
          : undefined
      }
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12.5px] transition ${
        active
          ? 'bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-200 font-medium'
          : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
      } ${hover ? 'ring-2 ring-violet-400/60' : ''}`}
    >
      <span className="text-zinc-400 dark:text-zinc-500 flex-none">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {count > 0 && (
        <span className="text-[10px] px-1.5 py-px rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
          {count}
        </span>
      )}
    </button>
  );
}

function FolderNodeView({
  node,
  depth,
  selectedId,
  expandedIds,
  onSelect,
  onToggleExpand,
  onCreateChild,
  onRename,
  onDelete,
  onChangeColor,
  onDropItems,
}: {
  node: TreeNode;
  depth: number;
  selectedId: SelectedNodeId;
  expandedIds: Set<string>;
  onSelect: (id: SelectedNodeId) => void;
  onToggleExpand: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onRename: (folder: LibraryFolder) => void;
  onDelete: (folder: LibraryFolder) => void;
  onChangeColor: (folder: LibraryFolder, color: string) => void;
  onDropItems: (itemIds: string[], folderId: string | null) => void;
}) {
  const { folder, children, total } = node;
  const isProject = folder.parentId === null;
  const expanded = expandedIds.has(folder.id);
  const active = selectedId === folder.id;
  const color = getProjectColor(folder.color);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const hasChildren = children.length > 0;

  return (
    <li>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropHover(true);
        }}
        onDragLeave={() => setDropHover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropHover(false);
          const raw = e.dataTransfer.getData('application/x-history-ids');
          if (!raw) return;
          try {
            const ids = JSON.parse(raw) as string[];
            if (Array.isArray(ids) && ids.length > 0) onDropItems(ids, folder.id);
          } catch {
            /* ignore */
          }
        }}
        className={`group flex items-center gap-1 pr-1 rounded-lg text-[12.5px] transition ${
          active
            ? 'bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-200'
            : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
        } ${dropHover ? 'ring-2 ring-violet-400/60' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {/* 展开箭头：仅在有子节点时可点；没有子节点时占位 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleExpand(folder.id);
          }}
          className={`flex-none w-5 h-6 inline-flex items-center justify-center rounded ${
            hasChildren ? 'hover:bg-zinc-200/70 dark:hover:bg-zinc-700/60' : ''
          }`}
          tabIndex={hasChildren ? 0 : -1}
          aria-label={hasChildren ? (expanded ? '收起' : '展开') : undefined}
        >
          {hasChildren ? (
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''} ${
                active ? 'text-violet-500' : 'text-zinc-400'
              }`}
            />
          ) : null}
        </button>

        <button
          onClick={() => onSelect(folder.id)}
          className="flex-1 min-w-0 inline-flex items-center gap-1.5 py-1.5 text-left"
          title={folder.name}
        >
          {isProject ? (
            <span
              className={`flex-none w-2.5 h-2.5 rounded-full ${color.dot}`}
              aria-hidden="true"
            />
          ) : expanded && hasChildren ? (
            <FolderOpen className="w-3.5 h-3.5 text-amber-500 flex-none" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-amber-500 flex-none" />
          )}
          <span className={`truncate ${isProject ? 'font-semibold' : ''}`}>{folder.name}</span>
        </button>

        {total > 0 && (
          <span className="text-[10px] px-1.5 py-px rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
            {total}
          </span>
        )}

        <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex items-center gap-0.5 ml-0.5 transition">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCreateChild(folder.id);
            }}
            title="在此新建子文件夹"
            className="p-1 rounded hover:bg-zinc-200/70 dark:hover:bg-zinc-700/60 text-zinc-400 hover:text-violet-600 dark:hover:text-violet-300"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              title="更多"
              className="p-1 rounded hover:bg-zinc-200/70 dark:hover:bg-zinc-700/60 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-100"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <NodeMenu
                folder={folder}
                onClose={() => setMenuOpen(false)}
                onRename={() => {
                  setMenuOpen(false);
                  onRename(folder);
                }}
                onDelete={() => {
                  setMenuOpen(false);
                  onDelete(folder);
                }}
                onChangeColor={(c) => {
                  setMenuOpen(false);
                  onChangeColor(folder, c);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {expanded && hasChildren && (
        <ul className="space-y-0.5 mt-0.5">
          {children.map((child) => (
            <FolderNodeView
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
              onChangeColor={onChangeColor}
              onDropItems={onDropItems}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function NodeMenu({
  folder,
  onClose,
  onRename,
  onDelete,
  onChangeColor,
}: {
  folder: LibraryFolder;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onChangeColor: (color: string) => void;
}) {
  const isProject = folder.parentId === null;
  // 点击其它任意位置关闭菜单
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-folder-menu]')) onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      data-folder-menu
      className="absolute right-0 top-7 z-30 w-44 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg shadow-black/10 overflow-hidden"
    >
      <button
        onClick={onRename}
        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
      >
        <Pencil className="w-3.5 h-3.5" /> 重命名
      </button>
      {isProject && (
        <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800">
          <div className="text-[10px] text-zinc-400 mb-1.5">项目颜色</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c.id}
                onClick={() => onChangeColor(c.id)}
                title={c.label}
                className={`w-4 h-4 rounded-full ${c.dot} ring-2 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900 ${
                  folder.color === c.id ? 'ring-zinc-400 dark:ring-zinc-300' : 'ring-transparent'
                }`}
              />
            ))}
          </div>
        </div>
      )}
      <div className="border-t border-zinc-100 dark:border-zinc-800">
        <button
          onClick={onDelete}
          className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition"
        >
          <Trash2 className="w-3.5 h-3.5" /> 删除
        </button>
      </div>
    </div>
  );
}
