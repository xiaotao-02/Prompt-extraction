import { History as HistoryIcon } from 'lucide-react';

// ============== 状态卡 ==============

export function EmptyState() {
  return (
    <div className="card text-center py-14">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-500/20 dark:to-violet-500/20 flex items-center justify-center mb-4">
        <HistoryIcon className="w-7 h-7 text-violet-500" />
      </div>
      <h3 className="text-sm font-semibold mb-1">提示词库还是空的</h3>
      <p className="text-xs text-zinc-500 leading-relaxed">
        在任意网页上 <b>右键图片</b> → 选择「🎨 提取图片提示词」，
        <br />
        提取出的结果会自动出现在这里，方便你统一管理、编辑和导出。
      </p>
    </div>
  );
}
