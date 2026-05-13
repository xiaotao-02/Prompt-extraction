import { useMemo, useState } from 'react';
import {
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  ClipboardCheck,
  ClipboardPaste,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { PROVIDER_LIST, PROVIDERS } from '@/lib/providers';
import type { AppSettings, ProviderConfig, ProviderId } from '@/lib/types';

interface Props {
  settings: AppSettings;
  /**
   * 导入或修改配置后，调用方负责把新配置写入 React state 并持久化到 chrome.storage。
   * 设计为 async 以便父级在异步持久化期间禁用按钮。
   */
  applyConfig: (next: AppSettings) => Promise<void>;
}

/**
 * 「配置指南」面板：
 * - 顶部用一段醒目状态告诉用户当前是否完成 API 配置；未配置时强提示。
 * - 折叠区列出 4 步上手流程 + 各家 provider 的申请入口快速链接。
 * - 「一键导入 / 复制配置」用 JSON 串完成配置的迁移与备份。
 *
 * 这个组件是 SettingsView 的顶部入口，目的是替代原先"开箱即用内置 Key"，
 * 引导用户自带 Key 完成配置。
 */
export default function SetupGuide({ settings, applyConfig }: Props) {
  const activeCfg = settings.providers[settings.activeProvider];
  const hasKey = Boolean(activeCfg.apiKey && activeCfg.apiKey.trim().length > 0);

  // 默认展开：没填 Key 时强制展开并保持；填好后默认折叠。
  const [open, setOpen] = useState<boolean>(!hasKey);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importHint, setImportHint] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const activeMeta = PROVIDERS[settings.activeProvider];

  // 复制按钮导出"当前激活 provider"的精简片段，方便分享与粘贴。
  const exportSnippet = useMemo(() => {
    const snippet = {
      provider: settings.activeProvider,
      apiKey: activeCfg.apiKey,
      baseUrl: activeCfg.baseUrl,
      model: activeCfg.model,
    };
    return JSON.stringify(snippet, null, 2);
  }, [settings.activeProvider, activeCfg.apiKey, activeCfg.baseUrl, activeCfg.model]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 部分浏览器在非 https / 非 user gesture 下可能 deny，这里降级到 prompt。
      window.prompt('复制下方文本到剪贴板：', exportSnippet);
    }
  };

  const onPasteFromClipboard = async () => {
    setImportError(null);
    setImportHint(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text) setImportText(text);
    } catch {
      setImportError('无法读取剪贴板，请手动粘贴 JSON 配置到下方输入框。');
    }
  };

  const onImport = async () => {
    setImportError(null);
    setImportHint(null);
    const raw = importText.trim();
    if (!raw) {
      setImportError('请先粘贴一段 JSON 配置。');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setImportError(`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      setImportError('JSON 顶层必须是对象。');
      return;
    }

    const next = applyImportedConfig(settings, parsed as Record<string, unknown>);
    if ('error' in next) {
      setImportError(next.error);
      return;
    }

    setImporting(true);
    try {
      await applyConfig(next.value);
      setImportHint(next.hint);
      setImportText('');
    } catch (e) {
      setImportError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <section
      className={`rounded-2xl border p-5 transition ${
        hasKey
          ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-500/5'
          : 'border-amber-300 dark:border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/10'
      }`}
    >
      {/* 状态头 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-none ${
              hasKey
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
            }`}
          >
            {hasKey ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold flex items-center gap-2">
              {hasKey ? 'API 已配置' : '未配置 API'}
              <span className="text-[11px] font-normal text-zinc-500">
                · 当前供应商：{activeMeta?.label || settings.activeProvider}
              </span>
            </div>
            <div className="text-xs text-zinc-500 mt-0.5 truncate">
              {hasKey
                ? '提示词提取已就绪。点击展开查看配置说明 / 备份配置。'
                : '插件不再自带任何默认 Key，请按下方步骤完成配置后才能使用。'}
            </div>
          </div>
        </div>
        <div className="flex-none text-zinc-400">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {open && (
        <div className="mt-5 space-y-5">
          {/* 配置说明 */}
          <div>
            <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 mb-2">
              <KeyRound className="w-3.5 h-3.5 text-violet-500" />
              配置 API 的 4 个步骤
            </h3>
            <ol className="space-y-2 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <Step n={1}>
                在下方「模型供应商」中挑选一家你想用的 provider（OpenAI / Anthropic / Gemini /
                智谱 / 通义 / 硅基流动 等）。
              </Step>
              <Step n={2}>
                点击该 provider 卡片旁的「去申请」链接，在官网创建 API Key 并复制。
              </Step>
              <Step n={3}>
                把 Key 粘贴到「API Key」输入框，必要时调整 Base URL 和模型，然后点右上角「保存设置」。
              </Step>
              <Step n={4}>
                在下方「联通性测试」点击「运行测试」，看到「调用成功」即可去任意网页右键图片使用。
              </Step>
            </ol>

            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {PROVIDER_LIST.filter((p) => p.docsUrl).map((p) => (
                <a
                  key={p.id}
                  href={p.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/60 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-300 text-[11px] transition"
                  title={`去 ${p.label} 官网申请 API Key`}
                >
                  <span className="truncate">{p.label}</span>
                  <ExternalLink className="w-3 h-3 flex-none text-zinc-400 group-hover:text-violet-500" />
                </a>
              ))}
            </div>

            <p className="mt-3 text-[11px] text-zinc-500 leading-snug">
              · 推荐新手优先选「智谱 GLM」的 <code className="font-mono">glm-4v-flash</code>
              ，国内可直连且有免费额度。<br />
              · API Key 只保存在你的浏览器（通过 <code className="font-mono">chrome.storage.sync</code>
              ），插件不会上报给作者或任何第三方服务器。
            </p>
          </div>

          {/* 一键导入 / 复制 */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                一键配置（粘贴 JSON 导入 / 复制当前配置）
              </h3>
              <button
                type="button"
                onClick={onCopy}
                className="text-[11px] inline-flex items-center gap-1 text-violet-600 dark:text-violet-300 hover:underline disabled:opacity-50"
                disabled={!hasKey}
                title={hasKey ? '复制当前激活 provider 的配置（含 API Key）' : '还没填 API Key，无可复制内容'}
              >
                {copied ? (
                  <>
                    <ClipboardCheck className="w-3.5 h-3.5" /> 已复制
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="w-3.5 h-3.5" /> 复制当前配置
                  </>
                )}
              </button>
            </div>

            <textarea
              className="input min-h-[120px] font-mono text-[12px] resize-y leading-relaxed"
              placeholder={`粘贴 JSON 配置串，支持三种格式：
{
  "provider": "openai",
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini"
}

或多 provider 整体：
{
  "activeProvider": "openai",
  "providers": {
    "openai": { "apiKey": "sk-...", "baseUrl": "...", "model": "..." }
  }
}

或 NewAPI 中转站「渠道连接」信息（自动识别站点）：
{
  "_type": "newapi_channel_conn",
  "key": "sk-...",
  "url": "https://ai.shukelongda.cn"
}`}
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportError(null);
                setImportHint(null);
              }}
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={onImport}
                disabled={importing}
              >
                {importing ? '导入中…' : '一键导入'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={onPasteFromClipboard}
                disabled={importing}
              >
                <ClipboardPaste className="w-4 h-4" /> 从剪贴板粘贴
              </button>
              {importHint && (
                <span className="text-[11px] text-emerald-600 dark:text-emerald-300 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {importHint}
                </span>
              )}
            </div>

            {importError && (
              <div className="text-[11px] leading-snug px-2.5 py-1.5 rounded-md bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 whitespace-pre-wrap break-words">
                {importError}
              </div>
            )}

            <p className="text-[10px] text-zinc-400 leading-snug">
              · 导入后会立即保存并切换到该 provider；其它 provider 的配置保持不变。<br />
              · 复制出的 JSON 包含 API Key，请谨慎分享。
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="flex-none w-5 h-5 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300 text-[11px] font-semibold flex items-center justify-center">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * 把外部传入的 JSON 对象合并到现有 AppSettings。
 *
 * 支持三种顶层格式：
 * 1) 单 provider 片段：{ provider, apiKey, baseUrl, model }
 * 2) 多 provider 整体：{ activeProvider?, providers: { [id]: { apiKey, baseUrl?, model? } } }
 * 3) NewAPI 中转站「渠道连接」：{ _type: "newapi_channel_conn", key, url }
 *    会自动按 url 的 hostname 匹配已知 provider（匹配不到回落到 `custom`），
 *    并且当 url 只是裸域名时自动补 `/v1` 以兼容 OpenAI 协议。
 *
 * 返回 discriminated union，调用方根据 `error` 判断是否失败。
 */
function applyImportedConfig(
  base: AppSettings,
  raw: Record<string, unknown>
): { value: AppSettings; hint: string } | { error: string } {
  const validIds = new Set<ProviderId>(PROVIDER_LIST.map((p) => p.id));

  // —— NewAPI「渠道连接」信息：{ _type: "newapi_channel_conn", key, url }
  if (raw._type === 'newapi_channel_conn') {
    const apiKey = typeof raw.key === 'string' ? raw.key.trim() : '';
    const rawUrl = typeof raw.url === 'string' ? raw.url.trim() : '';
    if (!apiKey) {
      return { error: '导入失败：newapi_channel_conn 缺少 key 字段或为空。' };
    }
    if (!rawUrl) {
      return { error: '导入失败：newapi_channel_conn 缺少 url 字段或为空。' };
    }
    const baseUrl = ensureOpenAIBase(rawUrl);
    const pid = matchProviderByUrl(rawUrl) ?? 'custom';
    const prev = base.providers[pid];
    const meta = PROVIDERS[pid];
    const merged: ProviderConfig = {
      ...prev,
      id: pid,
      apiKey,
      baseUrl,
      model: prev.model && prev.model.trim() ? prev.model : meta.defaultModel,
    };
    return {
      value: {
        ...base,
        activeProvider: pid,
        providers: { ...base.providers, [pid]: merged },
      },
      hint:
        pid === 'custom'
          ? `已识别 NewAPI 中转「${baseUrl}」并导入到「自定义」。如需切换 provider 可在下方调整。`
          : `已识别为「${meta.label}」并导入配置（${baseUrl}）。`,
    };
  }

  // —— 单 provider 片段
  if (typeof raw.provider === 'string') {
    const pid = raw.provider as ProviderId;
    if (!validIds.has(pid)) {
      return { error: `未知的 provider："${pid}"，可选值：${Array.from(validIds).join(' / ')}` };
    }
    const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
    if (!apiKey) {
      return { error: '导入失败：缺少 apiKey 字段或为空。' };
    }
    const prev = base.providers[pid];
    const merged: ProviderConfig = {
      ...prev,
      id: pid,
      apiKey,
      baseUrl:
        typeof raw.baseUrl === 'string' && raw.baseUrl.trim()
          ? raw.baseUrl.trim()
          : prev.baseUrl,
      model:
        typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : prev.model,
    };
    return {
      value: {
        ...base,
        activeProvider: pid,
        providers: { ...base.providers, [pid]: merged },
      },
      hint: `已导入 ${PROVIDERS[pid]?.label || pid} 的配置并切换为当前供应商。`,
    };
  }

  // —— 多 provider 整体
  if (raw.providers && typeof raw.providers === 'object') {
    const incoming = raw.providers as Record<string, Record<string, unknown>>;
    const nextProviders = { ...base.providers };
    const touched: ProviderId[] = [];
    for (const k of Object.keys(incoming)) {
      if (!validIds.has(k as ProviderId)) continue;
      const pid = k as ProviderId;
      const v = incoming[k] || {};
      const prev = base.providers[pid];
      nextProviders[pid] = {
        ...prev,
        id: pid,
        apiKey: typeof v.apiKey === 'string' ? v.apiKey.trim() : prev.apiKey,
        baseUrl:
          typeof v.baseUrl === 'string' && (v.baseUrl as string).trim()
            ? (v.baseUrl as string).trim()
            : prev.baseUrl,
        model:
          typeof v.model === 'string' && (v.model as string).trim()
            ? (v.model as string).trim()
            : prev.model,
      };
      touched.push(pid);
    }
    if (touched.length === 0) {
      return { error: 'providers 中没有任何受支持的 provider id。' };
    }
    const wantActive =
      typeof raw.activeProvider === 'string' && validIds.has(raw.activeProvider as ProviderId)
        ? (raw.activeProvider as ProviderId)
        : touched[0];
    return {
      value: {
        ...base,
        activeProvider: wantActive,
        providers: nextProviders,
      },
      hint: `已导入 ${touched.length} 个 provider 的配置，当前供应商：${
        PROVIDERS[wantActive]?.label || wantActive
      }`,
    };
  }

  return {
    error:
      '无法识别的 JSON 结构。请提供 { provider, apiKey, baseUrl?, model? }、{ providers: {...} } 或 { _type: "newapi_channel_conn", key, url }。',
  };
}

/**
 * 把 NewAPI 渠道里粘出来的 url 归一化成 OpenAI 兼容的 baseUrl。
 *
 * NewAPI 自带的渠道连接信息通常给的是站点根地址（如 `https://ai.shukelongda.cn`），
 * 但 OpenAI 兼容协议的 chat/completions 路径需要挂在 `/v1` 下。
 * 这里只在 pathname 为空 / `/` 时补 `/v1`，避免破坏带租户路径的端点
 * （如 `…/api/paas/v4`、`…/compatible-mode/v1`）。
 */
function ensureOpenAIBase(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  try {
    const u = new URL(trimmed);
    if (u.pathname === '' || u.pathname === '/') {
      return `${u.origin}/v1`;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * 按 hostname 把外部 url 映射到一个内置 provider。
 *
 * 用于「一键导入」场景：用户从 NewAPI 中转粘贴的 `url` 经常正好对应某个内置
 * provider 的官方域名（例如 `ai.shukelongda.cn` → `shukelongda`），
 * 这种情况下应该直接切换到对应 provider，让用户继承默认模型选项与文档链接。
 *
 * 匹配不到时返回 null，调用方可以回落到 `custom`。
 */
function matchProviderByUrl(url: string): ProviderId | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  for (const p of PROVIDER_LIST) {
    if (p.id === 'custom') continue;
    try {
      const phost = new URL(p.defaultBaseUrl).hostname.toLowerCase();
      if (phost === host) return p.id;
    } catch {
      continue;
    }
  }
  return null;
}
