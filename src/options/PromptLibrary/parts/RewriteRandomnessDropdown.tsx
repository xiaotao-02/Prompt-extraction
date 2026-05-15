import { useEffect, useRef, useState } from 'react';
import type { OneClickRewriteRandomness } from '@/lib/types';
import { REWRITE_RANDOMNESS_LABELS } from '@/lib/oneClickRewrite';

const LEVELS = ['subtle', 'moderate', 'bold'] as const satisfies readonly OneClickRewriteRandomness[];

/**
 * 随机风格强度：自定义下拉，视觉对齐内容脚本面板的 `.strategy-dropdown` / `.sd-*`。
 */
export function RewriteRandomnessDropdown({
  value,
  onChange,
  disabled,
  /** 与右侧「随机风格」主按钮拼成一段控件 */
  segmented,
}: {
  value: OneClickRewriteRandomness;
  onChange: (v: OneClickRewriteRandomness) => void;
  disabled?: boolean;
  segmented?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const rounding = segmented ? 'rounded-l-md rounded-r-none border-r-0' : 'rounded-md';
  const label = REWRITE_RANDOMNESS_LABELS[value];

  return (
    <div
      ref={rootRef}
      className={`relative inline-flex shrink-0 ${segmented ? 'items-stretch min-h-[34px]' : ''}`}
      title="随机风格强度"
    >
      <button
        type="button"
        disabled={disabled}
        aria-label="随机风格强度"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        className={[
          'inline-flex max-w-[92px] min-w-0 min-h-[34px] flex-1 items-center justify-center gap-1',
          'border border-indigo-500/25 bg-indigo-500/[0.06] px-2 py-0.5',
          'text-[11px] font-medium text-indigo-600 outline-none transition',
          'hover:border-indigo-500/40 hover:bg-indigo-500/[0.12]',
          'focus-visible:ring-2 focus-visible:ring-indigo-500/30 focus-visible:ring-offset-0',
          'disabled:pointer-events-none disabled:opacity-40',
          'dark:border-violet-400/35 dark:bg-violet-500/15 dark:text-violet-200',
          'dark:hover:border-violet-400/55 dark:hover:bg-violet-500/25 dark:focus-visible:ring-violet-500/40',
          rounding,
        ].join(' ')}
      >
        <span className="min-w-0 truncate">{label}</span>
        <svg
          className={`h-1.5 w-2.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden
        >
          <path
            d="M1 1l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && !disabled && (
        <ul
          role="listbox"
          aria-label="随机风格强度"
          className={`absolute bottom-full left-0 z-50 mb-1.5 min-w-[132px] list-none rounded-[10px] border border-black/10 bg-white/[0.98] p-1 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-[rgba(30,30,34,0.98)]`}
        >
          {LEVELS.map((id) => {
            const active = id === value;
            return (
              <li key={id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={[
                    'w-full truncate rounded-md px-2.5 py-1.5 text-left text-xs transition',
                    active
                      ? 'bg-indigo-500/[0.12] font-semibold text-indigo-700 dark:bg-violet-500/25 dark:text-violet-100'
                      : 'font-normal text-zinc-800 hover:bg-indigo-500/[0.08] hover:text-indigo-700 dark:text-zinc-300 dark:hover:bg-violet-500/15 dark:hover:text-violet-100',
                  ].join(' ')}
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                >
                  {REWRITE_RANDOMNESS_LABELS[id]}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
