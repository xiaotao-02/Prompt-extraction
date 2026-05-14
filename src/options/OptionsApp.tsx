import { useCallback, useEffect, useRef, useState } from 'react';
import { Save, Settings as SettingsIcon, BookOpen, Check } from 'lucide-react';
import SettingsView from './SettingsView';
import PromptLibrary from './PromptLibrary';

// 顶部「保存设置 / 已保存」按钮共用的基础布局类。
// 颜色和交互态在渲染时再根据 dirty 拼接，避免 disabled 时仍残留 hover/active 反馈。
const SAVE_BUTTON_BASE =
  'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition flex-none';

type Tab = 'settings' | 'library';

const TAB_STORAGE_KEY = 'options_active_tab_v1';

/**
 * 设置页根组件。顶部 header 是一个 Tab 容器，下面挂载两个独立面板：
 * - 设置：模型供应商 / 输出风格 / 联通性测试 / 自动更新
 * - 提示词库：每张图的提示词与版本历史管理后台
 *
 * 通过 sessionStorage 记忆上次停留的 Tab，方便用户在两个视图之间反复切换。
 */
/**
 * 解析 options 页 URL 的 hash 参数。content script 浮动面板点击「在提示词库中编辑」
 * 时由 background 把目标 tab / focusId 拼到 hash 上传过来。
 * 形如 `#tab=library&focus=abc123`。
 */
function readHashParams(): { tab: Tab | null; focusId: string | null } {
  try {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return { tab: null, focusId: null };
    const params = new URLSearchParams(hash);
    const t = params.get('tab');
    const focus = params.get('focus');
    return {
      tab: t === 'library' || t === 'settings' ? (t as Tab) : null,
      focusId: focus || null,
    };
  } catch {
    return { tab: null, focusId: null };
  }
}

