export type SortKey = 'updated' | 'created' | 'versions';
export type ViewMode = 'list' | 'grid';
export type ExpandedTab = 'editor' | 'versions' | 'refine' | 'meta';

export const REFINE_SUGGESTIONS = [
  '翻译成英文',
  '翻译成中文',
  '改得更电影感',
  '加上 8k, masterpiece, best quality',
  '删掉色调描述',
  '改成 SD tag 格式',
  '精简成不超过 30 字',
];

export const VIEW_STORAGE_KEY = 'prompt_library_view_v1';

/**
 * 侧边栏「项目 / 文件夹」当前选中节点的持久化 key。
 *
 * 取值：
 * - `null` / 缺省 / `'all'` → 显示全部记录
 * - `'unsorted'` → 仅显示「未分类」（folderId 为空）的记录
 * - `'pinned'` → 仅显示置顶记录（虚拟视图，不属于树本身）
 * - 任意 folder.id → 显示该文件夹（含子文件夹）下的记录
 */
export const TREE_SELECTED_KEY = 'prompt_library_tree_selected_v1';

/** 侧边栏树展开状态（折叠/展开）持久化 key，存的是 string[] 形式的 id 数组 JSON */
export const TREE_EXPANDED_KEY = 'prompt_library_tree_expanded_v1';

/** 侧边栏宽度（像素）持久化 key */
export const TREE_WIDTH_KEY = 'prompt_library_tree_width_v1';

/** 内置「虚拟节点」id（不在 folders 数据中）。 */
export const SYSTEM_NODE = {
  ALL: 'all',
  UNSORTED: 'unsorted',
  PINNED: 'pinned',
} as const;

export type SystemNodeId = (typeof SYSTEM_NODE)[keyof typeof SYSTEM_NODE];

/** 顶层「项目」可选的颜色 token。仅用于侧边栏装饰，不影响数据归属。 */
export const PROJECT_COLORS: { id: string; label: string; dot: string; ring: string }[] = [
  { id: 'violet', label: '紫', dot: 'bg-violet-500', ring: 'ring-violet-300/60' },
  { id: 'indigo', label: '靛', dot: 'bg-indigo-500', ring: 'ring-indigo-300/60' },
  { id: 'sky', label: '蓝', dot: 'bg-sky-500', ring: 'ring-sky-300/60' },
  { id: 'emerald', label: '绿', dot: 'bg-emerald-500', ring: 'ring-emerald-300/60' },
  { id: 'amber', label: '橙', dot: 'bg-amber-500', ring: 'ring-amber-300/60' },
  { id: 'rose', label: '红', dot: 'bg-rose-500', ring: 'ring-rose-300/60' },
  { id: 'zinc', label: '灰', dot: 'bg-zinc-400', ring: 'ring-zinc-300/60' },
];

export function getProjectColor(id?: string) {
  return PROJECT_COLORS.find((c) => c.id === id) || PROJECT_COLORS[0];
}
