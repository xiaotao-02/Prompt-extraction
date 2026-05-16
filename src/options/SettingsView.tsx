import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  PROVIDER_LIST_EXTENDED,
  PROVIDER_LIST_FEATURED,
  PROVIDERS,
} from '@/lib/providers';
import {
  getSettings,
  saveSettings,
  addUserStrategyPreset,
  applyUserStrategyPresetToSettings,
  briefUserPresetFingerprint,
  buildUserStrategyPresetFromSettings,
  getUserStrategyPresets,
  isSettingsMatchingUserPreset,
  MAX_USER_STRATEGY_PRESETS,
  MAX_PRESET_NAME_LEN,
  removeUserStrategyPreset,
  updateUserStrategyPresetName,
} from '@/lib/storage';
import { SETTINGS_KEY, USER_STRATEGY_PRESETS_KEY } from '@/lib/storage/keys';
import {
  getStrategyList,
  resolveCustomStrategy,
  STYLE_PROMPT_SETS,
  SAMPLING_PROFILES,
  CUSTOM_JOINS,
} from '@/lib/strategies';
import type {
  StylePromptSetVersion,
  SamplingVersion,
  CustomJoinVersion,
  StrategyComponents,
} from '@/lib/strategies-meta';
import type {
  AppSettings,
  OneClickRewriteRandomness,
  OutputStyle,
  ProviderConfig,
  ProviderId,
  ProviderMeta,
  UserStrategyPreset,
} from '@/lib/types';
import { normalizeOneClickRewriteRandomness } from '@/lib/oneClickRewrite';
import { listModels } from '@/lib/api';
import UpdateSection from './UpdateSection';
import SetupGuide from './SetupGuide';
import DataPersistence from './DataPersistence';

const STYLE_OPTIONS: { value: OutputStyle; label: string; desc: string }[] = [
  { value: 'natural-zh', label: '自然语言（中文）', desc: '段落式中文描述，适合通用 AI 绘图' },
  { value: 'natural-en', label: 'Natural (English)', desc: '英文段落式描述，适合 Flux/SDXL 等' },
  { value: 'sd-tags', label: 'Stable Diffusion 标签', desc: 'Danbooru 风格英文 tag 列表' },
  { value: 'midjourney', label: 'Midjourney 风格', desc: 'MJ v6 自然语言 + 参数风格' },
];

type SettingsPanelId =
  | 'provider'
  | 'output'
  | 'strategy'
  | 'data'
  | 'updates';

const SETTINGS_PANEL_STORAGE_KEY = 'options_settings_panel_v1';

function isSettingsPanelId(v: string | null): v is SettingsPanelId {
  return (
    v === 'provider' ||
    v === 'output' ||
    v === 'strategy' ||
    v === 'data' ||
    v === 'updates'
  );
}

const SETTINGS_PANEL_NAV: { id: SettingsPanelId; label: string }[] = [
  { id: 'provider', label: '模型与连接' },
  { id: 'output', label: '输出与交互' },
  { id: 'strategy', label: '策略版本' },
  { id: 'data', label: '数据与备份' },
  { id: 'updates', label: '扩展更新' },
];

function settingsPanelNavButtonClass(active: boolean, compact: boolean) {
  const base =
    'transition text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900';
  const size = compact
    ? 'shrink-0 whitespace-nowrap px-3 py-1.5 text-xs rounded-lg'
    : 'w-full px-3 py-2 text-sm rounded-lg';
  const tone = active
    ? 'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-200 font-medium'
    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/90 dark:hover:bg-zinc-800/80';
  return `${base} ${size} ${tone}`;
}