export default function OptionsApp() {
  // hash 参数只在初始 mount 时消费一次：URL hash > sessionStorage > 默认 'settings'。
  // 消费完后清掉 hash，避免用户刷新页面又跳回 library 干扰正常浏览。
  const initialHash = readHashParams();
  const [tab, setTab] = useState<Tab>(() => {
    if (initialHash.tab) return initialHash.tab;
    try {
      const saved = sessionStorage.getItem(TAB_STORAGE_KEY);
      return saved === 'library' || saved === 'settings' ? saved : 'settings';
    } catch {
      return 'settings';
    }
  });
  const [libraryFocusId, setLibraryFocusId] = useState<string | null>(initialHash.focusId);

  // 把 deep-link 消费掉：清掉 hash，并在 PromptLibrary 收到 focusId 后由它再调用
  // onConsumeFocus 把这里的 focusId 也清掉，避免组件被反复触发自动展开。
  useEffect(() => {
    if (!initialHash.tab && !initialHash.focusId) return;
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /**
   * 设置面板「未保存的修改」标志。
   * - true：用户在 SettingsView 改过字段但还没落盘 → 顶部按钮显示「保存设置」
   * - false：当前 UI 状态与 chrome.storage 里完全一致 → 显示「已保存」并禁用
   *
   * 这里没有用一次性的「保存成功 → N 秒后消失」提示，因为用户希望保存后能
   * 持续看到「已保存」状态，直到自己再次编辑设置。
   */
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  // 子面板通过 registerSaveHandler 把自己的保存逻辑注入这里，
  // 我们就可以在固定的 header 上放一个保存按钮，避免每个面板都重复一套。
  const saveHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const registerSaveHandler = useCallback((handler: () => Promise<void>) => {
    saveHandlerRef.current = handler;
  }, []);
  // SettingsView 通过这个回调把 dirty 状态推给 header 按钮。
  // 用 useCallback 保持引用稳定，避免子组件的 useEffect 反复触发。
  const handleDirtyChange = useCallback((d: boolean) => {
    setDirty(d);
  }, []);

  const onSave = async () => {
    if (!saveHandlerRef.current) return;
    await saveHandlerRef.current();
    // dirty 会在 SettingsView 完成 persistAndMark 后通过 onDirtyChange 自动归零，
    // 这里不需要也不应该再手动 setDirty(false)，否则可能与子组件的真实状态错位。
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center">
      <header className="w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-8 py-4 hidden sm:grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="flex items-center gap-2 min-w-0 justify-self-start">
            <img
              src={chrome.runtime.getURL('icons/icon-128.png')}
              alt="Prompt Extracto"
              className="w-7 h-7 rounded-lg shadow-sm flex-none object-cover"
            />
            <h1 className="text-base font-semibold truncate">Prompt Extracto</h1>
          </div>

          {/* Tab 切换：放在 grid 的中间列，天然居中于 header 容器 */}
          <nav className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/60 justify-self-center">
            <TabButton
              active={tab === 'settings'}
              onClick={() => setTab('settings')}
              icon={<SettingsIcon className="w-3.5 h-3.5" />}
              label="设置"
            />
            <TabButton
              active={tab === 'library'}
              onClick={() => setTab('library')}
              icon={<BookOpen className="w-3.5 h-3.5" />}
              label="提示词库"
            />
          </nav>

          {/* 保存按钮始终占位，提示词库 tab 下用 invisible 隐藏，
              避免按钮出现/消失让中间 Tab 栏位置左右跳动。
              dirty=true → 紫色「保存设置」可点击；dirty=false → 绿色「已保存」禁用。 */}
          <button
            className={`${SAVE_BUTTON_BASE} justify-self-end ${
              dirty
                ? 'bg-gradient-to-br from-indigo-500 to-violet-500 text-white hover:brightness-110 active:scale-[0.98] cursor-pointer'
                : 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 cursor-default'
            } ${tab === 'settings' ? '' : 'invisible'}`}
            onClick={onSave}
            disabled={!dirty}
            aria-hidden={tab !== 'settings'}
            tabIndex={tab === 'settings' && dirty ? 0 : -1}
          >
            {dirty ? <Save className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            {dirty ? '保存设置' : '已保存'}
          </button>
        </div>

        {/* 小屏：logo + 保存按钮一行，Tab 第二行 */}
        <div className="sm:hidden max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={chrome.runtime.getURL('icons/icon-128.png')}
              alt="Prompt Extracto"
              className="w-7 h-7 rounded-lg shadow-sm flex-none object-cover"
            />
            <h1 className="text-base font-semibold truncate">Prompt Extracto</h1>
          </div>
          <button
            className={`${SAVE_BUTTON_BASE} ${
              dirty
                ? 'bg-gradient-to-br from-indigo-500 to-violet-500 text-white hover:brightness-110 active:scale-[0.98] cursor-pointer'
                : 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 cursor-default'
            } ${tab === 'settings' ? '' : 'invisible'}`}
            onClick={onSave}
            disabled={!dirty}
            aria-hidden={tab !== 'settings'}
            tabIndex={tab === 'settings' && dirty ? 0 : -1}
          >
            {dirty ? <Save className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            {dirty ? '保存设置' : '已保存'}
          </button>
        </div>

        {/* 小屏：把 Tab 单独放到第二行，并居中显示 */}
        <div className="sm:hidden border-t border-zinc-200 dark:border-zinc-800 px-4 py-2 flex justify-center">
          <nav className="inline-flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/60">
            <TabButton
              active={tab === 'settings'}
              onClick={() => setTab('settings')}
              icon={<SettingsIcon className="w-3.5 h-3.5" />}
              label="设置"
            />
            <TabButton
              active={tab === 'library'}
              onClick={() => setTab('library')}
              icon={<BookOpen className="w-3.5 h-3.5" />}
              label="提示词库"
            />
          </nav>
        </div>
      </header>

      <main className="w-full max-w-5xl mx-auto px-8 py-8">
        {tab === 'settings' ? (
          <SettingsView
            registerSaveHandler={registerSaveHandler}
            onDirtyChange={handleDirtyChange}
          />
        ) : (
          <PromptLibrary
            focusId={libraryFocusId}
            onConsumeFocus={() => setLibraryFocusId(null)}
          />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
        active
          ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-300 shadow-sm'
          : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
