import * as React from 'react';
import {
  Copy,
  Check,
  Pin,
  Pencil,
  ChevronUp,
  Trash2,
} from 'lucide-react';
import type { HistoryItem } from '@/lib/types';
import { formatTime } from '../_shared/time';
import { Thumb } from './Thumb';
import { IconBtn } from './IconBtn';

// ============== 网格卡片 ==============

export function ItemGridCard({
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
  // 网格卡片整卡可点击：和列表行一致，避免划选文本时误触发
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const onCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && sel.toString().length > 0 && sel.containsNode(e.currentTarget, true)) return;
    onExpand();
  };
  return (
    <div
      data-history-id={item.id}
      className={`group card !p-0 overflow-hidden flex flex-col transition-all duration-200 cursor-pointer ${
        expanded ? 'ring-2 ring-violet-500/40 shadow-lg shadow-violet-500/5' : 'hover:shadow-md hover:-translate-y-0.5'
      } ${item.pinned ? 'border-amber-300 dark:border-amber-500/40' : ''}`}
      onClick={onCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onExpand();
        }
      }}
    >
      <div className="relative aspect-[4/3] bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <Thumb item={item} size="full" />
        <div className="absolute inset-x-0 top-0 p-2 flex items-start justify-between pointer-events-none">
          <label
            onClick={stop}
            className="pointer-events-auto inline-flex items-center justify-center w-6 h-6 rounded-md bg-white/85 dark:bg-zinc-900/85 backdrop-blur ring-1 ring-black/5 dark:ring-white/10 cursor-pointer transition opacity-0 group-hover:opacity-100 has-[:checked]:opacity-100"
          >
            <input
              type="checkbox"
              className="w-3.5 h-3.5 accent-violet-500"
              checked={checked}
              onChange={onToggleSelect}
              onClick={stop}
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
          onClick={(e) => {
            stop(e);
            onExpand();
          }}
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
