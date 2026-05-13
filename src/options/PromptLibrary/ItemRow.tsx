import * as React from 'react';
import {
  Copy,
  Check,
  Pin,
  PinOff,
  Pencil,
  ChevronUp,
  ExternalLink,
  Trash2,
  StickyNote,
} from 'lucide-react';
import type { HistoryItem } from '@/lib/types';
import { formatTime } from '../_shared/time';
import { Thumb } from './Thumb';

// ============== 列表行卡片 ==============

export function ItemRow({
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
  // 让用户点击整行任意空白处都能 toggle 展开/收起；同时仍要支持划选 prompt 文本
  // 与点击内部按钮、checkbox、来源链接（这些 handler 自己已 stopPropagation）。
  const onRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 用户在划选文本时不应误触发展开/收起
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && sel.toString().length > 0 && sel.containsNode(e.currentTarget, true)) return;
    onExpand();
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className="group flex gap-3 p-3.5 cursor-pointer select-text"
      onClick={onRowClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onExpand();
        }
      }}
    >
      <input
        type="checkbox"
        className="mt-1 w-4 h-4 accent-violet-500 flex-none cursor-pointer"
        checked={checked}
        onChange={onToggleSelect}
        onClick={stop}
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
            onClick={(e) => {
              stop(e);
              onCopy(item.prompt, `cur:${item.id}`);
            }}
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
            onClick={(e) => {
              stop(e);
              onExpand();
            }}
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
            onClick={(e) => {
              stop(e);
              onTogglePin();
            }}
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
              onClick={stop}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition"
              title={item.pageTitle || item.pageUrl}
            >
              <ExternalLink className="w-3 h-3" /> 来源
            </a>
          )}
          <button
            onClick={(e) => {
              stop(e);
              onDelete();
            }}
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
