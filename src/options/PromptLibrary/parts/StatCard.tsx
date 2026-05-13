import * as React from 'react';

// ============== 顶部统计卡 ==============

const STAT_TONE: Record<
  'violet' | 'indigo' | 'amber' | 'fuchsia',
  { iconBg: string; iconText: string }
> = {
  violet: {
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
    iconText: 'text-violet-600 dark:text-violet-300',
  },
  indigo: {
    iconBg: 'bg-indigo-100 dark:bg-indigo-500/15',
    iconText: 'text-indigo-600 dark:text-indigo-300',
  },
  amber: {
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    iconText: 'text-amber-600 dark:text-amber-300',
  },
  fuchsia: {
    iconBg: 'bg-fuchsia-100 dark:bg-fuchsia-500/15',
    iconText: 'text-fuchsia-600 dark:text-fuchsia-300',
  },
};

export function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: keyof typeof STAT_TONE;
}) {
  const t = STAT_TONE[tone];
  return (
    <div className="card !p-4 flex items-center gap-3 hover:-translate-y-px transition-transform">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${t.iconBg} ${t.iconText}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{label}</div>
        <div className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {value}
        </div>
      </div>
    </div>
  );
}
