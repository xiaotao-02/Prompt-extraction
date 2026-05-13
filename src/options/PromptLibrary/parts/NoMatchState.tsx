import { Search, X } from 'lucide-react';

export function NoMatchState({ onClear }: { onClear: () => void }) {
  return (
    <div className="card text-center py-12 space-y-3">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
        <Search className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm text-zinc-700 dark:text-zinc-200 mb-1">没有匹配的记录</p>
        <p className="text-xs text-zinc-500">试试换个关键词，或者清除当前筛选</p>
      </div>
      <button
        onClick={onClear}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-500/40 hover:text-violet-600 dark:hover:text-violet-300 transition"
      >
        <X className="w-3.5 h-3.5" /> 清除筛选
      </button>
    </div>
  );
}
