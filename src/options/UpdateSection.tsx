import { useEffect, useState } from 'react';
import { RefreshCw, Check, AlertCircle, ExternalLink, Sparkles } from 'lucide-react';
import { getUpdateSettings } from '@/lib/storage';
import { getCurrentVersion } from '@/lib/updater';
import type { UpdateCheckResult, UpdateSettings } from '@/lib/types';

/**
 * 「检查更新」面板。
 *
 * 只做一件事：点按钮 → 向 background 发 CHECK_UPDATE → 展示结果。
 * 没有定时检查、桌面通知、徽章提示、忽略版本、一键更新等附加逻辑。
 */
export default function UpdateSection() {
  const [u, setU] = useState<UpdateSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = async () => {
    const s = await getUpdateSettings();
    setU(s);
  };

  useEffect(() => {
    void load();
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
    }
  };

  if (!u) return null;

  const latest = u.lastResult?.latest;
  const hasUpdate = !!u.lastResult?.hasUpdate && !!latest;

  return (
    <section className="card">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-violet-500" /> 检查更新
        </h2>
        <span className="text-[11px] text-zinc-400">当前版本 v{current}</span>
      </div>
      <p className="text-xs text-zinc-500 mb-4">手动检查 GitHub Releases，看看有没有新版本可用。</p>

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
      </div>
    </section>
  );
}
