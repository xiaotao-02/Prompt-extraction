import { Check, Copy, Layers, RotateCcw, Trash2, X } from 'lucide-react';
import type { HistoryItem, PromptVersion } from '@/lib/types';
import { refineStreamSentinelForJob } from '@/lib/refineStreamVersion';
import type { LibraryRefineJob } from '../types';
import { getVersionOrdinalLabel, type VersionOrdinalKind } from '@/lib/versionLabel';
import { STRATEGY_LABELS } from '@/lib/strategies-meta';
import { SourceTag } from '../SourceTag';

/** 深色侧栏内的序号标签（避免浅色块抢眼） */
const ORD_TAG_CLASS: Record<VersionOrdinalKind, string> = {
  current: 'bg-emerald-500/20 text-emerald-300',
  initial: 'bg-sky-500/20 text-sky-300',
  middle: 'bg-zinc-700 text-zinc-200',
};

/** 深色底滚动条（Tailwind v4.3 scrollbar-*：scrollbar-color / scrollbar-width，Windows Chrome 下比 ::-webkit-scrollbar 可靠） */
const VERSIONS_LIST_SCROLLBAR =
  'scrollbar-thin scrollbar-track-zinc-800/80 scrollbar-thumb-zinc-600/80 hover:scrollbar-thumb-violet-500/35';

/**
 * 侧边栏版本列表 —— 与 content panel 一致的交互：
 * 点击某一行把该版本 prompt 加载到编辑器，高亮选中行；
 * 行内提供复制 / 恢复 / 删除操作。
 */
export function VersionsSidebar({
  item,
  editorContent,
  selectedVersionId,
  refineJobs,
  scrollList,
  onSelectGeneratingJob,
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
  refineJobs?: LibraryRefineJob[];
  /** true：条目较多时在列表区域内滚动并显示自定义滚动条 */
  scrollList: boolean;
  onSelectGeneratingJob?: (jobId: string) => void;
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
  onSelectVersion: (v: PromptVersion) => void;
  onRestoreVersion: (v: PromptVersion) => void;
  onDeleteVersion: (v: PromptVersion) => void;
  onClose: () => void;
}) {
  const jobs = refineJobs ?? [];
  const anyRefining = jobs.length > 0;
  const listCount = item.versions.length + jobs.length;
  const extractedCount = item.versions.filter((v) => v.source === 'extracted').length;
  const distinctModels = new Set(
    item.versions
      .map((v) => (v.meta ? `${v.meta.provider}|${v.meta.model}` : ''))
      .filter(Boolean)
  );

  return (
    <aside
      className={`scheme-dark flex flex-col bg-zinc-950 ${
        scrollList ? 'h-full min-h-0' : 'h-auto'
      }`}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 flex-none">
        <span className="text-[11px] font-semibold text-zinc-300">
          历史版本 · {listCount}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
          title="收起"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 统计提示 */}
      {extractedCount > 1 && (
        <div className="px-3 py-1.5 text-[10px] text-zinc-400 inline-flex items-center gap-1.5 border-b border-zinc-800 flex-none">
          <Layers className="w-3 h-3 text-violet-400 flex-none" />
          被反推 <b className="text-zinc-200">{extractedCount}</b> 次
          {distinctModels.size > 1 && (
            <span>
              · <b className="text-zinc-200">{distinctModels.size}</b> 个模型
            </span>
          )}
        </div>
      )}

      {/* 版本列表 */}
      <ul
        className={
          scrollList
            ? `flex-1 min-h-0 overflow-y-auto pr-0.5 ${VERSIONS_LIST_SCROLLBAR}`
            : 'overflow-y-visible flex-none'
        }
      >
        {jobs.map((job) => {
          const rowId = refineStreamSentinelForJob(job.jobId);
          const label = job.kind === 'rewrite' ? '随机风格' : 'AI 调整';
          const hint = job.instruction.replace(/\s+/g, ' ').trim().slice(0, 96);
          return (
            <li
              key={rowId}
              onClick={() => onSelectGeneratingJob?.(job.jobId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectGeneratingJob?.(job.jobId);
                }
              }}
              title="点击查看该条生成中的提示词"
              className={`px-3 py-2 border-b border-zinc-800/60 cursor-pointer transition-colors ${
                selectedVersionId === rowId
                  ? 'bg-violet-500/15 hover:bg-violet-500/20'
                  : 'hover:bg-violet-500/10'
              }`}
            >
              <div className="flex items-center gap-1.5 text-[10px] mb-1 flex-wrap">
                <span className={`px-1.5 py-px rounded font-semibold ${ORD_TAG_CLASS.middle}`}>
                  生成中
                </span>
                <SourceTag source="refined" variant="onDark" />
                <span className="text-zinc-500">{label}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400 line-clamp-2 break-words italic">
                {hint || '正在生成新版本…'}
              </p>
            </li>
          );
        })}
        {item.versions.map((v, i) => {
          const isCurrent = i === 0;
          const cid = `ver:${item.id}::${v.id}`;
          const ord = getVersionOrdinalLabel(v.versionNo, isCurrent);
          const preview = v.prompt.replace(/\s+/g, ' ').slice(0, 120);
          const meta = v.meta ?? {
            provider: item.provider,
            model: item.model,
            style: item.style,
            strategy: item.strategy,
          };
          const isSelected = anyRefining
            ? v.id === selectedVersionId
            : selectedVersionId != null
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
              className={`px-3 py-2 border-b border-zinc-800/60 cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-violet-500/15 hover:bg-violet-500/20'
                  : isCurrent
                    ? 'bg-emerald-500/8 hover:bg-violet-500/10'
                    : 'hover:bg-violet-500/10'
              }`}
            >
              {/* 版本标签行 */}
              <div className="flex items-center gap-1.5 text-[10px] mb-1 flex-wrap">
                <span className={`px-1.5 py-px rounded font-semibold ${ORD_TAG_CLASS[ord.kind]}`}>
                  {ord.label}
                </span>
                <SourceTag source={v.source} variant="onDark" />
                {meta.strategy && (
                  <span className="px-1.5 py-px rounded bg-amber-500/20 text-amber-300">
                    {STRATEGY_LABELS[meta.strategy] ?? meta.strategy}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-zinc-800/90 text-zinc-300 ring-1 ring-zinc-600/60">
                  <span className="font-medium">{meta.provider}</span>
                  <span className="text-zinc-600">·</span>
                  <span className="font-mono truncate max-w-[110px]">{meta.model}</span>
                </span>
                <span className="text-zinc-500">
                  {new Date(v.createdAt).toLocaleString()}
                </span>
              </div>

              {/* 预览文本 */}
              <p className="text-[13px] leading-[1.6] text-zinc-400 line-clamp-2 break-words">
                {preview}{v.prompt.length > 120 ? '…' : ''}
              </p>

              {/* 行内操作 */}
              <div className="mt-1.5 flex items-center gap-1 text-[10px]">
                <button
                  onClick={(e) => { e.stopPropagation(); onCopy(v.prompt, cid); }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-zinc-800 text-zinc-400 transition"
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
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-violet-300 hover:bg-violet-500/20 transition"
                  >
                    <RotateCcw className="w-3 h-3" /> 恢复此版本
                  </button>
                )}
                {item.versions.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteVersion(v); }}
                    title={isCurrent ? '删除当前版本（下一条版本将顶替为当前）' : '删除此版本'}
                    className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
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
