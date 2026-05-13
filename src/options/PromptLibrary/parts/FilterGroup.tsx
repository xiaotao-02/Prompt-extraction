import * as React from 'react';

// ============== 筛选 Chip 组 ==============

export function FilterGroup({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon?: React.ReactNode;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-zinc-400 dark:text-zinc-500 inline-flex items-center gap-1">
        {icon}
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                active
                  ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/40'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-violet-300 dark:hover:border-violet-500/30'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
