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
  listHistoryGlobalDescPage,
  listRecentHistory,
  scanHistoryLibraryStats,
  historyCount,
  LIBRARY_REV_KEY,
  exportAllHistoryPublic,
  HISTORY_KEY,
} from './history';
export {
  appendPromptVersion,
  restorePromptVersion,
  removePromptVersion,
} from './versions';
export {
  getFolders,
  createFolder,
  renameFolder,
  patchFolder,
  removeFolder,
  moveHistoryItemsToFolder,
  type CreateFolderInput,
} from './folders';
export { onLocalDataChange } from './events';
export { buildBackup, restoreBackup, type BackupPayload } from './backup';
export {
  MAX_USER_STRATEGY_PRESETS,
  MAX_PRESET_NAME_LEN,
  DEFAULT_CUSTOM_COMPONENTS,
  getUserStrategyPresets,
  setUserStrategyPresets,
  mergeUserStrategyPresets,
  buildUserStrategyPresetFromSettings,
  applyUserStrategyPresetToSettings,
  briefUserPresetFingerprint,
  isSettingsMatchingUserPreset,
  addUserStrategyPreset,
  removeUserStrategyPreset,
  updateUserStrategyPresetName,
} from './userStrategyPresets';
export { USER_STRATEGY_PRESETS_KEY } from './keys';
