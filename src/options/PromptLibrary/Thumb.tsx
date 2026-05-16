import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { HistoryItem } from '@/lib/types';

const STACK_TRANSFORMS_2 = [
  'translate(-50%, -50%) translate(-6px, 8px) rotate(-10deg) scale(0.85)',
  'translate(-50%, -50%) rotate(-2deg) scale(0.95)',
] as const;
const STACK_TRANSFORMS_3 = [
  'translate(-50%, -50%) translate(-6px, 8px) rotate(-10deg) scale(0.85)',
  'translate(-50%, -50%) translate(8px, -4px) rotate(8deg) scale(0.9)',
  'translate(-50%, -50%) rotate(-2deg) scale(0.95)',
] as const;

function StackedThumb({
  urls,
  totalCount,
  size,
  onError,
}: {
  urls: string[];
  totalCount: number;
  size: 'md' | 'lg' | 'full';
  onError: () => void;
}) {
  const transforms = urls.length >= 3 ? STACK_TRANSFORMS_3 : STACK_TRANSFORMS_2;
  const extra = totalCount > 3 ? totalCount - 3 : 0;

  const outerClass =
    size === 'full'
      ? 'absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none'
      : size === 'lg'
        ? 'relative w-28 h-28 flex-none overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800'
        : 'relative h-24 w-24 flex-none overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800';

  const stackAreaClass =
    size === 'full' ? 'relative h-[75%] max-h-[85%] w-[72%] max-w-[280px]' : 'relative h-full w-full';

  return (
    <div className={outerClass}>
      <div className={stackAreaClass}>
        {urls.map((src, i) => (
          <div
            key={`${src}-${i}`}
            className="absolute left-1/2 top-1/2 h-[68%] w-[68%] overflow-hidden rounded-lg bg-zinc-200 shadow-md ring-1 ring-black/10 dark:bg-zinc-700 dark:ring-white/10"
            style={{
              transform: transforms[i] ?? transforms[transforms.length - 1],
              zIndex: i,
            }}
          >
            <img src={src} alt="" className="h-full w-full object-cover" onError={onError} />
          </div>
        ))}
        {extra > 0 && (
          <span className="pointer-events-none absolute bottom-1 right-1 z-30 rounded bg-black/65 px-1 py-0.5 text-[9px] font-medium text-white tabular-nums shadow-sm">
            +{extra}
          </span>
        )}
      </div>
    </div>
  );
}

export function Thumb({ item, size }: { item: HistoryItem; size: 'md' | 'lg' | 'full' }) {
  const [failed, setFailed] = useState(false);

  const rawUrls = item.imageUrls?.filter(Boolean) ?? [];
  const stackUrls = rawUrls.slice(0, 3);
  const multi = rawUrls.length >= 2 && stackUrls.length >= 2;

  const cls =
    size === 'full'
      ? 'absolute inset-0 h-full w-full object-cover'
      : size === 'lg'
        ? 'h-28 w-28 rounded-lg object-cover'
        : 'h-24 w-24 rounded-lg object-cover';
  const placeholderCls =
    size === 'full'
      ? 'absolute inset-0 flex items-center justify-center text-zinc-400'
      : size === 'lg'
        ? 'flex h-28 w-28 flex-none items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-zinc-800'
        : 'flex h-24 w-24 flex-none items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-zinc-800';

  if (multi) {
    if (failed) {
      return (
        <div className={placeholderCls}>
          <ImageOff className="h-5 w-5" />
        </div>
      );
    }
    return (
      <StackedThumb
        urls={stackUrls}
        totalCount={rawUrls.length}
        size={size}
        onError={() => setFailed(true)}
      />
    );
  }

  if (failed || !item.thumbnail) {
    return (
      <div className={placeholderCls}>
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img
      src={item.thumbnail}
      alt=""
      onError={() => setFailed(true)}
      className={`${cls} ${size === 'full' ? '' : 'flex-none bg-zinc-100 dark:bg-zinc-800'}`}
    />
  );
}
