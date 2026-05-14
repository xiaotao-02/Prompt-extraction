import { Copy, Check, Save, RotateCcw, StickyNote } from 'lucide-react';
import type { HistoryItem } from '@/lib/types';

export function EditorTab({
  item,
  draft,
  draftNote,
  onChangeDraft,
  onChangeNote,
  onSaveDraft,
  onResetDraft,
  onCopy,
  copiedKey,
  dirty,
}: {
  item: HistoryItem;
  draft: string;
  draftNote: string;
  onChangeDraft: (v: string) => void;
  onChangeNote: (v: string) => void;
  onSaveDraft: () => void;
  onResetDraft: () => void;
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
  dirty: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="label flex items-center justify-between">
          <span>当前提示词（编辑后会保存为新版本）</span>
          <span className="text-[10px] text-zinc-400 tabular-nums">{draft.length} 字</span>
        </label>
        <textarea
          value={draft}
          onChange={(e) => onChangeDraft(e.target.value)}
          spellCheck={false}
          className="input-prompt min-h-[200px] max-h-[460px] resize-y"
        />
        <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px]">
          <button
            onClick={onSaveDraft}
            disabled={!dirty}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-violet-500 text-white transition"
          >
            <Save className="w-3.5 h-3.5" /> 保存为新版本
          </button>
          <button
            onClick={onResetDraft}
            disabled={!dirty}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 text-zinc-600 dark:text-zinc-300 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" /> 撤销改动
          </button>
          <button
            onClick={() => onCopy(draft, `draft:${item.id}`)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition"
          >
            {copiedKey === `draft:${item.id}` ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500">已复制</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> 复制当前内容
              </>
            )}
          </button>
          {dirty && (
            <span className="text-amber-600 dark:text-amber-300 inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
              有未保存改动
            </span>
          )}
        </div>
      </div>

      <div>
        <label className="label flex items-center gap-1">
          <StickyNote className="w-3 h-3" /> 备注 / 标签（仅本地保存，可用于搜索）
        </label>
        <input
          className="input"
          value={draftNote}
          onChange={(e) => onChangeNote(e.target.value)}
          placeholder="例如：MJ 上次跑的人物参考、SDXL 风格化测试…"
        />
      </div>
    </div>
  );
}
