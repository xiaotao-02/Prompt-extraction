/**
 * @/lib/storage 的对外门面（barrel）。
 *
 * 历史上整个 storage 实现都堆在 src/lib/storage.ts。重构后按职责拆到子模块。
 * 业务代码继续 `import { getSettings, addHistory, ... } from '@/lib/storage'` 即可。
 */
export { getSettings, saveSettings } from './settings';
export { getUpdateSettings, patchUpdateSettings, saveUpdateResult } from './updates';
export {
  getHistory,
  addHistory,
  clearHistory,
  removeHistory,
  removeHistoryItems,
  patchHistoryItem,
  getHistoryItem,
} from './history';
export {
  appendPromptVersion,
  restorePromptVersion,
  removePromptVersion,
} from './versions';
export { onLocalDataChange } from './events';
export { buildBackup, restoreBackup, type BackupPayload } from './backup';
