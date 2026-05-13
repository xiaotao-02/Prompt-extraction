import { LayoutGrid, List as ListIcon } from 'lucide-react';
import type { ViewMode } from '../types';

// ============== 视图切换 ==============

export function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex items-center p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/60">
      <button
        onClick={() => onChange('list')}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition ${
          view === 'list'
            ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-300 shadow-sm'
            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-100'
        }`}
        title="列表视图"
      >
        <ListIcon className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onChange('grid')}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition ${
          view === 'grid'
            ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-300 shadow-sm'
            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-100'
        }`}
        title="网格视图"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
