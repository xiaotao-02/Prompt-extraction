/**
 * File System Access API 封装：把全量数据（settings + history）双写到用户挑选的本地目录。
 *
 * 为什么要这样设计：
 * - Chrome 出于隐私安全，扩展被移除时 chrome.storage.local / sync / IndexedDB 全部会被清空。
 * - 而 File System Access API 允许扩展在**用户激活手势 + 用户挑选**的目录里读写文件；
 *   被卸载的"扩展"和被用户挑选的"目录"是两个独立的实体，**目录里的 JSON 不会随扩展消失**。
 * - 用户重装扩展后，只需要在设置页再选一次同一个目录，就能从目录里的 JSON 全量还原。
 *
 * 实现要点：
 * - directoryHandle 存在 IndexedDB（{@link saveDirectoryHandle}）。
 * - 浏览器重启后 handle 仍在，但权限会失效；调用 {@link ensureDirectoryPermission} 在有
 *   用户手势的上下文里重新请求 'readwrite' 权限。
 * - 写入文件采用「先 createWritable → write → close」三步，是 API 的标准写法。
 * - 文件名固定为 `prompt-extracto-data.json`，用户能在文件夹里直接看到内容。
 */
import { clearDirectoryHandle, loadDirectoryHandle, saveDirectoryHandle } from './idb';
import { buildBackup, restoreBackup, type BackupPayload } from './storage';

export const BACKUP_FILE_NAME = 'prompt-extracto-data.json';

/**
 * 判断当前浏览器是否支持 File System Access API。
 *
 * Chrome / Edge 86+ 都支持；旧浏览器 / Firefox 不支持。
 * 不支持时 UI 应该回退到"手动导出 / 导入 JSON"模式。
 */
