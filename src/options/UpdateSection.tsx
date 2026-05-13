import { useEffect, useState } from 'react';
import {
  RefreshCw,
  Download,
  Check,
  AlertCircle,
  ExternalLink,
  Info,
  Bell,
  BellOff,
} from 'lucide-react';
import { getUpdateSettings, patchUpdateSettings } from '@/lib/storage';
import {
  clampIntervalHours,
  getCurrentVersion,
  normalizeFeedUrl,
} from '@/lib/updater';
import { isNewerVersion } from '@/lib/version';
import type { UpdateSettings } from '@/lib/types';

const INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '每小时' },
  { value: 6, label: '每 6 小时' },
  { value: 24, label: '每天' },
  { value: 24 * 3, label: '每 3 天' },
  { value: 24 * 7, label: '每周' },
];

export default function UpdateSection() {
  const [u, setU] = useState<UpdateSettings | null>(null);
  const [draftFeed, setDraftFeed] = useState('');
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null);
  const [tip, setTip] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = async () => {
    const s = await getUpdateSettings();
    setU(s);
    setDraftFeed(s.feedUrl || '');
  };

  useEffect(() => {
    void load();
  }, []);

  const current = getCurrentVersion();

  const onSaveFeed = async () => {
    const next = await patchUpdateSettings({ feedUrl: draftFeed.trim() });
    setU(next);
    setTip({ ok: true, msg: '更新源已保存' });
    setTimeout(() => setTip(null), 1500);
  };

  const onToggleEnabled = async (enabled: boolean) => {
    const next = await patchUpdateSettings({ enabled });
    setU(next);
  };

  const onToggleNotify = async (notifyDesktop: boolean) => {
    const next = await patchUpdateSettings({ notifyDesktop });
    setU(next);
  };

  const onChangeInterval = async (intervalHours: number) => {
    const next = await patchUpdateSettings({ intervalHours: clampIntervalHours(intervalHours) });
    setU(next);
  };

  const onCheck = async () => {
    setBusy('check');
    setTip(null);
    try {
      // 先确保最新的 feed 已保存
      if (draftFeed.trim() !== (u?.feedUrl || '')) {
        await patchUpdateSettings({ feedUrl: draftFeed.trim() });
      }
      const resp = await chrome.runtime.sendMessage({
        type: 'CHECK_UPDATE',
        payload: { force: true },
      });
      const result = resp?.result;
      if (!resp?.ok || !result) {
        setTip({ ok: false, msg: '检查失败，请稍后再试' });
      } else if (result.error) {
        setTip({ ok: false, msg: result.error });
      } else if (result.hasUpdate && result.latest) {
        setTip({ ok: true, msg: `发现新版本 v${result.latest.version}` });
      } else {
        setTip({ ok: true, msg: '当前已是最新版本' });
      }
    } finally {
      setBusy(null);
      await load();
    }
  };

  const onApply = async () => {
    setBusy('apply');
    setTip(null);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'APPLY_UPDATE' });
      if (resp?.message) setTip({ ok: !!resp.ok, msg: resp.message });
    } finally {
      setBusy(null);
      await load();
    }
  };

  const onResetDismiss = async () => {
    const next = await patchUpdateSettings({ dismissedVersion: '' });
    setU(next);
  };

  if (!u) return null;

  const latest = u.lastResult?.latest;
  const hasUpdate = !!u.lastResult?.hasUpdate && !!latest;
  const dismissed =
    !!u.dismissedVersion && !!latest && !isNewerVersion(latest.version, u.dismissedVersion);
  const feedNormalized = normalizeFeedUrl(draftFeed);

  return (
    <section className="card">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-violet-500" /> 自动更新
        </h2>
        <span className="text-[11px] text-zinc-400">当前版本 v{current}</span>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        定期检查新版本并在工具栏显示提示，点击「一键更新」即可触发更新。
      </p>

      <div className="space-y-4">
        {/* 当前状态 */}
        <div
          className={`rounded-xl border p-3 ${
            hasUpdate && !dismissed
              ? 'border-violet-300 dark:border-violet-500/40 bg-violet-50/60 dark:bg-violet-500/10'
              : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/30'
          }`}
        >
          {hasUpdate && latest ? (
            <div className="flex items-start gap-2">
              <Download className="w-4 h-4 mt-0.5 text-violet-600 dark:text-violet-300 flex-none" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  发现新版本 v{latest.version}
                  {dismissed && (
                    <span className="ml-2 text-[10px] px-1.5 py-px rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-500">
                      已忽略
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {latest.publishedAt && new Date(latest.publishedAt).toLocaleString()}
                  {latest.releaseUrl && (
                    <>
                      {' · '}
                      <a
                        href={latest.releaseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-violet-500 hover:underline inline-flex items-center gap-0.5"
                      >
                        发布详情 <ExternalLink className="w-3 h-3" />
                      </a>
                    </>
                  )}
                </div>
                {latest.releaseNotes && (
                  <pre className="mt-2 text-[11px] leading-relaxed whitespace-pre-wrap p-2 rounded-md bg-white/80 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800 max-h-40 overflow-auto">
                    {latest.releaseNotes}
                  </pre>
                )}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={onApply}
                    disabled={busy !== null}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    {busy === 'apply' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    一键更新到 v{latest.version}
                  </button>
                  {dismissed ? (
                    <button
                      onClick={onResetDismiss}
                      className="text-xs px-2.5 py-1.5 rounded-md text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/10"
                    >
                      取消忽略
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        await patchUpdateSettings({ dismissedVersion: latest.version });
                        await load();
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      忽略此版本
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-emerald-500" />
              <div className="flex-1">
                <div className="font-medium">当前已是最新版本</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {u.lastCheckedAt
                    ? `上次检查于 ${new Date(u.lastCheckedAt).toLocaleString()}`
                    : '尚未检查过'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* feedUrl 配置 */}
        <div>
          <label className="label flex items-center justify-between">
            <span>更新源</span>
            <span className="text-[11px] text-zinc-400">
              支持 GitHub <code className="px-1 bg-zinc-100 dark:bg-zinc-800 rounded">owner/repo</code>{' '}
              简写或完整 JSON URL
            </span>
          </label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="如：your-name/image-prompt-extractor"
              value={draftFeed}
              onChange={(e) => setDraftFeed(e.target.value)}
              onBlur={onSaveFeed}
            />
            <button
              onClick={onCheck}
              disabled={busy !== null || !feedNormalized}
              className="btn-primary text-xs px-3"
            >
              {busy === 'check' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              立即检查
            </button>
          </div>
          {!feedNormalized && draftFeed && (
            <p className="mt-1.5 text-[11px] text-amber-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> 无法识别此更新源
            </p>
          )}
          {feedNormalized && (
            <p className="mt-1.5 text-[11px] text-zinc-400 flex items-center gap-1">
              <Info className="w-3 h-3" /> 实际请求：
              <span className="truncate">{feedNormalized}</span>
            </p>
          )}
          {tip && (
            <p
              className={`mt-1.5 text-[11px] flex items-center gap-1 ${
                tip.ok ? 'text-emerald-600' : 'text-rose-500'
              }`}
            >
              {tip.ok ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
              {tip.msg}
            </p>
          )}
        </div>

        {/* 自动检查开关 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-start gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={u.enabled}
              onChange={(e) => onToggleEnabled(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-violet-500"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">启用自动检查</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                后台按周期请求更新源；关闭后仅可手动检查。
              </div>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={u.notifyDesktop}
              onChange={(e) => onToggleNotify(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-violet-500"
            />
            <div className="flex-1">
              <div className="text-sm font-medium flex items-center gap-1.5">
                {u.notifyDesktop ? (
                  <Bell className="w-3.5 h-3.5 text-violet-500" />
                ) : (
                  <BellOff className="w-3.5 h-3.5 text-zinc-400" />
                )}
                桌面通知
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                有新版本时通过系统通知提醒，可点击直接更新。
              </div>
            </div>
          </label>
        </div>

        <div>
          <label className="label">检查频率</label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {INTERVAL_OPTIONS.map((opt) => {
              const active = Math.abs(u.intervalHours - opt.value) < 0.01;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeInterval(opt.value)}
                  disabled={!u.enabled}
                  className={`text-xs py-1.5 rounded-lg border transition ${
                    active
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-200'
                      : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 text-zinc-600 dark:text-zinc-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-[11px] text-zinc-400 leading-relaxed">
          说明：通过 Chrome 网上应用店安装的扩展，「一键更新」会触发 Chrome 原生更新并自动重载；
          通过开发者模式加载（dist 目录）的扩展无法被自动覆盖，
          会打开发布页让你下载新版后到 <code className="px-1 bg-zinc-100 dark:bg-zinc-800 rounded">chrome://extensions</code>{' '}
          重新加载。
        </p>
      </div>
    </section>
  );
}
