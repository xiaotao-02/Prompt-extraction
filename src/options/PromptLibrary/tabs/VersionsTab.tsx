import { Check, Copy, Layers, RotateCcw, Trash2 } from 'lucide-react';
import type { HistoryItem, PromptVersion } from '@/lib/types';
import { getVersionOrdinalLabel, type VersionOrdinalKind } from '@/lib/versionLabel';
import { SourceTag } from '../SourceTag';

const ORD_TAG_CLASS: Record<VersionOrdinalKind, string> = {
  current: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  initial: 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300',
  middle: 'bg-zinc-200/70 dark:bg-zinc-700/70 text-zinc-700 dark:text-zinc-200',
};

export function VersionsTab({
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
  // 统计有 meta 的版本里出现过几个不同的 provider/model 组合，
  // 用于在头部给出"同一张图被 N 个模型反推过"的提示，告诉用户为什么这条记录的版本会比较多。
  const extractedCount = item.versions.filter((v) => v.source === 'extracted').length;
  const distinctModels = new Set(
    item.versions
      .map((v) => (v.meta ? `${v.meta.provider}|${v.meta.model}` : ''))
      .filter(Boolean)
  );
  return (
    <div className="space-y-2">
      {extractedCount > 1 && (
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1.5">
          <Layers className="w-3 h-3 text-violet-500" />
          这张图共被反推过 <b className="text-zinc-700 dark:text-zinc-200">{extractedCount}</b> 次
          {distinctModels.size > 1 && (
            <span>
              · 涵盖 <b className="text-zinc-700 dark:text-zinc-200">{distinctModels.size}</b> 个模型
            </span>
          )}
        </div>
      )}
      <ul className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
        {item.versions.map((v, i) => {
          const isCurrent = i === 0;
          const cid = `ver:${item.id}::${v.id}`;
          const ord = getVersionOrdinalLabel(item.versions.length, i);
          return (
            <li
              key={v.id}
              className={`p-3 ${isCurrent ? 'bg-emerald-50/60 dark:bg-emerald-500/10' : ''}`}
            >
              <div className="flex items-center gap-2 text-[11px] mb-1.5 flex-wrap">
                <span
                  className={`px-1.5 py-px rounded font-medium ${ORD_TAG_CLASS[ord.kind]}`}
                >
                  {ord.label}
                </span>
                <SourceTag source={v.source} />
                <span className="text-zinc-500">{new Date(v.createdAt).toLocaleString()}</span>
                {v.meta && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                    <span className="font-medium">{v.meta.provider}</span>
                    <span className="text-zinc-300 dark:text-zinc-600">·</span>
                    <span className="font-mono truncate max-w-[160px]">{v.meta.model}</span>
                    <span className="text-zinc-300 dark:text-zinc-600">·</span>
                    <span>{v.meta.style}</span>
                  </span>
                )}
                {v.note && (
                  <span className="text-zinc-500 italic truncate max-w-[260px]">· {v.note}</span>
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
                {item.versions.length > 1 && (
                  <button
                    onClick={() => onDeleteVersion(v)}
                    title={isCurrent ? '删除当前版本（下一版本将顶替为当前）' : '删除此版本'}
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
    </div>
  );
}
