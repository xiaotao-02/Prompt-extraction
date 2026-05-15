import { Wand2, Loader2 } from 'lucide-react';
import { REFINE_SUGGESTIONS } from '../types';

export function RefineInline({
  value,
  loading,
  error,
  onChange,
  onSubmit,
  onPick,
}: {
  value: string;
  loading: boolean;
  error: string | null;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onPick: (s: string) => void;
}) {
  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-500/30 bg-gradient-to-b from-violet-50/70 to-white dark:from-violet-500/10 dark:to-zinc-900/40 p-3 space-y-2">
      <div className="text-xs font-semibold text-violet-700 dark:text-violet-300 inline-flex items-center gap-1.5">
        <Wand2 className="w-3.5 h-3.5" /> 让 AI 调整这条提示词
      </div>
      <textarea
        value={value}
        disabled={loading}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder="例如：扩写提示词、优化提示词、改得更电影感、翻译成英文…（Ctrl/⌘ + Enter 提交）"
        spellCheck={false}
        className="input min-h-[80px] max-h-[160px] resize-y text-[12px] disabled:opacity-60"
      />
      {error && (
        <div className="text-[11px] px-2 py-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          {error}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {REFINE_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={loading}
            onClick={() => onPick(s)}
            className="text-[11px] px-2 py-0.5 rounded-full border border-violet-200 dark:border-violet-500/30 bg-white/70 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20 disabled:opacity-50 transition"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          onClick={onSubmit}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-md bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white inline-flex items-center gap-1 hover:brightness-110 disabled:opacity-60 transition"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 调整中…
            </>
          ) : (
            <>
              <Wand2 className="w-3.5 h-3.5" /> 让 AI 生成新版本
            </>
          )}
        </button>
      </div>
    </div>
  );
}
