import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Image as ImageIcon,
  AlertCircle,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { PROVIDER_LIST, PROVIDERS } from '@/lib/providers';
import { getSettings, saveSettings } from '@/lib/storage';
import type { AppSettings, OutputStyle, ProviderConfig, ProviderId } from '@/lib/types';
import { extractPrompt, listModels } from '@/lib/api';
import UpdateSection from './UpdateSection';
import SetupGuide from './SetupGuide';
import DataPersistence from './DataPersistence';

const STYLE_OPTIONS: { value: OutputStyle; label: string; desc: string }[] = [
  { value: 'natural-zh', label: '自然语言（中文）', desc: '段落式中文描述，适合通用 AI 绘图' },
  { value: 'natural-en', label: 'Natural (English)', desc: '英文段落式描述，适合 Flux/SDXL 等' },
  { value: 'sd-tags', label: 'Stable Diffusion 标签', desc: 'Danbooru 风格英文 tag 列表' },
  { value: 'midjourney', label: 'Midjourney 风格', desc: 'MJ v6 自然语言 + 参数风格' },
];

interface Props {
  /** 父组件提供的「保存中 / 已保存」状态，按钮渲染在外层 header，方便和 Tab 切换共用。 */
  registerSaveHandler?: (handler: () => Promise<void>) => void;
  /**
   * 通知父级当前 settings 是否相对「上次落盘」有修改，
   * 父级据此把顶部按钮在「保存设置」与「已保存」之间切换。
   */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * 设置面板：模型供应商 / 输出风格 / 其他 / 联通性测试 / 自动更新。
 *
 * 这是从原 OptionsApp.tsx 抽离出来的完整设置 UI，
 * 让 OptionsApp 可以并列展示「提示词库」管理后台。
 */
export default function SettingsView({ registerSaveHandler, onDirtyChange }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /**
   * 「上次成功落盘」时的 settings 序列化快照。
   * - 与当前 settings 的序列化值比较即可得到 dirty 状态；
   * - 首次从 storage 拿到的就是落盘态，所以也算「已保存」；
   * - 所有写 storage 的路径都必须走 persistAndMark，
   *   否则会出现「按钮显示已保存，但实际未落盘」的不一致。
   */
  const [lastSavedSig, setLastSavedSig] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testImage, setTestImage] = useState(
    'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=600'
  );
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState('');

