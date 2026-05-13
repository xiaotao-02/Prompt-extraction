import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HardDrive,
  FolderOpen,
  FolderCheck,
  RotateCw,
  Download,
  Upload,
  Link2Off,
  ShieldCheck,
  AlertCircle,
  Check,
  Info,
} from 'lucide-react';
import {
  BACKUP_FILE_NAME,
  disconnectDataDirectory,
  loadFromDirectory,
  pickDataDirectory,
  readDirectoryState,
  readSyncMeta,
  supportsFileSystemAccess,
  syncToDirectory,
  writeSyncMeta,
  type DataDirectoryState,
  type SyncMeta,
} from '@/lib/fsBackup';
import { buildBackup, onLocalDataChange, restoreBackup, type BackupPayload } from '@/lib/storage';
import { getCurrentVersion } from '@/lib/updater';

/**
 * 「数据持久化」卡片。
 *
 * 解决的核心问题：Chrome 出于隐私安全，扩展被移除时会清空 chrome.storage 和 IndexedDB。
 * 为了让用户「卸载/重装/换设备」后仍能拿回 settings + 历史记录，这里提供两条通道：
 *
 * 1) **数据目录（推荐）**：通过 File System Access API 让用户挑选一个本地目录，
 *    数据双写到该目录里的 prompt-extracto-data.json。重装后再选回同一目录即可全量还原。
 *    – 自动同步（监听 storage 变化，debounced 写盘）
 *    – 立即同步、立即从盘恢复
 *    – 旧浏览器（不支持 FSA）自动降级到下面的导入/导出按钮
 *
 * 2) **手动导入 / 导出 JSON**：兜底方案，所有浏览器都可用。
 */
export interface DataPersistenceProps {
  /** 数据变化时由外层重新拉取（例如恢复后让 SettingsView 重新读 settings）。 */
  onDataRestored?: () => void;
}

