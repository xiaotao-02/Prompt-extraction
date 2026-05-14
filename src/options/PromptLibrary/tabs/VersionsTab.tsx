import { Check, Copy, Layers, RotateCcw, Trash2, X } from 'lucide-react';
import type { HistoryItem, PromptVersion } from '@/lib/types';
import { getVersionOrdinalLabel, type VersionOrdinalKind } from '@/lib/versionLabel';
import { STRATEGY_LABELS } from '@/lib/strategies-meta';
import { SourceTag } from '../SourceTag';

const ORD_TAG_CLASS: Record<VersionOrdinalKind, string> = {
  current: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  initial: 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300',
  middle: 'bg-zinc-200/70 dark:bg-zinc-700/70 text-zinc-700 dark:text-zinc-200',
};

/**
 * 侧边栏版本列表 —— 与 content panel 一致的交互：
 * 点击某一行把该版本 prompt 加载到编辑器，高亮选中行；
 * 行内提供复制 / 恢复 / 删除操作。
 */
export function VersionsSidebar({
  item,
  editorContent,
  selectedVersionId,
  onCopy,
  copiedKey,
  onSelectVersion,
  onRestoreVersion,
  onDeleteVersion,
  onClose,
}: {
  item: HistoryItem;
  editorContent: string;
  selectedVersionId: string | null;
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
  onSelectVersion: (v: PromptVersion) => void;
  onRestoreVersion: (v: PromptVersion) => void;
  onDeleteVersion: (v: PromptVersion) => void;
  onClose: () => void;
}) {
  const extractedCount = item.versions.filter((v) => v.source === 'extracted').length;
  const distinctModels = new Set(
    item.versions
      .map((v) => (v.meta ? `${v.meta.provider}|${v.meta.model}` : ''))
      .filter(Boolean)
  );

  return (
    <aside className="flex flex-col h-full bg-white dark:bg-zinc-900 shadow-xl shadow-black/10 dark:shadow-black/30">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800 flex-none">
        <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
          历史版本 · {item.versions.length}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition"
          title="收起"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 统计提示 */}
      {extractedCount > 1 && (
        <div className="px-3 py-1.5 text-[10px] text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1.5 border-b border-zinc-100 dark:border-zinc-800 flex-none">
          <Layers className="w-3 h-3 text-violet-500 flex-none" />
          被反推 <b className="text-zinc-700 dark:text-zinc-200">{extractedCount}</b> 次
          {distinctModels.size > 1 && (
            <span>
              · <b className="text-zinc-700 dark:text-zinc-200">{distinctModels.size}</b> 个模型
            </span>
          )}
        </div>
      )}

      {/* 版本列表 */}
      <ul className="flex-1 min-h-0 overflow-y-auto">
        {item.versions.map((v, i) => {
          const isCurrent = i === 0;
          const cid = `ver:${item.id}::${v.id}`;
          const ord = getVersionOrdinalLabel(item.versions.length, i);
          const preview = v.prompt.replace(/\s+/g, ' ').slice(0, 120);
          const isSelected =
            selectedVersionId != null
              ? v.id === selectedVersionId
              : v.prompt === editorContent;

          return (
            <li
              key={v.id}
              onClick={() => onSelectVersion(v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectVersion(v);
                }
              }}
              title="点击切换到此版本"
              className={`px-3 py-2 border-b border-zinc-50 dark:border-zinc-800/60 cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-violet-50 dark:bg-violet-500/15 hover:bg-violet-100/80 dark:hover:bg-violet-500/20'
                  : isCurrent
                    ? 'bg-emerald-50/60 dark:bg-emerald-500/8 hover:bg-violet-50/60 dark:hover:bg-violet-500/10'
                    : 'hover:bg-violet-50/60 dark:hover:bg-violet-500/10'
              }`}
            >
              {/* 版本标签行 */}
              <div className="flex items-center gap-1.5 text-[10px] mb-1 flex-wrap">
                <span className={`px-1.5 py-px rounded font-semibold ${ORD_TAG_CLASS[ord.kind]}`}>
                  {ord.label}
                </span>
                <SourceTag source={v.source} />
                {v.meta?.strategy && (
                  <span className="px-1.5 py-px rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
                    {STRATEGY_LABELS[v.meta.strategy] ?? v.meta.strategy}
                  </span>
                )}
                <span className="text-zinc-400 dark:text-zinc-500">
                  {new Date(v.createdAt).toLocaleString()}
                </span>
              </div>

              {/* 预览文本 */}
              <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400 line-clamp-2 break-words">
                {preview}{v.prompt.length > 120 ? '…' : ''}
              </p>

              {/* 行内操作 */}
              <div className="mt-1.5 flex items-center gap-1 text-[10px]">
                <button
                  onClick={(e) => { e.stopPropagation(); onCopy(v.prompt, cid); }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition"
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
                    onClick={(e) => { e.stopPropagation(); onRestoreVersion(v); }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20 transition"
                  >
                    <RotateCcw className="w-3 h-3" /> 恢复此版本
                  </button>
                )}
                {item.versions.length > 1 && !isCurrent && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteVersion(v); }}
                    title="删除此版本"
                    className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
