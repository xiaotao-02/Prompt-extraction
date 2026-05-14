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
  AlertTriangle,
  Check,
  Info,
  X,
  History as HistoryIcon,
  KeyRound,
  Folder as FolderIcon,
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
import {
  buildBackup,
  onLocalDataChange,
  restoreBackup,
  type BackupPayload,
} from '@/lib/storage';
import { DISCOVERED_KEY, SETTINGS_KEY } from '@/lib/storage/keys';
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
 *
 * 数据安全设计要点（吃过亏后加固，不要随意删）：
 * - 选回旧目录时**绝不**自动 syncToDirectory；恢复 / 保持不动 / 覆盖三选一由用户自己点
 * - syncToDirectory 默认带 `shrink-blocked` 守门；UI 收到 shrink-blocked 弹二次确认
 * - 「未配置数据目录」状态用橙色警告横幅，专门提醒重装用户**先选回旧目录再去填 API**
 */
export interface DataPersistenceProps {
  /** 数据变化时由外层重新拉取（例如恢复后让 SettingsView 重新读 settings）。 */
  onDataRestored?: () => void;
}

/**
 * 选完目录后等待用户决策的临时状态：
 * - 'pending-existing'：目录里已有备份，弹自定义模态让用户挑「恢复 / 保持 / 覆盖」
 * - 'shrink-confirm'：自动同步被 shrink-blocked，弹模态让用户选「恢复 / 保持 / 强制覆盖」
 */
interface PendingExistingDecision {
  kind: 'pending-existing';
  payload: BackupPayload;
}
interface PendingShrinkDecision {
  kind: 'shrink-confirm';
}
type Decision = PendingExistingDecision | PendingShrinkDecision | null;

