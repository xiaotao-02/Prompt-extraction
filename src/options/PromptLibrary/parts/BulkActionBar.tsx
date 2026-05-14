import { useState } from 'react';
import { CheckCheck, Copy, Download, FolderInput, Trash2, X } from 'lucide-react';
import type { LibraryFolder } from '@/lib/types';
import { MoveToMenu } from './MoveToMenu';

// ============== 多选浮条 ==============

export function BulkActionBar({
  count,
  allVisibleSelected,
  folders,
  onSelectAll,
  onClear,
  onCopy,
  onExport,
  onDelete,
  onMoveTo,
}: {
  count: number;
  allVisibleSelected: boolean;
  folders: LibraryFolder[];
  onSelectAll: () => void;
  onClear: () => void;
  onCopy: () => void;
  onExport: () => void;
  onDelete: () => void;
  onMoveTo?: (folderId: string | null) => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
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
        {onMoveTo && (
          <div className="relative">
            <button
              onClick={() => setMoveOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:bg-white/10 transition"
            >
              <FolderInput className="w-3.5 h-3.5" /> 移动到
            </button>
            {moveOpen && (
              <MoveToMenu
                folders={folders}
                onClose={() => setMoveOpen(false)}
                onPick={(fid) => {
                  setMoveOpen(false);
                  onMoveTo(fid);
                }}
                align="right"
                placement="top"
              />
            )}
          </div>
        )}
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
