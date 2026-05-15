import { useEffect, useState } from 'react';
import { Check, Copy, Layers, RotateCcw, Trash2 } from 'lucide-react';
import type { HistoryItem, PromptVersion } from '@/lib/types';
import { getVersionOrdinalLabel, type VersionOrdinalKind } from '@/lib/versionLabel';
import { STRATEGY_LABELS } from '@/lib/strategies-meta';
import { SourceTag } from '@/components/SourceTag';
import { removePromptVersion, restorePromptVersion } from '@/lib/storage';

/** ≤6 条全部展示；>6 条默认只展示前 6 条，可展开其余 */
const VERSION_UI_FULL_THRESHOLD = 6;

const ORD_TAG_CLASS: Record<VersionOrdinalKind, string> = {
  current: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  initial: 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300',
  middle: 'bg-zinc-200/70 dark:bg-zinc-700/70 text-zinc-700 dark:text-zinc-200',
};

export function PopupVersionsInline({
  item,
  copiedKey,
  onCopy,
  onAfterMutation,
}: {
  item: HistoryItem;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  onAfterMutation: () => void | Promise<void>;
}) {
  const versions = item.versions ?? [];
  const [expandedRest, setExpandedRest] = useState(false);

  useEffect(() => {
    if (versions.length <= VERSION_UI_FULL_THRESHOLD) {
      setExpandedRest(false);
    }
  }, [versions.length]);

  const needsFold = versions.length > VERSION_UI_FULL_THRESHOLD;
  const visibleVersions =
    !needsFold || expandedRest ? versions : versions.slice(0, VERSION_UI_FULL_THRESHOLD);
  const hiddenCount = needsFold ? versions.length - VERSION_UI_FULL_THRESHOLD : 0;

  const extractedCount = versions.filter((v) => v.source === 'extracted').length;
  const distinctModels = new Set(
    versions.map((v) => (v.meta ? `${v.meta.provider}|${v.meta.model}` : '')).filter(Boolean)
  );

  const handleRestore = async (v: PromptVersion) => {
    const next = await restorePromptVersion(item.id, v.id);
    if (next) await onAfterMutation();
  };

  const handleDelete = async (v: PromptVersion, isCurrent: boolean) => {
    if (versions.length <= 1) return;
    const msg = isCurrent
      ? '确定删除「当前版本」吗？删除后将由下一条版本自动顶替为新的当前版本，此操作不可撤销'
      : '确定删除该版本吗？此操作不可撤销';
    if (!confirm(msg)) return;
    const next = await removePromptVersion(item.id, v.id);
    if (next) await onAfterMutation();
  };

  return (
    <div className="mt-3 rounded-lg border border-zinc-200/80 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-950/40 overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
          历史版本 · {versions.length}
        </span>
      </div>

      {extractedCount > 1 && (
        <div className="px-2.5 py-1.5 text-[10px] text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1.5 border-b border-zinc-200/60 dark:border-zinc-800">
          <Layers className="w-3 h-3 text-violet-500 flex-none" />
          被反推 <b className="text-zinc-700 dark:text-zinc-200">{extractedCount}</b> 次
          {distinctModels.size > 1 && (
            <span>
              · <b className="text-zinc-700 dark:text-zinc-200">{distinctModels.size}</b> 个模型
            </span>
          )}
        </div>
      )}

      <ul className="[scrollbar-width:thin]">
        {visibleVersions.map((v) => {
          const isCurrent = versions[0]?.id === v.id;
          const cid = `ver:${item.id}::${v.id}`;
          const ord = getVersionOrdinalLabel(v.versionNo, isCurrent);
          const preview = v.prompt.replace(/\s+/g, ' ').slice(0, 120);
          const meta = v.meta ?? {
            provider: item.provider,
            model: item.model,
            style: item.style,
            strategy: item.strategy,
          };

          return (
            <li
              key={v.id}
              className="px-2.5 py-2 border-b border-zinc-100/90 dark:border-zinc-800/80 last:border-b-0"
            >
              <div className="flex items-center gap-1.5 text-[10px] mb-1 flex-wrap">
                <span className={`px-1.5 py-px rounded font-semibold ${ORD_TAG_CLASS[ord.kind]}`}>
                  {ord.label}
                </span>
                <SourceTag source={v.source} />
                {meta.strategy && (
                  <span className="px-1.5 py-px rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
                    {STRATEGY_LABELS[meta.strategy] ?? meta.strategy}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-white/80 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 ring-1 ring-zinc-200/60 dark:ring-zinc-700/60">
                  <span className="font-medium">{meta.provider}</span>
                  <span className="text-zinc-300 dark:text-zinc-600">·</span>
                  <span className="font-mono truncate max-w-[100px]">{meta.model}</span>
                </span>
                <span className="text-zinc-400 dark:text-zinc-500">
                  {new Date(v.createdAt).toLocaleString()}
                </span>
              </div>

              <p className="text-[12px] leading-[1.55] text-zinc-600 dark:text-zinc-400 line-clamp-2 break-words">
                {preview}
                {v.prompt.length > 120 ? '…' : ''}
              </p>

              <div className="mt-1.5 flex items-center gap-1 flex-wrap text-[10px]">
                <button
                  type="button"
                  onClick={() => onCopy(v.prompt, cid)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-zinc-200/70 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition"
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
                    type="button"
                    onClick={() => void handleRestore(v)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20 transition"
                  >
                    <RotateCcw className="w-3 h-3" /> 恢复此版本
                  </button>
                )}
                {versions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(v, isCurrent)}
                    title={isCurrent ? '删除当前版本（下一条版本将顶替为当前）' : '删除此版本'}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition ml-auto"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {needsFold && (
        <div className="border-t border-zinc-200/70 dark:border-zinc-800 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setExpandedRest((x) => !x)}
            className="w-full text-center text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 rounded-md py-1 transition"
          >
            {expandedRest ? '收起' : `展开其余 ${hiddenCount} 条`}
          </button>
        </div>
      )}
    </div>
  );
}
