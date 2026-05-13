import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { HistoryItem } from '@/lib/types';

export function Thumb({ item, size }: { item: HistoryItem; size: 'md' | 'lg' | 'full' }) {
  const [failed, setFailed] = useState(false);
  const cls =
    size === 'full'
      ? 'absolute inset-0 w-full h-full object-cover'
      : size === 'lg'
        ? 'w-28 h-28 rounded-lg object-cover'
        : 'w-24 h-24 rounded-lg object-cover';
  const placeholderCls =
    size === 'full'
      ? 'absolute inset-0 flex items-center justify-center text-zinc-400'
      : size === 'lg'
        ? 'w-28 h-28 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-none text-zinc-400'
        : 'w-24 h-24 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-none text-zinc-400';

  if (failed || !item.thumbnail) {
    return (
      <div className={placeholderCls}>
        <ImageOff className="w-5 h-5" />
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
