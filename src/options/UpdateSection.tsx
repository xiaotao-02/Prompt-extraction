import { useEffect, useState } from 'react';
import { RefreshCw, Check, AlertCircle, ExternalLink, Sparkles, Megaphone } from 'lucide-react';
import { getUpdateSettings } from '@/lib/storage';
import type { RemoteRuntimeConfigCache } from '@/lib/remoteRuntimeConfig';
import { readRemoteRuntimeConfigCache } from '@/lib/remoteRuntimeConfig';
import { REMOTE_RUNTIME_CONFIG_CACHE_KEY } from '@/lib/storage/keys';
import { getCurrentVersion } from '@/lib/updater';
import { isNewerVersion } from '@/lib/version';
import type { UpdateCheckResult, UpdateSettings } from '@/lib/types';

/**
 * 「检查更新」面板。
 *
 * 点按钮 → background `CHECK_UPDATE`（GitHub Release）；
 * 同路径会顺带尝试刷新远端「纯数据」配置缓存（需在 `constants.ts` 配置 HTTPS URL）。
 * 远端公告 / 软性版本提示取自 `chrome.storage.local`，不嵌入可执行代码。
 */
export default function UpdateSection({
  variant = 'card',
}: {
  variant?: 'card' | 'plain';
}) {
  const [u, setU] = useState<UpdateSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState<{ ok: boolean; msg: string } | null>(null);
  const [remoteHints, setRemoteHints] = useState<RemoteRuntimeConfigCache | null>(null);

  const load = async () => {
    const s = await getUpdateSettings();
    setU(s);
  };

  const loadRemoteHints = async () => {
    const c = await readRemoteRuntimeConfigCache();
    setRemoteHints(c);
  };

  useEffect(() => {
    void load();
    void loadRemoteHints();
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (!(REMOTE_RUNTIME_CONFIG_CACHE_KEY in changes)) return;
      void loadRemoteHints();
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  const current = getCurrentVersion();

  const onCheck = async () => {
    setBusy(true);
    setTip(null);
    try {
      const resp = (await chrome.runtime.sendMessage({ type: 'CHECK_UPDATE' })) as
        | { ok: true; result: UpdateCheckResult }
        | { ok: false; error?: string }
        | undefined;
      if (!resp || resp.ok !== true) {
        const errMsg =
          resp && typeof resp === 'object' && typeof resp.error === 'string' && resp.error
            ? resp.error
            : '检查失败，请稍后再试';
        setTip({ ok: false, msg: errMsg });
      } else {
        const { result } = resp;
        if (!result) {
          setTip({ ok: false, msg: '检查失败，请稍后再试' });
        } else if (result.error) {
          setTip({ ok: false, msg: result.error });
        } else if (result.hasUpdate && result.latest) {
          setTip({ ok: true, msg: `发现新版本 v${result.latest.version}` });
        } else {
          setTip({ ok: true, msg: '当前已是最新版本' });
        }
      }
    } finally {
      setBusy(false);
      await load();
      await loadRemoteHints();
    }
  };

  if (!u) return null;

  const latest = u.lastResult?.latest;
  const hasUpdate = !!u.lastResult?.hasUpdate && !!latest;

  const p = remoteHints?.payload;
  const announcementZh = p?.announcementZh?.trim();
  const minRec = p?.minRecommendedExtensionVersion;
  const docsUrl = p?.docsUrl;
  const softNudgeExtension = !!(minRec && isNewerVersion(minRec, current));

  const Root = variant === 'plain' ? 'div' : 'section';
  const rootClass = variant === 'plain' ? 'space-y-4' : 'card';

  return (
    <Root className={rootClass}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-violet-500" /> 检查更新
        </h2>
        <span className="text-[11px] text-zinc-400">当前版本 v{current}</span>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        手动检查 GitHub Releases，看看有没有新版本可用。
      </p>

      {announcementZh ? (
        <div className="mb-3 rounded-xl border border-sky-200/80 bg-sky-50/70 dark:border-sky-800/70 dark:bg-sky-950/25 px-3 py-2 flex gap-2 text-xs text-sky-950 dark:text-sky-50/95">
          <Megaphone className="w-4 h-4 shrink-0 mt-0.5 opacity-85" aria-hidden />
          <p className="leading-relaxed whitespace-pre-wrap flex-1 min-w-0">{announcementZh}</p>
        </div>
      ) : null}

      {softNudgeExtension ? (
        <div className="mb-3 rounded-xl border border-amber-200/90 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/30 px-3 py-2 text-[11px] leading-relaxed text-amber-950 dark:text-amber-50/95">
          远端配置建议将你保持在 <span className="font-mono">v{minRec}</span> 或更高以获得最佳体验；请继续在{' '}
          <strong className="font-medium">Chrome / Edge 扩展商店</strong> 中获取正式更新（本扩展不会从第三方渠道热更新代码）。
          {docsUrl ? (
            <>
              {' '}
              <a
                href={docsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-amber-800 dark:text-amber-200 underline underline-offset-2 inline-flex items-center gap-0.5"
              >
                查看说明 <ExternalLink className="w-3 h-3" />
              </a>
            </>
          ) : null}
        </div>
      ) : docsUrl ? (
        <div className="mb-3 text-[11px]">
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-violet-500 hover:underline inline-flex items-center gap-1"
          >
            在线说明文档 <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      ) : null}

      <div className="space-y-3">
        <div
          className={`rounded-xl border p-3 ${
            hasUpdate
              ? 'border-violet-300 dark:border-violet-500/40 bg-violet-50/60 dark:bg-violet-500/10'
              : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/30'
          }`}
        >
          {hasUpdate && latest ? (
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 mt-0.5 text-violet-600 dark:text-violet-300 flex-none" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">发现新版本 v{latest.version}</div>
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
                        前往发布页 <ExternalLink className="w-3 h-3" />
                      </a>
                    </>
                  )}
                </div>
                {latest.releaseNotes && (
                  <pre className="mt-2 text-[11px] leading-relaxed whitespace-pre-wrap p-2 rounded-md bg-white/80 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800 max-h-40 overflow-auto">
                    {latest.releaseNotes}
                  </pre>
                )}
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

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onCheck} disabled={busy} className="btn-primary text-xs px-3 py-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            {busy ? '检查中…' : '立即检查更新'}
          </button>
          {tip && (
            <span
              className={`text-[11px] flex items-center gap-1 ${
                tip.ok ? 'text-emerald-600' : 'text-rose-500'
              }`}
            >
              {tip.ok ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
              {tip.msg}
            </span>
          )}
        </div>

        {remoteHints?.lastError ? (
          <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
            最近一次远端配置缓存刷新：<span className="text-rose-500">{remoteHints.lastError}</span>
            （仍会使用上一份成功载荷，如有）
          </p>
        ) : null}
      </div>
    </Root>
  );
}