const REWRITE_RANDOMNESS_OPTIONS: {
  value: OneClickRewriteRandomness;
  label: string;
  desc: string;
}[] = [
  {
    value: 'subtle',
    label: '轻度',
    desc: '保留主体与构图骨架，主要微调措辞、光影与轻微配色变化。',
  },
  {
    value: 'moderate',
    label: '中度',
    desc: '主体呈现、色调、构图与元素多项可见变化，同类题材内可重组。',
  },
  {
    value: 'bold',
    label: '强烈',
    desc: '同一大类用途下可大幅更换呈现方式、配色与构图，探索激进变体。',
  },
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
 * 设置面板：模型供应商 / 输出风格 / 其他 / 自动更新。
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
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState('');
  /** 「更多供应商」折叠区：选中小众厂商时会在 effect 里自动展开 */
  const [showExtendedProviders, setShowExtendedProviders] = useState(false);
  /** 左侧导航当前面板；持久化便于反复进入同一分类。默认「模型与连接」。 */
  const [panelId, setPanelId] = useState<SettingsPanelId>(() => {
    try {
      const raw = sessionStorage.getItem(SETTINGS_PANEL_STORAGE_KEY);
      if (raw === 'setup') return 'provider';
      if (isSettingsPanelId(raw)) return raw;
    } catch {
      /* ignore */
    }
    return 'provider';
  });
  const [userPresets, setUserPresets] = useState<UserStrategyPreset[]>([]);
  /**
   * 策略选择器的渲染数据。`getStrategyList()` 内部会逐档解析组件版本（读
   * STYLE_PROMPT_SETS 等大对象），整页只算一次就够了，所以用 useMemo 钉死 ——
   * useMemo 的零依赖 deps 数组保证它只在组件挂载时跑一次。
   */
  const strategyList = useMemo(() => getStrategyList(), []);

  const extendedProviderIds = useMemo(
    () => new Set(PROVIDER_LIST_EXTENDED.map((p) => p.id)),
    []
  );

  /**
   * 当前激活若是「更多」分组里的厂商，自动展开网格，避免看不到选中卡片。
   */
  useEffect(() => {
    const ap = settings?.activeProvider;
    if (ap == null) return;
    if (extendedProviderIds.has(ap)) {
      setShowExtendedProviders(true);
    }
  }, [settings?.activeProvider, extendedProviderIds]);

  /**
   * 记录每个 provider 在「当前会话」里已经自动拉取过的签名（apiKey|baseUrl）。
   * - 用 ref 而不是 state，避免每次写入触发额外渲染。
   * - 用 sig 作 value：当用户改 Key/URL 时签名变更，自动重新拉取。
   * - 切 provider 时按 pid 隔离，互不影响。
   */
  const autoFetchedRef = useRef<Map<ProviderId, string>>(new Map());
  const settingsRef = useRef<AppSettings | null>(null);
  const lastSavedSigRef = useRef<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    lastSavedSigRef.current = lastSavedSig;
  }, [lastSavedSig]);

  useEffect(() => {
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      _area: chrome.storage.AreaName
    ) => {
      if (!(SETTINGS_KEY in changes)) return;
      void getSettings().then((fresh) => {
        const prev = settingsRef.current;
        const sig = lastSavedSigRef.current;
        if (prev === null || sig === null) {
          setSettings(fresh);
          setLastSavedSig(JSON.stringify(fresh));
          return;
        }
        const isDirty = JSON.stringify(prev) !== sig;
        if (!isDirty) {
          setSettings(fresh);
          setLastSavedSig(JSON.stringify(fresh));
        } else {
          setSettings({
            ...prev,
            promptStrategy: fresh.promptStrategy,
            oneClickRewriteRandomness: normalizeOneClickRewriteRandomness(
              fresh.oneClickRewriteRandomness
            ),
          });
        }
      });
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

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

  useEffect(() => {
    void getUserStrategyPresets().then(setUserPresets);
  }, []);

  useEffect(() => {
    const handler = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: chrome.storage.AreaName
    ) => {
      if (area !== 'local') return;
      if (!(USER_STRATEGY_PRESETS_KEY in changes)) return;
      void getUserStrategyPresets().then(setUserPresets);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(SETTINGS_PANEL_STORAGE_KEY, panelId);
    } catch {
      /* ignore */
    }
  }, [panelId]);

  const matchesAnySavedPreset = useMemo(() => {
    if (!settings) return false;
    return userPresets.some((p) => isSettingsMatchingUserPreset(settings, p));
  }, [settings, userPresets]);

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

  const moreCount = PROVIDER_LIST_EXTENDED.length;

  const renderProviderCard = (p: ProviderMeta) => {
    const active = settings.activeProvider === p.id;
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => setSettings({ ...settings, activeProvider: p.id as ProviderId })}
        className={`text-left px-2.5 py-2 rounded-xl border transition relative ${
          active
            ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10 ring-2 ring-violet-500/20'
            : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
        }`}
        title={p.description}
      >
        <div className="text-sm font-medium pr-5">{p.label}</div>
        {active && (
          <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center">
            <Check className="w-2.5 h-2.5 text-white" />
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {savedAt && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 px-4 py-2 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <Check className="w-4 h-4" /> 设置已保存
        </div>
      )}

      <div className="card !p-0 overflow-hidden flex flex-col min-h-[50vh] lg:flex-row lg:max-h-[min(920px,calc(100dvh-11rem))]">
        <div className="lg:hidden shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/85 dark:bg-zinc-950/50 px-2 py-2">
          <div
            role="tablist"
            aria-label="设置分类"
            className="flex gap-1 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]"
          >
            {SETTINGS_PANEL_NAV.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={panelId === id}
                aria-controls="settings-main-panel"
                onClick={() => setPanelId(id)}
                className={settingsPanelNavButtonClass(panelId === id, true)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <aside className="hidden lg:flex w-56 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/85 dark:bg-zinc-950/40 py-3 px-2">
          <nav aria-label="设置分类" className="flex flex-col gap-0.5">
            {SETTINGS_PANEL_NAV.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-current={panelId === id ? 'page' : undefined}
                onClick={() => setPanelId(id)}
                className={settingsPanelNavButtonClass(panelId === id, false)}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <main
          id="settings-main-panel"
          aria-label={
            SETTINGS_PANEL_NAV.find((n) => n.id === panelId)?.label
              ? `设置 · ${SETTINGS_PANEL_NAV.find((n) => n.id === panelId)!.label}`
              : '设置内容'
          }
          className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 py-4 sm:p-5"
        >
          {panelId === 'provider' && (
            <section className="space-y-5">
              <SetupGuide settings={settings} applyConfig={applyConfig} />
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">模型供应商</h2>
            <p className="text-xs text-zinc-500 mt-0.5">选择用于识别图片的视觉大模型</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {PROVIDER_LIST_FEATURED.map(renderProviderCard)}
        </div>

        {moreCount > 0 && (
          <div className="mt-2">
            <button
              type="button"
              aria-expanded={showExtendedProviders}
              onClick={() => setShowExtendedProviders((v) => !v)}
              className="text-xs text-violet-500 hover:underline inline-flex items-center gap-1 py-1"
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${showExtendedProviders ? 'rotate-180' : ''}`}
              />
              {showExtendedProviders ? '收起更多供应商' : `显示更多供应商（${moreCount}）`}
            </button>
            {showExtendedProviders && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-2">
                {PROVIDER_LIST_EXTENDED.map(renderProviderCard)}
              </div>
            )}
          </div>
        )}

        <div className="mt-5 space-y-3">
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
          )}

          {panelId === 'output' && (
            <section className="space-y-4">
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
            className="input-prompt min-h-[100px] resize-y"
            placeholder="例如：注重画面氛围与光影描写；输出不超过 100 字。&#10;可以多行输入，详细描述你想要的提示词风格、约束和示例。"
            value={settings.customPromptTemplate}
            onChange={(e) =>
              setSettings({ ...settings, customPromptTemplate: e.target.value })
            }
          />
          <p className="text-[11px] text-zinc-400 mt-1.5">
            拼接位置由「策略版本」决定：高保真档把它放在最前面让模型优先遵守，经典档以"额外要求：…"形式追加到末尾。
          </p>
        </div>

        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
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
        </div>

        <div className="mt-4">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={settings.panelAutofocus !== false}
              onChange={(e) =>
                setSettings({ ...settings, panelAutofocus: e.target.checked })
              }
              className="w-4 h-4 accent-violet-500"
            />
            <div>
              <div className="text-sm">浮动面板自动聚焦编辑器</div>
              <div className="text-xs text-zinc-500">
                面板打开或反推结束时将焦点移到编辑区（利于键盘与屏幕阅读器）；关闭后尽量不抢走网页内焦点
              </div>
            </div>
          </label>
        </div>

        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            弹窗里的「编辑 / AI 调整」
          </div>
          <p className="text-xs text-zinc-500">
            选择打开<strong className="font-medium text-zinc-600 dark:text-zinc-400">提示词库</strong>（扩展选项页）还是在
            <strong className="font-medium text-zinc-600 dark:text-zinc-400">网页浮动面板</strong>
            中继续编辑与 AI 调整。选浮动面板时会尝试激活该条记录的来源页（与工具栏弹窗里的「弹窗编辑」一致）。
            <span className="block mt-1.5 text-zinc-500">
              「版本」始终在工具栏弹窗内展开历史列表，不受此项影响。
            </span>
          </p>
          <div className="flex flex-col gap-2">
            {(
              [
                {
                  value: 'library' as const,
                  label: '打开提示词库',
                  desc: '大图编辑与 AI 调整在选项页「提示词库」中；历史版本在弹窗内查看',
                },
                {
                  value: 'panel' as const,
                  label: '在网页浮动面板中打开',
                  desc: '在来源网页上的悬浮窗中编辑，并按按钮展开主编辑区与 AI 调整；历史版本仍在弹窗内查看',
                },
              ] as const
            ).map((opt) => {
              const active = (settings.popupToolbarPromptAction ?? 'library') === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSettings({ ...settings, popupToolbarPromptAction: opt.value })}
                  className={`text-left w-full p-3 rounded-xl border transition ${
                    active
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10'
                      : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
                  }`}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            随机风格强度
          </div>
          <p className="text-xs text-zinc-500">
            控制浮动面板与提示词库中「随机风格」每次生成时的变异幅度；同一档位下多次点击仍会略有不同。
          </p>
          <div className="flex flex-col gap-2">
            {REWRITE_RANDOMNESS_OPTIONS.map((opt) => {
              const active =
                normalizeOneClickRewriteRandomness(settings.oneClickRewriteRandomness) === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setSettings({ ...settings, oneClickRewriteRandomness: opt.value })
                  }
                  className={`text-left w-full p-3 rounded-xl border transition ${
                    active
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10'
                      : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
                  }`}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </section>
          )}

          {panelId === 'strategy' && (
            <section className="space-y-4">
        <h2 className="text-sm font-semibold mb-1">策略版本</h2>
        <p className="text-xs text-zinc-500 mb-4">
          一档策略 = <b>指令集 / 采样 / 拼接</b> 三个组件各自挑一个版本号的组合。切档其实是同时换这 3 个组件，对比效果时可以随时切回旧版本。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {strategyList
            .filter((s) => s.id !== 'custom')
            .map((s) => {
              const active = settings.promptStrategy === s.id;
              return (
                <div key={s.id} className="h-full min-h-0">
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, promptStrategy: s.id })}
                    className={`h-full w-full flex flex-col text-left p-3 rounded-xl border transition ${
                      active
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
                    }`}
                  >
                    <div className="text-sm font-medium flex items-center gap-2 shrink-0">
                      {s.label}
                      {active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500 text-white">
                          生效中
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1 leading-relaxed flex-1 min-h-0">
                      {s.description}
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-auto pt-1.5 font-mono shrink-0">
                      temperature {s.temperature} · max_tokens {s.maxTokens} ·{' '}
                      {s.customPosition === 'prepend' ? '自定义前置' : '自定义追加'}
                    </div>
                  </button>
                </div>
              );
            })}

          {userPresets.map((preset) => {
            const active = isSettingsMatchingUserPreset(settings, preset);
            let resolved: ReturnType<typeof resolveCustomStrategy> | null = null;
            try {
              resolved = resolveCustomStrategy(preset.customComponents, {
                instruction: preset.customInstruction,
                temperature: preset.customTemperature,
                maxTokens: preset.customMaxTokens,
              });
            } catch {
              resolved = null;
            }
            return (
              <div key={`user-preset-${preset.id}`} className="h-full min-h-0">
                <button
                  type="button"
                  onClick={() =>
                    setSettings(applyUserStrategyPresetToSettings(settings, preset))
                  }
                  className={`h-full w-full flex flex-col text-left p-3 rounded-xl border transition ${
                    active
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10'
                      : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
                  }`}
                >
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap shrink-0">
                    <span className="min-w-0 truncate">{preset.name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-200/90 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 shrink-0">
                      我的预设
                    </span>
                    {active && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500 text-white shrink-0">
                        生效中
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1 leading-relaxed line-clamp-2 flex-1 min-h-0">
                    {briefUserPresetFingerprint(preset)}
                  </div>
                  {resolved && (
                    <div className="text-[10px] text-zinc-400 mt-auto pt-1.5 font-mono shrink-0">
                      temperature {resolved.temperature} · max_tokens {resolved.maxTokens} ·{' '}
                      {resolved.customPosition === 'prepend' ? '自定义前置' : '自定义追加'}
                    </div>
                  )}
                </button>
              </div>
            );
          })}

          {strategyList
            .filter((s) => s.id === 'custom')
            .map((s) => {
              const customActive = settings.promptStrategy === 'custom';
              const showGenericCustomBadge = customActive && !matchesAnySavedPreset;
              return (
                <div key={s.id} className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, promptStrategy: s.id })}
                    className={`w-full text-left p-3 rounded-xl border transition ${
                      customActive
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
                    } ${customActive ? 'rounded-b-none' : ''}`}
                  >
                    <div className="text-sm font-medium flex items-center gap-2">
                      {s.label}
                      {showGenericCustomBadge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500 text-white">
                          生效中
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                      {s.description}
                    </div>
                  </button>
                  {customActive && (
                    <CustomStrategyPanel settings={settings} setSettings={setSettings} />
                  )}
                </div>
              );
            })}
        </div>
      </section>
          )}

          {panelId === 'data' && (
            <DataPersistence
              variant="plain"
              onDataRestored={async () => {
                const [next, presets] = await Promise.all([getSettings(), getUserStrategyPresets()]);
                setSettings(next);
                setUserPresets(presets);
              }}
            />
          )}

          {panelId === 'updates' && <UpdateSection variant="plain" />}

          <footer className="text-xs text-zinc-400 dark:text-zinc-500 pt-6 mt-8 text-center border-t border-zinc-100 dark:border-zinc-800/80">
            数据仅保存在你的浏览器本地，不会上传到任何第三方服务器。
          </footer>
        </main>
      </div>
    </div>
  );
}

const STYLE_PROMPT_SET_LABELS: Record<StylePromptSetVersion, string> = {
  'v0.1.0': 'v0.1.0 — 基线指令，7 个抽象方面自由组织',
  'v0.2.2': 'v0.2.2 — 10 维度显式清单 + 三禁 + 空槽位跳过',
  'v0.3.0': 'v0.3.0 — 8 维度分句 / 具名风格锚定 / 摄影参数',
  'v0.3.5': 'v0.3.5 — 按图结构 3–8 段 / 中文自然语言+参数 / 只出正文',
};
const SAMPLING_LABELS: Record<SamplingVersion, string> = {
  'v0.1.0': 'v0.1.0 — temperature 0.4 · max_tokens 1024',
  'v0.2.2': 'v0.2.2 — temperature 0.3 · max_tokens 1280',
  'v0.3.0': 'v0.3.0 — temperature 0.3 · max_tokens 1536',
};
const CUSTOM_JOIN_LABELS: Record<CustomJoinVersion, string> = {
  'v0.1.0': 'v0.1.0 — 自定义模板尾部追加',
  'v0.2.2': 'v0.2.2 — 自定义模板前置',
  'v0.3.0': 'v0.3.0 — 自定义模板前置',
};

function CustomStrategyPanel({
  settings,
  setSettings,
}: {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
}) {
  const [presets, setPresets] = useState<UserStrategyPreset[]>([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [presetTip, setPresetTip] = useState<string | null>(null);

  const refreshPresets = useCallback(async () => {
    setPresets(await getUserStrategyPresets());
  }, []);

  useEffect(() => {
    void refreshPresets();
  }, [refreshPresets]);

  const showPresetTip = useCallback((msg: string, ms = 2400) => {
    setPresetTip(msg);
    window.setTimeout(() => setPresetTip(null), ms);
  }, []);

  const comp = settings.customComponents ?? {
    stylePromptSet: 'v0.3.0' as StylePromptSetVersion,
    sampling: 'v0.3.0' as SamplingVersion,
    customJoin: 'v0.3.0' as CustomJoinVersion,
  };

  const updateComp = (patch: Partial<StrategyComponents>) => {
    setSettings({
      ...settings,
      customComponents: { ...comp, ...patch },
    });
  };

  const sm = SAMPLING_PROFILES[comp.sampling];
  const cj = CUSTOM_JOINS[comp.customJoin];
  const effectiveTemp = settings.customTemperature ?? sm.temperature;
  const effectiveMaxTokens = settings.customMaxTokens ?? sm.maxTokens;

  const onSaveUserPreset = async () => {
    const name = newPresetName.trim();
    if (!name) return;
    const preset = buildUserStrategyPresetFromSettings(name, settings);
    const r = await addUserStrategyPreset(preset);
    if (!r.ok) {
      showPresetTip(`最多保存 ${MAX_USER_STRATEGY_PRESETS} 条预设`, 3200);
      return;
    }
    setNewPresetName('');
    await refreshPresets();
    showPresetTip('已保存到本地');
  };

  const onApplyUserPreset = (p: UserStrategyPreset) => {
    try {
      resolveCustomStrategy(p.customComponents, {
        instruction: p.customInstruction,
        temperature: p.customTemperature,
        maxTokens: p.customMaxTokens,
      });
    } catch {
      showPresetTip('该预设引用的组件版本已失效，请在自定义组合中修正后重新保存');
      return;
    }
    setSettings(applyUserStrategyPresetToSettings(settings, p));
    showPresetTip('已应用到当前编辑区，请点击右上角「保存设置」同步', 4000);
  };

  const onRenameUserPreset = async (p: UserStrategyPreset) => {
    const next = window.prompt('预设名称', p.name);
    if (next === null) return;
    const t = next.trim().slice(0, MAX_PRESET_NAME_LEN);
    if (!t) return;
    await updateUserStrategyPresetName(p.id, t);
    await refreshPresets();
    showPresetTip('已重命名');
  };

  const onRemoveUserPreset = async (p: UserStrategyPreset) => {
    if (!window.confirm(`删除预设「${p.name}」？`)) return;
    await removeUserStrategyPreset(p.id);
    await refreshPresets();
    showPresetTip('已删除');
  };

  return (
    <div className="border border-t-0 border-violet-500 rounded-b-xl bg-violet-50/50 dark:bg-violet-500/5 p-4 space-y-4">
      {/* 组件版本混搭 */}
      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 block mb-1">
            指令集版本
          </label>
          <select
            className="input text-xs"
            value={comp.stylePromptSet}
            onChange={(e) =>
              updateComp({ stylePromptSet: e.target.value as StylePromptSetVersion })
            }
          >
            {(Object.keys(STYLE_PROMPT_SETS) as StylePromptSetVersion[]).map((v) => (
              <option key={v} value={v}>
                {STYLE_PROMPT_SET_LABELS[v] ?? v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 block mb-1">
            采样参数
          </label>
          <select
            className="input text-xs"
            value={comp.sampling}
            onChange={(e) =>
              updateComp({ sampling: e.target.value as SamplingVersion })
            }
          >
            {(Object.keys(SAMPLING_PROFILES) as SamplingVersion[]).map((v) => (
              <option key={v} value={v}>
                {SAMPLING_LABELS[v] ?? v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 block mb-1">
            拼接方式
          </label>
          <select
            className="input text-xs"
            value={comp.customJoin}
            onChange={(e) =>
              updateComp({ customJoin: e.target.value as CustomJoinVersion })
            }
          >
            {(Object.keys(CUSTOM_JOINS) as CustomJoinVersion[]).map((v) => (
              <option key={v} value={v}>
                {CUSTOM_JOIN_LABELS[v] ?? v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 当前生效摘要 */}
      <div className="text-[10px] text-zinc-400 font-mono">
        temperature {effectiveTemp} · max_tokens {effectiveMaxTokens} ·{' '}
        {(settings.customInstruction ? '自定义指令' : `指令集@${comp.stylePromptSet}`)} ·{' '}
        {cj === 'prepend' ? '自定义前置' : '自定义追加'}
      </div>

      {/* 高级覆盖 */}
      <div className="border-t border-violet-200 dark:border-violet-500/20 pt-3 space-y-3">
        <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">高级覆盖</div>
        <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 block mb-1">
                自定义指令模板
              </label>
              <textarea
                className="input min-h-[100px] resize-y leading-[1.6] font-mono text-[12px]"
                placeholder="留空则使用上方选择的指令集版本。填写后将替代内置指令文本，对所有输出风格统一生效。"
                value={settings.customInstruction ?? ''}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    customInstruction: e.target.value || undefined,
                  })
                }
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 block mb-1">
                  温度
                  <span className="ml-2 font-mono text-zinc-400">
                    {effectiveTemp.toFixed(2)}
                  </span>
                  {settings.customTemperature != null && (
                    <button
                      type="button"
                      onClick={() =>
                        setSettings({ ...settings, customTemperature: undefined })
                      }
                      className="ml-2 text-violet-500 hover:underline"
                    >
                      重置
                    </button>
                  )}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={effectiveTemp}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      customTemperature: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-violet-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-400 mt-0.5">
                  <span>0.0（稳定）</span>
                  <span>1.0（发散）</span>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 block mb-1">
                  Token 上限
                  {settings.customMaxTokens != null && (
                    <button
                      type="button"
                      onClick={() =>
                        setSettings({ ...settings, customMaxTokens: undefined })
                      }
                      className="ml-2 text-violet-500 hover:underline"
                    >
                      重置
                    </button>
                  )}
                </label>
                <input
                  type="number"
                  className="input text-xs font-mono"
                  min={256}
                  max={8192}
                  step={128}
                  value={effectiveMaxTokens}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 256) {
                      setSettings({ ...settings, customMaxTokens: v });
                    }
                  }}
                />
              </div>
            </div>
            <p className="text-[10px] text-zinc-400 leading-snug">
              覆盖值仅在选中「自定义组合」策略时生效。重置后将退回到上方采样参数版本的默认值。
            </p>
        </div>
      </div>

      {/* 我的策略配置（命名预设，存本地 storage） */}
      <div className="border-t border-violet-200 dark:border-violet-500/20 pt-3 space-y-3">
        <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">我的策略配置</div>
        {presetTip && (
          <div className="text-[11px] text-violet-600 dark:text-violet-400">{presetTip}</div>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            className="input text-xs flex-1 min-w-0"
            placeholder="新预设名称"
            maxLength={MAX_PRESET_NAME_LEN}
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
          />
          <button
            type="button"
            className="btn-ghost text-xs py-2 shrink-0 justify-center"
            disabled={!newPresetName.trim()}
            onClick={() => void onSaveUserPreset()}
          >
            保存当前为预设
          </button>
        </div>
        <p className="text-[10px] text-zinc-400 leading-snug">
          快照包含上方组件版本、高级覆盖项，以及设置里「额外提示词」模板（与所有档位共用、按拼接方式合并）。最多{' '}
          {MAX_USER_STRATEGY_PRESETS} 条。
        </p>
        {presets.length === 0 ? (
          <p className="text-[10px] text-zinc-400">暂无已保存的预设。</p>
        ) : (
          <ul className="space-y-2">
            {presets.map((p) => (
              <li
                key={p.id}
                className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-xl bg-white/70 dark:bg-zinc-900/50 border border-zinc-200/90 dark:border-zinc-700/90"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100 truncate">
                    {p.name}
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    {new Date(p.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  <button
                    type="button"
                    className="btn-primary text-[11px] py-1.5 px-3"
                    onClick={() => onApplyUserPreset(p)}
                  >
                    应用
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-[11px] py-1.5 px-3 border border-zinc-200 dark:border-zinc-600"
                    onClick={() => void onRenameUserPreset(p)}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-[11px] py-1.5 px-3 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50"
                    onClick={() => void onRemoveUserPreset(p)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
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