  /**
   * 记录每个 provider 在「当前会话」里已经自动拉取过的签名（apiKey|baseUrl）。
   * - 用 ref 而不是 state，避免每次写入触发额外渲染。
   * - 用 sig 作 value：当用户改 Key/URL 时签名变更，自动重新拉取。
   * - 切 provider 时按 pid 隔离，互不影响。
   */
  const autoFetchedRef = useRef<Map<ProviderId, string>>(new Map());

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setLastSavedSig(JSON.stringify(s));
    });
  }, []);

  /** 写盘 + 同步「已保存」签名，统一入口，保证按钮状态不会和真实存储脱节。 */
  const persistAndMark = useCallback(async (next: AppSettings) => {
    await saveSettings(next);
    setLastSavedSig(JSON.stringify(next));
  }, []);

  const dirty = useMemo(() => {
    if (!settings || lastSavedSig === null) return false;
    return JSON.stringify(settings) !== lastSavedSig;
  }, [settings, lastSavedSig]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    setModelFilter('');
    setFetchModelsError(null);
  }, [settings?.activeProvider]);

  // 把保存逻辑暴露给父级 header 的按钮
  useEffect(() => {
    if (!registerSaveHandler || !settings) return;
    registerSaveHandler(async () => {
      await persistAndMark(settings);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2000);
    });
  }, [registerSaveHandler, settings, persistAndMark]);

  // —— 配置完成后自动拉取模型列表 ——
  // 触发条件：当前 provider 的 apiKey + baseUrl 都已填写，且这对组合在本会话里
  // 还没被拉取过。带 1s 防抖避免「敲一下字符就发一次请求」。
  // 已有 discoveredModels 时只把签名标记为「已知」，不会重复请求，
  // 直到用户改动 apiKey 或 baseUrl 才会再次自动拉取。
  const activeProviderId = settings?.activeProvider;
  const activeApiKey = settings?.providers[settings?.activeProvider as ProviderId]?.apiKey ?? '';
  const activeBaseUrl =
    settings?.providers[settings?.activeProvider as ProviderId]?.baseUrl ?? '';
  useEffect(() => {
    if (!settings || !activeProviderId) return;
    const pid = activeProviderId;
    const cfg = settings.providers[pid];
    if (!cfg.apiKey || !cfg.baseUrl) return;
    if (cfg.apiKey.trim().length < 6) return;

    const sig = `${cfg.apiKey}|${cfg.baseUrl}`;
    // 该 provider 已经拉过模型 + 还没记账 → 标记为已知，避免一进入页面就重拉
    if (
      !autoFetchedRef.current.has(pid) &&
      (cfg.discoveredModels?.length ?? 0) > 0
    ) {
      autoFetchedRef.current.set(pid, sig);
      return;
    }
    if (autoFetchedRef.current.get(pid) === sig) return;
    if (fetchingModels) return;

    const timer = setTimeout(() => {
      autoFetchedRef.current.set(pid, sig);
      runFetchModels(pid, cfg, sig);
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProviderId, activeApiKey, activeBaseUrl]);

  const activeMeta = useMemo(
    () => (settings ? PROVIDERS[settings.activeProvider] : null),
    [settings]
  );

  /**
   * 下拉框展示的模型列表 = 从端点 `/models` 拉到的模型。
   * - 不再混入「内置推荐」，避免一些中转站实际没上线但内置写死的模型造成误导；
   * - 当前选中的 model 若不在列表里，会通过「__custom__」选项进入自定义输入；
   * - 端点尚未拉取过时（列表为空），下方会自动 fallback 到纯文本输入框。
   *
   * 必须放在「加载中」早期 return 之前，否则两次渲染的 hook 数量不一致，
   * 会触发 React error #310（Rendered fewer/more hooks than during the previous render）。
   */
  const combinedModelOptions = useMemo(() => {
    if (!settings) return [];
    const cfg = settings.providers[settings.activeProvider];
    return cfg?.discoveredModels ?? [];
  }, [settings]);

  if (!settings || !activeMeta) {
    return <div className="p-8 text-sm text-zinc-500">加载中…</div>;
  }

  const activeCfg = settings.providers[settings.activeProvider];

  const updateActiveCfg = (patch: Partial<typeof activeCfg>) => {
    setSettings({
      ...settings,
      providers: {
        ...settings.providers,
        [settings.activeProvider]: { ...activeCfg, ...patch },
      },
    });
  };

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await persistAndMark(settings);
      const r = await extractPrompt({ imageUrl: testImage, settings });
      setTestResult({ ok: true, msg: r.prompt });
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  /**
   * 拉取并落盘指定 provider 的模型列表。
   *
   * 抽成独立函数后，「手动按钮」与「配置后自动拉取」共用同一份逻辑，
   * 同时通过 setSettings 的函数式更新避免与并发编辑产生竞态：
   * 拉取完成时只有在 pid 与 apiKey|baseUrl 没被中途改动时才会落盘。
   */
  const runFetchModels = async (pid: ProviderId, cfg: ProviderConfig, sig: string) => {
    setFetchingModels(true);
    setFetchModelsError(null);
    try {
      const models = await listModels(cfg, pid);
      let persisted: AppSettings | null = null;
      setSettings((prev) => {
        if (!prev) return prev;
        if (prev.activeProvider !== pid) return prev;
        const cur = prev.providers[pid];
        if (`${cur.apiKey}|${cur.baseUrl}` !== sig) return prev;
        const next: AppSettings = {
          ...prev,
          providers: {
            ...prev.providers,
            [pid]: { ...cur, discoveredModels: models, discoveredAt: Date.now() },
          },
        };
        persisted = next;
        return next;
      });
      if (persisted) {
        await persistAndMark(persisted);
      }
    } catch (e) {
      setFetchModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingModels(false);
    }
  };

  const onFetchModels = async () => {
    if (!settings) return;
    const pid = settings.activeProvider;
    const sig = `${activeCfg.apiKey}|${activeCfg.baseUrl}`;
    autoFetchedRef.current.set(pid, sig);
    await runFetchModels(pid, activeCfg, sig);
  };

  const onClearDiscovered = async () => {
    const next: AppSettings = {
      ...settings,
      providers: {
        ...settings.providers,
        [settings.activeProvider]: {
          ...activeCfg,
          discoveredModels: undefined,
          discoveredAt: undefined,
        },
      },
    };
    setSettings(next);
    await persistAndMark(next);
    setModelFilter('');
    setFetchModelsError(null);
  };

  const discovered = activeCfg.discoveredModels ?? [];
  const lowerFilter = modelFilter.trim().toLowerCase();
  const filteredDiscovered = lowerFilter
    ? discovered.filter((m) => m.toLowerCase().includes(lowerFilter))
    : discovered;

  const applyConfig = async (next: AppSettings) => {
    setSettings(next);
    await persistAndMark(next);
    setSavedAt(Date.now());
    setTimeout(() => setSavedAt(null), 2000);
  };

  return (
    <div className="space-y-6">
      {savedAt && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 px-4 py-2 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <Check className="w-4 h-4" /> 设置已保存
        </div>
      )}

      {/* 数据持久化：卸载/重装/换机后能拿回数据的核心保险（FSA 数据目录 + 手动导入导出） */}
      <DataPersistence
        onDataRestored={async () => {
          const next = await getSettings();
          setSettings(next);
        }}
      />

      {/* 配置指南：去掉内置默认 API 后，引导用户自带 Key 完成配置 */}
      <SetupGuide settings={settings} applyConfig={applyConfig} />

      {/* 模型供应商 */}
      <section className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">模型供应商</h2>
            <p className="text-xs text-zinc-500 mt-0.5">选择用于识别图片的视觉大模型</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-5">
          {PROVIDER_LIST.map((p) => {
            const active = settings.activeProvider === p.id;
            return (
              <button
                key={p.id}
                onClick={() =>
                  setSettings({ ...settings, activeProvider: p.id as ProviderId })
                }
                className={`text-left p-3 rounded-xl border transition relative ${
                  active
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10 ring-2 ring-violet-500/20'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">
                  {p.description}
                </div>
                {active && (
                  <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          <div>
            <label className="label flex items-center justify-between">
              <span>API Key</span>
              {activeMeta.docsUrl && (
                <a
                  href={activeMeta.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-violet-500 hover:underline inline-flex items-center gap-1"
                >
                  去申请 <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showKey ? 'text' : 'password'}
                value={activeCfg.apiKey}
                placeholder="sk-..."
                onChange={(e) => updateActiveCfg({ apiKey: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Base URL</label>
              <input
                className="input"
                value={activeCfg.baseUrl}
                onChange={(e) => updateActiveCfg({ baseUrl: e.target.value })}
                placeholder={activeMeta.defaultBaseUrl}
              />
            </div>
            <div>
              <label className="label flex items-center justify-between">
                <span>模型</span>
                <button
                  type="button"
                  onClick={onFetchModels}
                  disabled={fetchingModels || !activeCfg.baseUrl}
                  className="text-violet-500 hover:underline disabled:opacity-50 disabled:no-underline inline-flex items-center gap-1"
                  title="从该端点 /models 接口拉取所有可用模型"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${fetchingModels ? 'animate-spin' : ''}`}
                  />
                  {fetchingModels ? '拉取中…' : '从端点拉取'}
                </button>
              </label>
              {combinedModelOptions.length > 0 ? (
                <select
                  className="input"
                  value={
                    combinedModelOptions.includes(activeCfg.model)
                      ? activeCfg.model
                      : '__custom__'
                  }
                  onChange={(e) => {
                    if (e.target.value === '__custom__') return;
                    updateActiveCfg({ model: e.target.value });
                  }}
                >
                  {discovered.length > 0 && (
                    <optgroup
                      label={`端点拉取（${discovered.length}）${
                        activeCfg.discoveredAt
                          ? ' · ' + formatTimeAgo(activeCfg.discoveredAt)
                          : ''
                      }`}
                    >
                      {discovered.map((m) => (
                        <option key={`fetched-${m}`} value={m}>
                          {m}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <option value="__custom__">自定义...</option>
                </select>
              ) : (
                <input
                  className="input"
                  value={activeCfg.model}
                  onChange={(e) => updateActiveCfg({ model: e.target.value })}
                  placeholder={activeMeta.defaultModel}
                />
              )}
              {combinedModelOptions.length > 0 &&
                !combinedModelOptions.includes(activeCfg.model) && (
                  <input
                    className="input mt-2"
                    value={activeCfg.model}
                    onChange={(e) => updateActiveCfg({ model: e.target.value })}
                    placeholder="输入自定义模型名"
                  />
                )}
            </div>
          </div>

          {/* 端点模型列表 */}
          {(discovered.length > 0 || fetchModelsError) && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/50 p-3 space-y-2">
              {fetchModelsError && (
                <div className="text-[11px] leading-snug px-2.5 py-1.5 rounded-md bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 whitespace-pre-wrap break-words">
                  {fetchModelsError}
                </div>
              )}
              {discovered.length > 0 && (
                <>
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>
                      端点共发现 <b className="text-zinc-700 dark:text-zinc-200">
                        {discovered.length}
                      </b>{' '}
                      个模型
                      {activeCfg.discoveredAt && (
                        <span className="ml-1 text-zinc-400">
                          · {formatTimeAgo(activeCfg.discoveredAt)}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={onClearDiscovered}
                      className="text-zinc-400 hover:text-rose-500 inline-flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> 清空缓存
                    </button>
                  </div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      className="input pl-8"
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      placeholder={`搜索模型名，例如 gpt-4o / claude / vl…（共 ${discovered.length} 条）`}
                    />
                  </div>
                  <div className="max-h-[220px] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 divide-y divide-zinc-100 dark:divide-zinc-800">
                    {filteredDiscovered.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-zinc-400 text-center">
                        没有匹配「{modelFilter}」的模型
                      </div>
                    ) : (
                      filteredDiscovered.map((m) => {
                        const active = activeCfg.model === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => updateActiveCfg({ model: m })}
                            className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 transition ${
                              active
                                ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-200'
                                : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300'
                            }`}
                          >
                            <span className="truncate font-mono">{m}</span>
                            {active && (
                              <Check className="w-3.5 h-3.5 text-violet-500 flex-none" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-400 leading-snug">
                    点击任意一行即可切换为该模型；中转站通常会把所有可用模型都列在这里。
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 输出风格 */}
      <section className="card">
        <h2 className="text-sm font-semibold mb-1">输出风格</h2>
        <p className="text-xs text-zinc-500 mb-4">决定生成的提示词使用什么语言和格式</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {STYLE_OPTIONS.map((s) => {
            const active = settings.outputStyle === s.value;
            return (
              <button
                key={s.value}
                onClick={() => setSettings({ ...settings, outputStyle: s.value })}
                className={`text-left p-3 rounded-xl border transition ${
                  active
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
                }`}
              >
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{s.desc}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          <label className="label">额外提示词（可选）</label>
          <textarea
            className="input min-h-[200px] resize-y leading-relaxed font-mono text-[13px]"
            placeholder="例如：注重画面氛围与光影描写；输出不超过 100 字。&#10;可以多行输入，详细描述你想要的提示词风格、约束和示例。"
            value={settings.customPromptTemplate}
            onChange={(e) =>
              setSettings({ ...settings, customPromptTemplate: e.target.value })
            }
          />
          <p className="text-[11px] text-zinc-400 mt-1.5">
            这段内容会拼接到系统提示词末尾，用来微调输出风格或追加规则。
          </p>
        </div>
      </section>

      {/* 其他 */}
      <section className="card">
        <h2 className="text-sm font-semibold mb-3">其他</h2>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={settings.saveHistory}
            onChange={(e) =>
              setSettings({ ...settings, saveHistory: e.target.checked })
            }
            className="w-4 h-4 accent-violet-500"
          />
          <div>
            <div className="text-sm">保存历史记录</div>
            <div className="text-xs text-zinc-500">
              最近 300 条提取记录会保存在浏览器本地，可在「提示词库」中管理
            </div>
          </div>
        </label>
      </section>

      {/* 测试 */}
      <section className="card">
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-violet-500" /> 联通性测试
        </h2>
        <p className="text-xs text-zinc-500 mb-3">用一张图片快速验证当前配置是否可用</p>
        <input
          className="input"
          value={testImage}
          onChange={(e) => setTestImage(e.target.value)}
          placeholder="测试图片 URL"
        />
        <div className="mt-3 flex items-center gap-2">
          <button className="btn-primary" disabled={testing} onClick={onTest}>
            {testing ? '测试中…' : '运行测试'}
          </button>
          {testResult && (
            <span
              className={`text-xs flex items-center gap-1 ${
                testResult.ok ? 'text-emerald-500' : 'text-rose-500'
              }`}
            >
              {testResult.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {testResult.ok ? '调用成功' : '失败'}
            </span>
          )}
        </div>
        {testResult && (
          <pre className="mt-3 text-xs whitespace-pre-wrap p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 max-h-[420px] overflow-auto leading-relaxed">
            {testResult.msg}
          </pre>
        )}
      </section>

      <UpdateSection />

      <footer className="text-xs text-zinc-400 dark:text-zinc-500 py-6 space-y-2 leading-relaxed">
        <div className="text-center">
          数据仅保存在你的浏览器本地，不会上传到任何第三方服务器。
        </div>
        <div className="max-w-2xl mx-auto rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-800 p-3 space-y-1">
          <div className="font-medium text-zinc-500 dark:text-zinc-400">关于数据丢失风险</div>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>
              <b>更新插件不会丢</b>：商店推送的版本更新、`npm run build` 重新加载，
              chrome.storage 都会原样保留。
            </li>
            <li>
              <b>只有这三种情况才会丢</b>：① 你在 chrome://extensions 主动点「移除」；
              ② 扩展 ID 变了（不同安装来源并存）；③ 换电脑且没登录同一个 Google 账号。
            </li>
            <li>
              <b>怎么彻底防丢</b>：在上面的「数据持久化」里挑一个数据目录 ——
              即便插件被删，目录里的 JSON 文件还在；重装后选回去就能完整还原。
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}

function formatTimeAgo(t: number): string {
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚拉取';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
