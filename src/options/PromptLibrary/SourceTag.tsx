import type { PromptVersionSource } from '@/lib/types';

export function SourceTag({ source }: { source: PromptVersionSource }) {
  const map: Record<PromptVersionSource, { label: string; className: string }> = {
    extracted: {
      label: '初始',
      className: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    },
    edited: {
      label: '手动编辑',
      className: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
    },
    restored: {
      label: '恢复',
      className: 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300',
    },
    refined: {
      label: 'AI 调整',
      className: 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300',
    },
  };
  const cfg = map[source];
  return <span className={`px-1.5 py-px rounded font-medium ${cfg.className}`}>{cfg.label}</span>;
}