export default function DataPersistence({ onDataRestored }: DataPersistenceProps) {
  const [state, setState] = useState<DataDirectoryState | null>(null);
  const [meta, setMeta] = useState<SyncMeta | null>(null);
  const [busy, setBusy] = useState<'pick' | 'sync' | 'restore' | 'export' | 'import' | null>(null);
  const [tip, setTip] = useState<{ ok: boolean; msg: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [s, m] = await Promise.all([readDirectoryState(), readSyncMeta()]);
    setState(s);
    setMeta(m);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showTip = (ok: boolean, msg: string) => {
    setTip({ ok, msg });
    setTimeout(() => setTip(null), 2400);
  };

  // 监听本地数据变化 → 自动同步到数据目录（如果配置了）。
  //
  // 用两条订阅同时覆盖两种情况：
  // 1) onLocalDataChange：同一个 options 页面内调 saveSettings / 改 history → 当场触发
  // 2) chrome.storage.onChanged：service worker / popup 写 storage（例如 background
  //    在右键提取后调 addHistory）→ 跨 context 通知，必须用 chrome.storage 事件
  //
  // 用 debounce 1.2s 把短时间内的多次写入（例如批量删除、连续提取）合并成一次落盘，
  // 避免反复打开/关闭可写文件流给磁盘带来负担，也降低对用户文件系统活跃度的干扰。
  useEffect(() => {
    if (!state?.configured) return;
    let timer: number | null = null;

    const doSync = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const r = await syncToDirectory(getCurrentVersion());
        if (r.ok) {
          const m: SyncMeta = { lastSyncedAt: r.syncedAt || Date.now(), bytes: r.bytes };
          await writeSyncMeta(m);
          setMeta(m);
        } else {
          const m: SyncMeta = {
            lastSyncedAt: meta?.lastSyncedAt || 0,
            lastError: r.reason || '同步失败',
          };
          await writeSyncMeta(m);
          setMeta(m);
        }
      }, 1200);
    };

    const off = onLocalDataChange(doSync);
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      _area: chrome.storage.AreaName
    ) => {
      // 只对 settings / history 的变更触发同步；忽略我们自己写的 SyncMeta 等
      // 否则会形成"写 meta → onChanged → 再同步 → 写 meta"的死循环。
      if (
        'app_settings_v1' in changes ||
        'history_v1' in changes ||
        'discovered_models_v1' in changes
      ) {
        doSync();
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => {
      off();
      chrome.storage.onChanged.removeListener(onStorage);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [state?.configured, meta?.lastSyncedAt]);

  const onPick = async () => {
    setBusy('pick');
    try {
      const result = await pickDataDirectory();
      if (!result) {
        showTip(false, '已取消选择');
        return;
      }
      const { existingBackup } = result;
      await refresh();
      if (existingBackup) {
        const counts = `${existingBackup.history?.length || 0} 条历史 + ${
          Object.keys(existingBackup.settings?.providers || {}).length || 0
        } 个供应商配置`;
        const ok = confirm(
          `检测到该目录里已有备份（${counts}）。\n\n是否用它覆盖当前插件里的数据？\n\n` +
            `· 点【确定】= 完整恢复备份（适合刚重装后选回旧目录）\n` +
            `· 点【取消】= 保留当前数据，下次同步会把当前数据写回 JSON（覆盖旧备份）`
        );
        if (ok) {
          const r = await restoreBackup(existingBackup, 'replace');
          showTip(true, `已从备份还原 · 历史 ${r.historyTotal} 条`);
          onDataRestored?.();
        }
      } else {
        showTip(true, '已设置数据目录，立即写入首份备份…');
      }
      // 首次设置后立刻写一次，保证目录里有完整 JSON
      const r = await syncToDirectory(getCurrentVersion());
      if (r.ok) {
        const m: SyncMeta = { lastSyncedAt: r.syncedAt || Date.now(), bytes: r.bytes };
        await writeSyncMeta(m);
        setMeta(m);
      }
    } catch (err) {
      showTip(false, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onSyncNow = async () => {
    setBusy('sync');
    try {
      const r = await syncToDirectory(getCurrentVersion());
      if (r.ok) {
        const m: SyncMeta = { lastSyncedAt: r.syncedAt || Date.now(), bytes: r.bytes };
        await writeSyncMeta(m);
        setMeta(m);
        showTip(true, '已同步到数据目录');
      } else {
        showTip(false, formatReason(r.reason));
      }
    } finally {
      setBusy(null);
    }
  };

  const onRestoreNow = async () => {
    if (!confirm('从数据目录的 JSON 完整恢复？\n这会覆盖当前插件里的设置 + 历史记录。')) return;
    setBusy('restore');
    try {
      const r = await loadFromDirectory('replace');
      if (r.ok && r.result) {
        showTip(true, `已从备份恢复 · 历史 ${r.result.historyTotal} 条`);
        onDataRestored?.();
      } else {
        showTip(false, formatReason(r.reason));
      }
    } finally {
      setBusy(null);
    }
  };

  const onDisconnect = async () => {
    if (!confirm('解除当前数据目录绑定？\n（不会删除磁盘上的 JSON 文件，下次仍可选回）')) return;
    await disconnectDataDirectory();
    await refresh();
    showTip(true, '已解除绑定');
  };

  const onExport = async () => {
    setBusy('export');
    try {
      const payload = await buildBackup(getCurrentVersion());
      const text = JSON.stringify(payload, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = `prompt-extracto-backup-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showTip(true, '已导出全量备份');
    } finally {
      setBusy(null);
    }
  };

  const onImportFile = async (file: File) => {
    setBusy('import');
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as BackupPayload;
      if (!payload || payload.version !== 1) {
        showTip(false, '不是合法的备份文件');
        return;
      }
      const mode = confirm(
        '从备份恢复方式：\n\n' +
          '· 点【确定】= 完全替换（适合刚重装后导入旧备份）\n' +
          '· 点【取消】= 与现有数据合并（按 id 去重，保留较新版本）'
      )
        ? 'replace'
        : 'merge';
      const r = await restoreBackup(payload, mode);
      showTip(true, `已${mode === 'replace' ? '替换' : '合并'} · 历史 ${r.historyTotal} 条`);
      onDataRestored?.();
    } catch (err) {
      showTip(false, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  if (!state) {
    return (
      <section className="card">
        <div className="text-xs text-zinc-500">加载数据状态…</div>
      </section>
    );
  }

  const fsaSupported = state.supported && supportsFileSystemAccess();

  return (
    <section className="card space-y-4">
      <header className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white flex-none">
          <HardDrive className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            数据持久化
            <span className="text-[10px] font-normal px-1.5 py-px rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              卸载重装后可还原
            </span>
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
            把 API 配置和历史记录双写到你挑选的本地文件夹里的 JSON 文件。
            <b>重装插件后只需在这里选回同一个文件夹，就能自动识别并还原所有数据。</b>
          </p>
        </div>
        {tip && (
          <span
            className={`text-[11px] flex items-center gap-1 flex-none ${
              tip.ok ? 'text-emerald-600' : 'text-rose-500'
            }`}
          >
            {tip.ok ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {tip.msg}
          </span>
        )}
      </header>

      {/* FSA 不支持时只显示 fallback */}
      {!fsaSupported && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-200 flex gap-2">
          <Info className="w-3.5 h-3.5 flex-none mt-px" />
          <span>
            当前浏览器不支持 File System Access API，
            「数据目录」功能不可用。可使用下方的<b>手动导出 / 导入 JSON</b>作为替代方案。
          </span>
        </div>
      )}

      {/* 数据目录区 */}
      {fsaSupported && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
            <FolderOpen className="w-4 h-4 text-emerald-500" />
            数据目录
          </div>

          {state.configured ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300 font-medium">
                  <FolderCheck className="w-3.5 h-3.5" />
                  {state.name}/{BACKUP_FILE_NAME}
                </span>
                {state.permissionGranted ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px]">
                    <ShieldCheck className="w-3 h-3" /> 已授权
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[10px]">
                    <AlertCircle className="w-3 h-3" /> 权限已过期，点「立即同步」会重新请求
                  </span>
                )}
              </div>

              {meta?.lastSyncedAt ? (
                <div className="text-[11px] text-zinc-500">
                  上次同步：{formatTime(meta.lastSyncedAt)}
                  {meta.bytes ? ` · ${formatBytes(meta.bytes)}` : ''}
                  {meta.lastError && (
                    <span className="text-rose-500 ml-2">· 上次出错：{meta.lastError}</span>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-zinc-500">尚未同步</div>
              )}

              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={onSyncNow}
                  disabled={busy !== null}
                  className="btn-ghost text-xs px-2.5 py-1.5 disabled:opacity-50"
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`}
                  />
                  立即同步
                </button>
                <button
                  onClick={onRestoreNow}
                  disabled={busy !== null}
                  className="btn-ghost text-xs px-2.5 py-1.5 disabled:opacity-50"
                  title="从数据目录的 JSON 全量恢复"
                >
                  <Upload className="w-3.5 h-3.5" />
                  从目录恢复
                </button>
                <button
                  onClick={onPick}
                  disabled={busy !== null}
                  className="btn-ghost text-xs px-2.5 py-1.5 disabled:opacity-50"
                  title="换一个数据目录"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  更换目录
                </button>
                <button
                  onClick={onDisconnect}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-rose-500 hover:border-rose-300 dark:hover:border-rose-500/40 disabled:opacity-50"
                  title="解除绑定（不会删除磁盘文件）"
                >
                  <Link2Off className="w-3.5 h-3.5" />
                  解除绑定
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                还没有设置数据目录。建议选一个你<b>自己常用的固定文件夹</b>（例如{' '}
                <code className="px-1 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px]">
                  D:\我的提示词\
                </code>{' '}
                ），插件会在里面维护一个 <code className="font-mono">{BACKUP_FILE_NAME}</code>{' '}
                文件，所有写入都会同步进去。
                <br />
                重装插件后，再选回这个文件夹即可自动识别并还原。
              </p>
              <button
                onClick={onPick}
                disabled={busy !== null}
                className="btn-primary text-xs"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {busy === 'pick' ? '请在系统对话框中选择…' : '选择数据目录…'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 手动导入/导出（兜底） */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
          <Download className="w-4 h-4 text-zinc-500" />
          手动备份 / 恢复（兜底）
        </div>
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          一键导出包含设置 + 全部历史的 JSON 备份；或从 JSON 文件恢复。
          适合不想配置数据目录的场景，或当作额外保险。
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={onExport}
            disabled={busy !== null}
            className="btn-ghost text-xs px-2.5 py-1.5 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            导出全量备份
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={busy !== null}
            className="btn-ghost text-xs px-2.5 py-1.5 disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            从 JSON 恢复
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
        </div>
      </div>
    </section>
  );
}

function formatTime(t: number): string {
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatReason(reason?: string): string {
  if (!reason) return '操作失败';
  switch (reason) {
    case 'unsupported':
      return '当前浏览器不支持 File System Access API';
    case 'not-configured':
      return '尚未设置数据目录';
    case 'permission-denied':
      return '没有目录读写权限，请重新授权';
    case 'no-backup-file':
      return '该目录里没有备份文件，可能你换了文件夹';
    default:
      return reason;
  }
}