export default function DataPersistence({ onDataRestored }: DataPersistenceProps) {
  const [state, setState] = useState<DataDirectoryState | null>(null);
  const [meta, setMeta] = useState<SyncMeta | null>(null);
  const [busy, setBusy] = useState<'pick' | 'sync' | 'restore' | 'export' | 'import' | null>(null);
  const [tip, setTip] = useState<{ ok: boolean; msg: string } | null>(null);
  const [decision, setDecision] = useState<Decision>(null);
  const shrinkDismissedRef = useRef(false);
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

  /**
   * 走完一次 syncToDirectory 后统一处理结果：
   * - ok：写 SyncMeta + UI tip
   * - shrink-blocked：进入二次确认状态，让用户自己决定「恢复 / 保持 / 强制覆盖」
   * - 其它失败：写 SyncMeta(lastError) + UI tip
   */
  const handleSyncResult = useCallback(
    async (
      r: Awaited<ReturnType<typeof syncToDirectory>>,
      opts: { silent?: boolean } = {}
    ) => {
      if (r.ok) {
        const m: SyncMeta = { lastSyncedAt: r.syncedAt || Date.now(), bytes: r.bytes };
        await writeSyncMeta(m);
        setMeta(m);
        if (!opts.silent) showTip(true, '已同步到数据目录');
        return;
      }
      if (r.reason === 'shrink-blocked') {
        // 这是数据丢失高危路径（重装后空数据要覆盖旧备份），必须强制让用户表态
        const m: SyncMeta = {
          lastSyncedAt: meta?.lastSyncedAt || 0,
          bytes: meta?.bytes,
          lastError: formatReason(r.reason),
        };
        await writeSyncMeta(m);
        setMeta(m);
        if (!opts.silent) showTip(false, formatReason(r.reason));
        setDecision({ kind: 'shrink-confirm' });
        return;
      }
      if (!opts.silent) showTip(false, formatReason(r.reason));
      const m: SyncMeta = {
        lastSyncedAt: meta?.lastSyncedAt || 0,
        bytes: meta?.bytes,
        lastError: formatReason(r.reason),
      };
      await writeSyncMeta(m);
      setMeta(m);
    },
    [meta?.bytes, meta?.lastSyncedAt]
  );

  // 监听本地数据变化 → 自动同步到数据目录（如果配置了）。
  //
  // 用两条订阅同时覆盖两种情况：
  // 1) onLocalDataChange：同一个 options 页面内调 saveSettings / 改 history → 当场触发
  // 2) chrome.storage.onChanged：service worker / popup 写 storage（例如 background
  //    在右键提取后调 addHistory）→ 跨 context 通知，必须用 chrome.storage 事件
  //
  // 用 debounce 1.2s 把短时间内的多次写入（例如批量删除、连续提取）合并成一次落盘，
  // 避免反复打开/关闭可写文件流给磁盘带来负担，也降低对用户文件系统活跃度的干扰。
  //
  // 关键安全网：在 decision 处于 'pending-existing' 期间**完全跳过**自动同步，
  // 否则用户还没决定要不要恢复，restoreBackup 触发的写入就会被自动同步把空数据
  // 写到 JSON 把旧备份覆盖。
  useEffect(() => {
    if (!state?.configured) return;
    let timer: number | null = null;

    const doSync = () => {
      if (decision != null) return;
      if (shrinkDismissedRef.current) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const r = await syncToDirectory(getCurrentVersion());
        await handleSyncResult(r, { silent: true });
      }, 1200);
    };

    const off = onLocalDataChange(doSync);
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      _area: chrome.storage.AreaName
    ) => {
      // 只对 settings / history / folders 的变更触发同步；忽略我们自己写的 SyncMeta 等
      // 否则会形成"写 meta → onChanged → 再同步 → 写 meta"的死循环。
      if (
        SETTINGS_KEY in changes ||
        'history_v1' in changes ||
        'library_folders_v1' in changes ||
        DISCOVERED_KEY in changes
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
  }, [state?.configured, decision, handleSyncResult]);

  /**
   * 选目录入口。**绝不**在这里隐式调 syncToDirectory，否则用户点【取消】后
   * 会立刻把当前空数据写到 JSON 把旧备份永久覆盖（吃过这个亏）。
   *
   * - 目录里**没有**备份 → 显式提示，让用户自己点「立即同步」写第一份
   * - 目录里**已有**备份 → 弹自定义模态框，三选一（恢复 / 保持 / 覆盖）
   */
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
        setDecision({ kind: 'pending-existing', payload: existingBackup });
      } else {
        showTip(true, '已设置数据目录，可点「立即同步」写入首份备份');
      }
    } catch (err) {
      showTip(false, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const applyDecision = async (
    choice: 'restore' | 'keep' | 'overwrite'
  ): Promise<void> => {
    if (!decision) return;

    if (decision.kind === 'pending-existing') {
      if (choice === 'restore') {
        setBusy('restore');
        try {
          const r = await restoreBackup(decision.payload, 'replace');
          showTip(true, `已从备份还原 · 历史 ${r.historyTotal} 条`);
          onDataRestored?.();
          shrinkDismissedRef.current = false;
          const sr = await syncToDirectory(getCurrentVersion());
          await handleSyncResult(sr, { silent: true });
        } finally {
          setBusy(null);
        }
      } else if (choice === 'overwrite') {
        setBusy('sync');
        try {
          const sr = await syncToDirectory(getCurrentVersion(), { force: true });
          await handleSyncResult(sr);
          shrinkDismissedRef.current = false;
        } finally {
          setBusy(null);
        }
      }
      setDecision(null);
      return;
    }

    if (decision.kind === 'shrink-confirm') {
      if (choice === 'restore') {
        setBusy('restore');
        try {
          const r = await loadFromDirectory('replace');
          if (r.ok && r.result) {
            showTip(true, `已从备份恢复 · 历史 ${r.result.historyTotal} 条`);
            onDataRestored?.();
            shrinkDismissedRef.current = false;
          } else {
            showTip(false, formatReason(r.reason));
          }
        } finally {
          setBusy(null);
        }
      } else if (choice === 'overwrite') {
        setBusy('sync');
        try {
          const sr = await syncToDirectory(getCurrentVersion(), { force: true });
          await handleSyncResult(sr);
          shrinkDismissedRef.current = false;
        } finally {
          setBusy(null);
        }
      } else {
        shrinkDismissedRef.current = true;
      }
      setDecision(null);
    }
  };

  const onSyncNow = async () => {
    setBusy('sync');
    try {
      const r = await syncToDirectory(getCurrentVersion());
      await handleSyncResult(r);
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
      if (!payload || (payload.version !== 1 && payload.version !== 2)) {
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
            // 未配置目录态：用橙色警告横幅，专门防"重装用户先填 Key 把旧备份盖了"
            <div className="space-y-3">
              <div className="rounded-lg border-2 border-amber-300 dark:border-amber-500/50 bg-amber-50 dark:bg-amber-500/10 px-3.5 py-2.5 text-[12px] text-amber-800 dark:text-amber-200 flex gap-2.5">
                <AlertTriangle className="w-4 h-4 flex-none mt-0.5 text-amber-600 dark:text-amber-300" />
                <div className="leading-relaxed">
                  <span className="font-semibold">之前配过数据目录？</span>
                  点下方<b>「选择数据目录…」</b>选回原来的文件夹，有旧备份时会弹窗让你一键恢复。
                </div>
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                <b>第一次使用？</b>选一个你<b>自己常用的固定文件夹</b>（建议放到 OneDrive /
                坚果云这类带历史版本的同步盘里，多一层保险）。插件会在里面维护一个{' '}
                <code className="font-mono">{BACKUP_FILE_NAME}</code>{' '}
                文件，所有写入都会同步进去；重装后再选回这个文件夹即可自动识别并还原。
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

      {decision && (
        <DecisionModal
          decision={decision}
          busy={busy}
          onChoose={(c) => void applyDecision(c)}
          onClose={() => {
            if (decision.kind === 'shrink-confirm') {
              shrinkDismissedRef.current = true;
            }
            setDecision(null);
          }}
        />
      )}
    </section>
  );
}

/**
 * 三选一决策模态框。
 * - 'pending-existing'：选回旧目录，目录里已有备份
 * - 'shrink-confirm'：自动同步被守门拦下，必须用户表态
 *
 * 故意**不**用浏览器原生 confirm —— 中文用户对「确定/取消」语义容易误判，
 * 而用自定义按钮可以把破坏性操作（覆盖备份）放成 rose 红色 + 二次确认。
 */
function DecisionModal({
  decision,
  busy,
  onChoose,
  onClose,
}: {
  decision: PendingExistingDecision | PendingShrinkDecision;
  busy: 'pick' | 'sync' | 'restore' | 'export' | 'import' | null;
  onChoose: (c: 'restore' | 'keep' | 'overwrite') => void;
  onClose: () => void;
}) {
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false);
  const isPending = decision.kind === 'pending-existing';
  const payload = isPending ? decision.payload : null;
  const historyCount = payload?.history?.length ?? 0;
  const providersWithKey = payload
    ? Object.values(payload.settings?.providers || {}).filter(
        (cfg) => cfg?.apiKey && cfg.apiKey.trim().length > 0
      ).length
    : 0;
  const folderCount = payload?.folders?.length ?? 0;
  const exportedAt = payload?.exportedAt ? new Date(payload.exportedAt) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300 flex items-center justify-center flex-none">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">
              {isPending ? '检测到目录里已有备份' : '即将用空数据覆盖更丰富的备份'}
            </h3>
            <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
              {isPending
                ? '请明确选择如何处理 —— 误操作可能让旧备份被空数据永久覆盖。'
                : '当前 chrome.storage 里几乎没有真实数据（API Key / 历史 / 文件夹都是空的），但目录里的 JSON 备份明显更"重"。请先选择如何处理。'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="关闭（等同「保持备份不动」）"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {payload && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-3.5 py-3 text-[12px] space-y-1.5">
              <div className="flex items-center gap-2 text-zinc-500 text-[11px]">
                {BACKUP_FILE_NAME}
                {exportedAt && (
                  <span className="ml-auto">
                    导出于{' '}
                    {`${exportedAt.getFullYear()}/${
                      exportedAt.getMonth() + 1
                    }/${exportedAt.getDate()} ${exportedAt.getHours()}:${String(
                      exportedAt.getMinutes()
                    ).padStart(2, '0')}`}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Stat
                  icon={<HistoryIcon className="w-3 h-3" />}
                  label="历史记录"
                  value={historyCount}
                />
                <Stat
                  icon={<KeyRound className="w-3 h-3" />}
                  label="已填 API"
                  value={providersWithKey}
                />
                <Stat
                  icon={<FolderIcon className="w-3 h-3" />}
                  label="文件夹"
                  value={folderCount}
                />
              </div>
            </div>
          )}

          {!confirmingOverwrite ? (
            <div className="space-y-2">
              <ChoiceButton
                tone="primary"
                disabled={busy !== null}
                onClick={() => onChoose('restore')}
                title={isPending ? '恢复备份（推荐）' : '从备份恢复'}
                desc={
                  isPending
                    ? '把这份备份完整还原到插件里 —— 适合刚重装后选回旧目录的场景'
                    : '把目录里的 JSON 完整还原到插件里 —— 推荐做法'
                }
                busy={busy === 'restore'}
              />
              <ChoiceButton
                tone="ghost"
                disabled={busy !== null}
                onClick={() => onChoose('keep')}
                title="保持备份不动"
                desc="不读也不写；备份和插件数据都保持现状（关闭弹窗等同此选项）"
              />
              <ChoiceButton
                tone="danger"
                disabled={busy !== null}
                onClick={() => setConfirmingOverwrite(true)}
                title="用当前数据覆盖备份"
                desc="把插件里现在的数据写到 JSON，把旧备份永久覆盖（不可撤销）"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-rose-200 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 px-3.5 py-3 space-y-3">
              <div className="text-[12px] text-rose-700 dark:text-rose-200 leading-relaxed flex gap-2">
                <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
                <div>
                  <div className="font-semibold mb-1">这一步不可撤销！</div>
                  你确定要用当前
                  {historyCount > 0 || providersWithKey > 0 || folderCount > 0
                    ? '（更少的）'
                    : '（空的）'}
                  数据覆盖目录里这份备份吗？
                  {(historyCount > 0 || providersWithKey > 0) && (
                    <>
                      <br />
                      旧备份里有 <b>{historyCount}</b> 条历史 / <b>{providersWithKey}</b> 个 API
                      Key 会立刻消失。
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50"
                  disabled={busy !== null}
                  onClick={() => {
                    setConfirmingOverwrite(false);
                    onChoose('overwrite');
                  }}
                >
                  确认覆盖
                </button>
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  disabled={busy !== null}
                  onClick={() => setConfirmingOverwrite(false)}
                >
                  返回
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="text-base font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function ChoiceButton({
  tone,
  title,
  desc,
  disabled,
  busy,
  onClick,
}: {
  tone: 'primary' | 'ghost' | 'danger';
  title: string;
  desc: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  const cls =
    tone === 'primary'
      ? 'border-violet-300 dark:border-violet-500/50 bg-violet-50 dark:bg-violet-500/10 hover:border-violet-400 hover:bg-violet-100/70 dark:hover:bg-violet-500/15 text-violet-900 dark:text-violet-100'
      : tone === 'danger'
      ? 'border-rose-200 dark:border-rose-500/40 hover:border-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-700 dark:text-rose-300'
      : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-200';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-3.5 py-2.5 rounded-xl border transition disabled:opacity-50 ${cls}`}
    >
      <div className="text-[13px] font-medium flex items-center gap-2">
        {title}
        {busy && <RotateCw className="w-3 h-3 animate-spin" />}
      </div>
      <div className="text-[11px] mt-0.5 opacity-80 leading-snug">{desc}</div>
    </button>
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
    case 'shrink-blocked':
      return '安全网拦下了空数据覆盖（请在弹窗中选择恢复或确认覆盖）';
    default:
      return reason;
  }
}
