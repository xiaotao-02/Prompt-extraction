/**
 * 跨模块的"本地数据变更"事件中心。
 *
 * settings / history / versions 等任何对 chrome.storage 的写入都应调用
 * `notifyBackupSubscribers()`，让上层（fsBackup）能及时把全量数据同步到
 * 用户挑选的数据目录。
 */
const backupListeners = new Set<() => void>();

export function onLocalDataChange(listener: () => void): () => void {
  backupListeners.add(listener);
  return () => backupListeners.delete(listener);
}

export function notifyBackupSubscribers(): void {
  for (const l of backupListeners) {
    try {
      l();
    } catch (err) {
      console.debug('[PromptExtracto] backup listener failed', err);
    }
  }
}
