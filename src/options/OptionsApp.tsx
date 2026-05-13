import { useCallback, useEffect, useRef, useState } from 'react';
import { Save, Sparkles, Settings as SettingsIcon, BookOpen, Check } from 'lucide-react';
import SettingsView from './SettingsView';
import PromptLibrary from './PromptLibrary';

type Tab = 'settings' | 'library';

const TAB_STORAGE_KEY = 'options_active_tab_v1';

/**
 * 设置页根组件。顶部 header 是一个 Tab 容器，下面挂载两个独立面板：
 * - 设置：模型供应商 / 输出风格 / 联通性测试 / 自动更新
 * - 提示词库：每张图的提示词与版本历史管理后台
 *
 * 通过 sessionStorage 记忆上次停留的 Tab，方便用户在两个视图之间反复切换。
 */
export default function OptionsApp() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = sessionStorage.getItem(TAB_STORAGE_KEY);
      return saved === 'library' || saved === 'settings' ? saved : 'settings';
    } catch {
      return 'settings';
    }
  });
  const [savedHint, setSavedHint] = useState(false);

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

  const onSave = async () => {
    if (!saveHandlerRef.current) return;
    await saveHandlerRef.current();
    setSavedHint(true);
    setTimeout(() => setSavedHint(false), 1600);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center">
      <header className="w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-sm flex-none">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">图片提示词提取器</h1>
              <p className="text-xs text-zinc-500 truncate">
                右键任意图片，反推 AI 绘画提示词
              </p>
            </div>
          </div>

          {/* Tab 切换 */}
          <nav className="hidden sm:flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/60">
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

          {tab === 'settings' && (
            <button className="btn-primary flex-none" onClick={onSave}>
              {savedHint ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {savedHint ? '已保存' : '保存设置'}
            </button>
          )}
        </div>

        {/* 小屏：把 Tab 单独放到第二行 */}
        <div className="sm:hidden border-t border-zinc-200 dark:border-zinc-800 px-4 py-2 flex items-center gap-1">
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
        </div>
      </header>

      <main className="w-full max-w-5xl mx-auto px-8 py-8">
        {tab === 'settings' ? (
          <SettingsView registerSaveHandler={registerSaveHandler} />
        ) : (
          <PromptLibrary />
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
