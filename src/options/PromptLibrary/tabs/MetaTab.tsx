import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import type { HistoryItem } from '@/lib/types';
import { STRATEGY_LABELS } from '@/lib/strategies-meta';

export function MetaTab({ item }: { item: HistoryItem }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-[12px] space-y-1.5">
      <MetaRow label="ID" value={<span className="font-mono break-all">{item.id}</span>} />
      <MetaRow label="供应商" value={item.provider} />
      <MetaRow label="模型" value={<span className="font-mono">{item.model}</span>} />
      <MetaRow label="风格" value={item.style} />
      <MetaRow
        label="策略"
        value={
          item.strategy
            ? STRATEGY_LABELS[item.strategy] ?? item.strategy
            : <span className="text-zinc-400 italic">未知策略</span>
        }
      />
      <MetaRow label="创建时间" value={new Date(item.createdAt).toLocaleString()} />
      {item.updatedAt && item.updatedAt !== item.createdAt && (
        <MetaRow label="更新时间" value={new Date(item.updatedAt).toLocaleString()} />
      )}
      {item.pageUrl && (
        <MetaRow
          label="来源"
          value={
            <a
              href={item.pageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-violet-500 hover:underline break-all inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3 flex-none" />
              {item.pageTitle || item.pageUrl}
            </a>
          }
        />
      )}
      {(item.imageUrls?.length ?? 0) > 1 && (
        <MetaRow label="参考图" value={`${item.imageUrls!.length} 张（多图合并反推）`} />
      )}
      {item.imageUrl && (
        <MetaRow
          label={(item.imageUrls?.length ?? 0) > 1 ? '主图缩略' : '图片地址'}
          value={<span className="font-mono text-[11px] break-all text-zinc-500">{item.imageUrl}</span>}
        />
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <div className="text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className="text-zinc-700 dark:text-zinc-200 min-w-0">{value}</div>
    </div>
  );
}
