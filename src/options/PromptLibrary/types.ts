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