export function supportsFileSystemAccess(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

interface DirectoryHandleWithPermission extends FileSystemDirectoryHandle {
  queryPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

/**
 * 确认我们对 directory handle 仍有 readwrite 权限。
 *
 * @param prompt true 时如果权限没了会**主动弹一次系统授权框**（必须在用户手势上下文）。
 *               false 时只做静默检查（用于启动时探测，不要骚扰用户）。
 */
export async function ensureDirectoryPermission(
  handle: FileSystemDirectoryHandle,
  prompt: boolean
): Promise<boolean> {
  const h = handle as DirectoryHandleWithPermission;
  try {
    if (h.queryPermission) {
      const status = await h.queryPermission({ mode: 'readwrite' });
      if (status === 'granted') return true;
      if (!prompt) return false;
    }
    if (prompt && h.requestPermission) {
      const status = await h.requestPermission({ mode: 'readwrite' });
      return status === 'granted';
    }
    return false;
  } catch (err) {
    console.warn('[PromptExtracto] permission check failed', err);
    return false;
  }
}

export interface DataDirectoryState {
  /** 是否已经设置过数据目录（handle 存在 IndexedDB 里） */
  configured: boolean;
  /** 数据目录的可读名称（不含路径，浏览器出于安全不给完整路径） */
  name: string | null;
  /** 当前是否有 readwrite 权限（不弹窗，仅静默检查） */
  permissionGranted: boolean;
  /** 浏览器是否支持 File System Access API */
  supported: boolean;
}

export async function readDirectoryState(): Promise<DataDirectoryState> {
  const supported = supportsFileSystemAccess();
  if (!supported) {
    return { configured: false, name: null, permissionGranted: false, supported };
  }
  const handle = await loadDirectoryHandle();
  if (!handle) {
    return { configured: false, name: null, permissionGranted: false, supported };
  }
  const granted = await ensureDirectoryPermission(handle, false);
  return {
    configured: true,
    name: handle.name,
    permissionGranted: granted,
    supported,
  };
}

/**
 * 弹出系统对话框让用户挑选一个目录作为数据目录。
 *
 * 用户挑好后：
 * - 把 handle 存到 IndexedDB（后续启动复用）
 * - 检查目录里是否已存在 {@link BACKUP_FILE_NAME}：如果存在，把它的内容读出来返回，
 *   外层 UI 可以提示「检测到旧备份，是否恢复？」
 *
 * @returns 选中目录的 handle；如果用户取消则返回 null
 */
export async function pickDataDirectory(): Promise<{
  handle: FileSystemDirectoryHandle;
  existingBackup: BackupPayload | null;
} | null> {
  if (!supportsFileSystemAccess()) {
    throw new Error('当前浏览器不支持「数据目录」功能，请使用 Chrome / Edge 86+');
  }
  const picker = (
    globalThis as unknown as {
      showDirectoryPicker: (opts?: {
        mode?: 'read' | 'readwrite';
        id?: string;
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await picker({ mode: 'readwrite', id: 'prompt-extracto-data' });
  } catch (err) {
    // 用户取消是 AbortError，向上抛会很吵；统一返回 null
    if (err instanceof Error && err.name === 'AbortError') return null;
    throw err;
  }

  // 确认权限（picker 之后通常已 granted，但保险起见再检查一次）
  const ok = await ensureDirectoryPermission(handle, true);
  if (!ok) {
    throw new Error('未获得读写权限');
  }

  await saveDirectoryHandle(handle);

  // 检查目录里是否已有备份文件
  let existing: BackupPayload | null = null;
  try {
    const fileHandle = await handle.getFileHandle(BACKUP_FILE_NAME, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text) as BackupPayload;
    if (parsed && parsed.version === 1) {
      existing = parsed;
    }
  } catch (err) {
    if (err instanceof Error && err.name !== 'NotFoundError') {
      console.warn('[PromptExtracto] read existing backup failed', err);
    }
  }

  return { handle, existingBackup: existing };
}

/** 解除数据目录关联（不会删除磁盘文件，只是让插件忘掉 handle） */
export async function disconnectDataDirectory(): Promise<void> {
  await clearDirectoryHandle();
}

/**
 * 判断一份 backup payload 是否「显著比现有备份贫瘠」。
 *
 * 返回 true 表示：即将写入的 payload 几乎不含真实数据（所有 provider 的 apiKey
 * 都为空、且 history / folders 为空），但目录里已经存在一份**实质更丰富**的备份
 * （文件大小明显更大，或包含 history / 任何已填的 apiKey）。
 *
 * 这是数据丢失最大风险点的最后防线：
 * - 用户重装插件 → chrome.storage 被清 → 默认 settings 重新填回（一堆 provider 占位 +
 *   空 apiKey）→ 任何对 settings 的改动都会触发自动同步 → 把"空 settings + 空 history"
 *   一股脑写到目录 JSON → 旧备份永久丢失。
 * - 加上这道关，自动同步路径在检测到这种危险写入时直接拒绝，等待用户**明确**点
 *   「覆盖备份」才会放行。
 */
async function isShrinkOverwrite(
  handle: FileSystemDirectoryHandle,
  next: BackupPayload,
  nextBytes: number
): Promise<boolean> {
  const allKeysEmpty = Object.values(next.settings?.providers || {}).every(
    (cfg) => !cfg?.apiKey || cfg.apiKey.trim().length === 0
  );
  const noHistory = !next.history || next.history.length === 0;
  const noFolders = !next.folders || next.folders.length === 0;
  if (!allKeysEmpty || !noHistory || !noFolders) return false;

  let existingText: string | null = null;
  try {
    const fh = await handle.getFileHandle(BACKUP_FILE_NAME, { create: false });
    const file = await fh.getFile();
    existingText = await file.text();
  } catch {
    return false;
  }
  if (!existingText) return false;

  // 任何已填的 apiKey / 任何历史条目 / 任何文件夹 → 现有备份比即将写入的更"重"
  try {
    const prev = JSON.parse(existingText) as BackupPayload;
    const hadAnyKey = Object.values(prev.settings?.providers || {}).some(
      (cfg) => cfg?.apiKey && cfg.apiKey.trim().length > 0
    );
    const hadHistory = Array.isArray(prev.history) && prev.history.length > 0;
    const hadFolders = Array.isArray(prev.folders) && prev.folders.length > 0;
    if (hadAnyKey || hadHistory || hadFolders) return true;
  } catch {
    // JSON 解析失败 → 用纯字节数兜底
  }
  // 兜底规则：现有文件比即将写入的至少大 50%，且现有文件 > 1 KB → 视为"萎缩覆盖"
  return existingText.length > 1024 && existingText.length > nextBytes * 1.5;
}

/**
 * 把当前 chrome.storage 里的全量数据写到目录里的 JSON 文件。
 *
 * @param appVersion 可选，写入到 backup payload 的 appVersion 字段，仅用于排查。
 * @param opts.force 默认 false。false 时会经过 {@link isShrinkOverwrite} 安全网，
 *                   防止把"空数据"自动覆盖到一份更丰富的旧备份上；返回
 *                   `reason: 'shrink-blocked'`。UI 收到这个 reason 应弹明确的二次
 *                   确认，让用户主动选择「恢复备份」或「确实要覆盖」，确认后再
 *                   传 `force: true` 重新调用。
 */
export async function syncToDirectory(
  appVersion?: string,
  opts: { force?: boolean } = {}
): Promise<{
  ok: boolean;
  reason?: string;
  syncedAt?: number;
  bytes?: number;
}> {
  if (!supportsFileSystemAccess()) {
    return { ok: false, reason: 'unsupported' };
  }
  const handle = await loadDirectoryHandle();
  if (!handle) {
    return { ok: false, reason: 'not-configured' };
  }
  const granted = await ensureDirectoryPermission(handle, false);
  if (!granted) {
    return { ok: false, reason: 'permission-denied' };
  }
  try {
    const payload = await buildBackup(appVersion);
    const text = JSON.stringify(payload, null, 2);
    if (!opts.force) {
      const blocked = await isShrinkOverwrite(handle, payload, text.length);
      if (blocked) {
        console.info(
          '[PromptExtracto] syncToDirectory blocked: refusing to overwrite richer existing backup with empty data'
        );
        return { ok: false, reason: 'shrink-blocked' };
      }
    }
    const fileHandle = await handle.getFileHandle(BACKUP_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    return { ok: true, syncedAt: Date.now(), bytes: text.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[PromptExtracto] syncToDirectory failed', err);
    return { ok: false, reason: msg };
  }
}

/**
 * 从数据目录里的 JSON 文件读回数据，按 mode 写入 chrome.storage。
 *
 * 通常发生在：
 * - 用户首次选目录时检测到已有备份 → 询问是否 'replace'
 * - 用户重装插件 → 选回原目录 → 让用户在 UI 上点「立即恢复」 → 走 'replace' 路径
 * - 多设备协作场景 → 选 'merge'，按 id 去重保留较新版本
 */
export async function loadFromDirectory(
  mode: 'replace' | 'merge' = 'replace'
): Promise<{
  ok: boolean;
  reason?: string;
  result?: Awaited<ReturnType<typeof restoreBackup>>;
}> {
  if (!supportsFileSystemAccess()) {
    return { ok: false, reason: 'unsupported' };
  }
  const handle = await loadDirectoryHandle();
  if (!handle) {
    return { ok: false, reason: 'not-configured' };
  }
  const granted = await ensureDirectoryPermission(handle, true);
  if (!granted) {
    return { ok: false, reason: 'permission-denied' };
  }
  try {
    const fileHandle = await handle.getFileHandle(BACKUP_FILE_NAME, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    const payload = JSON.parse(text) as BackupPayload;
    const result = await restoreBackup(payload, mode);
    return { ok: true, result };
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFoundError') {
      return { ok: false, reason: 'no-backup-file' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

/**
 * "上次同步时间"在 chrome.storage.local 里缓存一份，UI 用它显示同步状态。
 */
const SYNC_META_KEY = 'fs_backup_meta_v1';
export interface SyncMeta {
  lastSyncedAt: number;
  lastError?: string | null;
  bytes?: number;
}

export async function readSyncMeta(): Promise<SyncMeta | null> {
  try {
    const data = await chrome.storage.local.get(SYNC_META_KEY);
    return (data[SYNC_META_KEY] as SyncMeta) || null;
  } catch {
    return null;
  }
}
export async function writeSyncMeta(meta: SyncMeta): Promise<void> {
  await chrome.storage.local.set({ [SYNC_META_KEY]: meta });
}
