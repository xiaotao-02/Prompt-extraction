import { useEffect, useState } from 'react';
import { Download, RefreshCw, X, ExternalLink, Check } from 'lucide-react';
import { getUpdateSettings, patchUpdateSettings } from '@/lib/storage';
import { isNewerVersion } from '@/lib/version';
import type { UpdateInfo } from '@/lib/types';

interface State {
  current: string;
  latest: UpdateInfo | null;
  hasUpdate: boolean;
  dismissed: boolean;
  feedConfigured: boolean;
}

const EMPTY: State = {
  current: '',
  latest: null,
  hasUpdate: false,
  dismissed: false,
  feedConfigured: false,
};

export default function UpdateBanner() {
  const [state, setState] = useState<State>(EMPTY);
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null);
  const [tip, setTip] = useState<string | null>(null);

  const reload = async () => {
    const u = await getUpdateSettings();
    const latest = u.lastResult?.latest || null;
    const dismissed =
      !!u.dismissedVersion &&
      !!latest &&
      !isNewerVersion(latest.version, u.dismissedVersion);
    setState({
      current: u.lastResult?.current || '',
      latest,
      hasUpdate: !!u.lastResult?.hasUpdate,
      dismissed,
      feedConfigured: !!u.feedUrl?.trim(),
    });
  };

  useEffect(() => {
    void reload();
    const onChange = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area === 'sync' && changes['app_settings_v1']) void reload();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const onCheck = async () => {
    setBusy('check');
    setTip(null);
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'CHECK_UPDATE',
        payload: { force: true },
      });
      if (!resp?.ok) {
        setTip('检查失败');
      } else if (resp.result?.error) {
        setTip(resp.result.error);
      } else if (!resp.result?.hasUpdate) {
        setTip('已是最新版本');
      }
    } finally {
      setBusy(null);
      await reload();
    }
  };

  const onApply = async () => {
    setBusy('apply');
    setTip(null);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'APPLY_UPDATE' });
      if (resp?.message) setTip(resp.message);
    } finally {
      setBusy(null);
    }
  };

  const onDismiss = async () => {
    if (!state.latest) return;
    await patchUpdateSettings({ dismissedVersion: state.latest.version });
    await reload();
  };

  const visible = state.hasUpdate && !state.dismissed && !!state.latest;
  if (!visible) return null;
  const latest = state.latest!;

  return (
    <div className="px-3 py-2.5 border-b border-violet-200/70 dark:border-violet-500/30 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-500/10 dark:to-violet-500/10">
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex-none flex items-center justify-center mt-0.5">
          <Download className="w-3.5 h-3.5 text-violet-600 dark:text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
            发现新版本 v{latest.version}
            <span className="ml-1 text-[10px] font-normal text-zinc-500">
              当前 v{state.current || '?'}
            </span>
          </div>
          {latest.releaseNotes && (
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300 line-clamp-2 whitespace-pre-wrap">
              {latest.releaseNotes}
            </p>
          )}
          {tip && (
            <div className="mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <Check className="w-3 h-3" /> {tip}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1 flex-wrap">
            <button
              onClick={onApply}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-medium disabled:opacity-60"
            >
              {busy === 'apply' ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              一键更新
            </button>
            {latest.releaseUrl && (
              <a
                href={latest.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/60 dark:hover:bg-white/5 text-[11px] text-zinc-600 dark:text-zinc-300"
              >
                <ExternalLink className="w-3 h-3" /> 详情
              </a>
            )}
            <button
              onClick={onCheck}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/60 dark:hover:bg-white/5 text-[11px] text-zinc-600 dark:text-zinc-300 disabled:opacity-60"
            >
              <RefreshCw className={`w-3 h-3 ${busy === 'check' ? 'animate-spin' : ''}`} />
              重新检查
            </button>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded hover:bg-white/60 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-600"
          title="忽略此版本"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
