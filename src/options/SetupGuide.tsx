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
  Sparkles,
} from 'lucide-react';
import { PROVIDERS } from '@/lib/providers';
import { importFromText } from '@/lib/configImport';
import type { AppSettings } from '@/lib/types';

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

    const result = importFromText(settings, importText);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }

    setImporting(true);
    try {
      await applyConfig(result.settings);
      setImportHint(result.hint);
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
              配置 API 的 3 个步骤
            </h3>
            <ol className="space-y-2 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <Step n={1}>
                在下方「模型供应商」中挑选一家 provider，或选「自定义」接入任意 OpenAI 兼容端点。
              </Step>
              <Step n={2}>
                点击该 provider 卡片旁的「去申请」链接，在官网创建 API Key 并复制。
              </Step>
              <Step n={3}>
                把 Key 粘贴到「API Key」输入框，必要时调整 Base URL 和模型，然后点右上角「保存设置」。保存后即可在任意网页右键图片使用扩展。
              </Step>
            </ol>

            <p className="mt-3 text-[11px] text-zinc-500 leading-snug">
              · 推荐新手优先选「智谱 GLM」的 <code className="font-mono">glm-4v-flash</code>
              ，国内可直连且有免费额度。
            </p>
          </div>

          {/* 一键导入 / 复制 */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                一键配置（API Key / curl / JSON / 复制当前配置）
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
              className="input min-h-[120px] font-mono text-[12px] resize-y leading-[1.6]"
              placeholder={`可直接粘贴控制台复制的 API Key（自动识别 Anthropic / Gemini / OpenRouter 等格式）；
未识别出专属前缀时，将写入当前在下方选中的供应商（请先看准厂商再粘贴）。
也支持 curl 与 JSON，例如：
curl https://api.openai.com/v1/... -H "Authorization: Bearer sk-..."
{ "provider": "deepseek", "apiKey": "sk-...", "model": "deepseek-chat" }`}
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
              · 仅粘贴 Key 时：能辨认前缀则自动切到对应厂商；否则写入当前选中的供应商（「自定义」且 baseUrl 为占位时请改用 JSON/curl 或先选具体厂商）。<br />
              · 粘 curl 时支持 Bearer / x-api-key / X-goog-api-key 等鉴权方式，会自动识别厂商并截取 baseUrl。<br />
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

// 配置导入解析（字段同义词 / provider 模糊匹配 / NewAPI 等多种格式）已统一搬到
// `@/lib/configImport`，这里只负责 UI 编排。
