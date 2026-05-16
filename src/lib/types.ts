/**
 * 内置 provider 标识。
 *
 * 分组（仅文档目的，类型上是平的联合）：
 * - 三大原生协议：openai / anthropic / gemini
 * - 国内主流（OpenAI 兼容）：zhipu / qwen / siliconflow / deepseek / moonshot /
 *   doubao / stepfun / minimax / yi / baidu
 * - 海外主流（OpenAI 兼容）：openrouter / xai / mistral / groq / together /
 *   fireworks
 * - 第三方中转：shukelongda
 * - 兜底：custom（任意 OpenAI 兼容端点）
 *
 * **新增 provider 时同时改 `src/lib/providers.ts` 的 PROVIDERS 注册表**，
 * 默认配置（baseUrl / 默认模型 / 文档链接）由那里集中维护。
 *
 * 老 settings 里若残留早期下线过的 id（例如曾经出现过的 'fidelity' 之类），
 * `getSettings` 通过 base 默认值合并已经能软回退到 `openai`。
 */
export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'zhipu'
  | 'qwen'
  | 'siliconflow'
  | 'deepseek'
  | 'moonshot'
  | 'doubao'
  | 'stepfun'
  | 'minimax'
  | 'yi'
  | 'baidu'
  | 'openrouter'
  | 'xai'
  | 'mistral'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'shukelongda'
  | 'custom';

export type OutputStyle = 'natural-zh' | 'natural-en' | 'sd-tags' | 'midjourney';

/**
 * 提示词「策略档位」标识。
 *
 * 一档策略 = 3 个组件维度的「版本组合引用」：
 *   - stylePromptSet : 4 套 OutputStyle 指令文本的版本号
 *   - sampling       : { temperature, maxTokens } 一对采样参数的版本号
 *   - customJoin     : 用户自定义模板拼接位置的版本号
 *
 * **真正的字面量定义 = `keyof typeof STRATEGIES_INTERNAL`（在 strategies-meta.ts）**。
 * 这里只是把它 type-only re-export 给 types.ts 的消费方，让 AppSettings、运行时
 * 消息协议这些纯类型场景照旧能 import {@link StrategyId}，又不会因此把 strategies.ts
 * 的运行时代码（含 STYLE_PROMPT_SETS 等几 KB 字符串）拉进 bundle。
 *
 * 由于这是 `export type ... from`，编译产物里完全消失，不存在循环依赖问题：
 * strategies.ts 仍然可以 `import type { OutputStyle } from './types'`。
 *
 * **加 / 删一档策略只在 strategies-meta.ts 里改 STRATEGIES_INTERNAL 一处**，这个
 * 类型自动跟随，不用手动维护字面量联合（避免出现"types 里写了 'v030' 但 STRATEGIES
 * 漏加"或反之的不一致）。
 *
 * 历史上还存在过 'fidelity' (v0.1.7 高保真档)，已下线；老 settings 里如果还存着
 * 这个值，会在 getStrategy 里安全回退到 DEFAULT_STRATEGY_ID。
 */
// 同时本地绑定（types.ts 内部要在 AppSettings / 消息协议里直接当类型用）和
// 对外 re-export。`export type { ... } from` 本身只做"转发"，不会把 StrategyId
// 作为本地标识符可见，所以必须 import-then-export 两步走。
import type { StrategyId, StrategyComponents } from './strategies-meta';
export type { StrategyId, StrategyComponents };

export interface ProviderConfig {
  id: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 通过 `/models` 接口拉到的模型 id 列表，用于在「设置」里直接选择 */
  discoveredModels?: string[];
  /** 上一次成功拉取模型列表的时间戳 */
  discoveredAt?: number;
}

export interface UpdateInfo {
  version: string;
  name: string;
  downloadUrl: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  current: string;
  latest: UpdateInfo | null;
  checkedAt: number;
  error?: string;
}

/**
 * options → background「立即更新」：GitHub 有新版本后尝试触发浏览器侧更新并重载；
 * 若商店未同步或为解压加载，则退回打开 Release / 下载页。
 */
export type ApplyExtensionUpdateResult =
  | { applied: true; willReload: true }
  | { applied: false; reason: 'already_latest' }
  | {
      applied: false;
      reason: 'throttled' | 'manual_required';
      message: string;
      openUrl?: string;
    };

export interface UpdateSettings {
  lastCheckedAt: number;
  lastResult: UpdateCheckResult | null;
}

/** 「一键洗稿」随机变异强度；写入 {@link AppSettings.oneClickRewriteRandomness} */
export type OneClickRewriteRandomness = 'subtle' | 'moderate' | 'bold';

export interface AppSettings {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  outputStyle: OutputStyle;
  customPromptTemplate: string;
  saveHistory: boolean;
  updates: UpdateSettings;
  /**
   * 当前生效的提示词策略档位 id。
   *
   * 一个 id 在内部展开成 3 个组件版本（stylePromptSet / sampling / customJoin），
   * 进而决定 4 套 stylePrompts 的措辞、采样温度、输出上限、以及用户自定义模板
   * 的拼接位置。详见 {@link ./strategies.ts}。
   *
   * 这里依旧只持久化一个 id 字符串，是因为：
   *   - 老 settings（v0.1.6 之前没有 promptStrategy 字段）由 `getSettings`
   *     合并 base 默认值时自动填上 `DEFAULT_STRATEGY_ID`，旧数据无缝升级；
   *   - 新版本里如果某个组件版本被淘汰，只要重命名内置策略对应的 id 不动，
   *     用户旧数据里写着的 id 仍然能解析回最新可用的组件组合，不会出空白。
   */
  promptStrategy: StrategyId;
  /** 自定义组合策略选用的组件版本（仅 promptStrategy === 'custom' 时生效） */
  customComponents?: StrategyComponents;
  /** 完全自定义指令文本（仅 promptStrategy === 'custom' 时生效） */
  customInstruction?: string;
  /** 自定义温度（覆盖 sampling 版本） */
  customTemperature?: number;
  /** 自定义 token 上限（覆盖 sampling 版本） */
  customMaxTokens?: number;
  /**
   * 工具栏弹窗里「编辑 / AI 调整」的默认打开位置（「版本」始终在弹窗内展开，不受此项影响）。
   * - library：打开扩展选项页的提示词库（深链 focus + 可选 dock）
   * - panel：在当前/来源网页的浮动面板中打开，并按操作展开对应区域
   */
  popupToolbarPromptAction?: 'library' | 'panel';
  /** 浮动面板 / 提示词库「一键洗稿」的随机强度，默认 moderate */
  oneClickRewriteRandomness?: OneClickRewriteRandomness;
  /**
   * 网页浮动面板在状态切换时是否自动把焦点移到编辑器。
   * 默认开启（可读屏与键盘）；关闭可减少「抢焦点」打扰。
   */
  panelAutofocus?: boolean;
}

/**
 * 用户在「自定义组合」下保存的命名策略快照（存 chrome.storage.local）。
 * 应用时写回 {@link AppSettings} 并令 `promptStrategy === 'custom'`。
 */
export interface UserStrategyPreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  customComponents: StrategyComponents;
  customInstruction?: string;
  customTemperature?: number;
  customMaxTokens?: number;
  /** 与内置档位共用的「额外提示词」模板，随策略拼接方式合并 */
  customPromptTemplate: string;
}

/**
 * 反推流程的阶段。面板会根据这个值切换 loading 文案：
 *   fetching   → 正在下载/解码图片（含动图扁平化、视频抓帧）
 *   calling    → 已把图片发给大模型，等待首 token
 *   streaming  → 模型已经开始吐字，正在流式接收
 *   finalizing → 流式结束，正在保存历史/收尾
 */
export type ExtractStage = 'fetching' | 'calling' | 'streaming' | 'finalizing';

/**
 * AI 调整（refine）流程的阶段。比反推少了 fetching / finalizing：
 *   calling    → 已把指令发给大模型，等待首 token
 *   streaming  → 模型已经开始吐字，正在流式接收
 *
 * UI 上 refine 进度条只用 calling / streaming 两档，配文案 "正在调用大模型 / 正在接收模型回复"。
 */
export type RefineStage = 'calling' | 'streaming';

export type PromptVersionSource = 'extracted' | 'edited' | 'restored' | 'refined';

export interface PromptVersion {
  id: string;
  prompt: string;
  /**
   * 稳定的版本序号。排序以它为准，createdAt 只作为展示和冲突兜底。
   */
  versionNo?: number;
  createdAt: number;
  source: PromptVersionSource;
  note?: string;
  /**
   * 该版本对应的模型元数据。
   *
   * - 'extracted' / 'refined' 版本：记录这次调用实际使用的 provider/model/style，
   *   这样在版本列表里能直观看出"这条结果是哪个模型出的"。
   * - 'edited' / 'restored' 版本：通常省略（不绑定具体模型）。
   * - 老数据没有该字段时，UI 应回退到展示「当前记录的 provider/model」。
   */
  meta?: { provider: ProviderId; model: string; style: OutputStyle; strategy?: StrategyId };
}

export interface HistoryItem {
  id: string;
  imageUrl: string;
  thumbnail: string;
  /**
   * 多图参考反推时各张缩略图/引用（与落库时 {@link imageUrl} 同源规范）。
   * 仅当一次反推使用 ≥2 张参考图时写入；单图记录省略本字段以保持旧数据形态。
   */
  imageUrls?: string[];
  prompt: string;
  provider: ProviderId;
  model: string;
  style: OutputStyle;
  pageUrl: string;
  pageTitle: string;
  createdAt: number;
  updatedAt?: number;
  versions: PromptVersion[];
  /** 提取时使用的策略档位 id */
  strategy?: StrategyId;
  /** 用户置顶收藏，置顶项排在管理后台列表最前面 */
  pinned?: boolean;
  /** 用户给这条记录写的备注/标签，便于检索 */
  note?: string;
  /**
   * 所属「项目 / 文件夹」的 id（指向 {@link LibraryFolder.id}）。
   * - `undefined` 或 `null` 表示「未分类」，仍出现在「全部」与「未分类」筛选下。
   * - 文件夹删除时，该字段会被清空（归还到未分类），不会孤儿化。
   */
  folderId?: string | null;
}

/**
 * 「提示词库」的项目 / 文件夹节点。
 *
 * 一棵简单的有根森林：`parentId === null` 的节点视为「项目」（顶层容器），
 * 其余视为子文件夹。允许任意层级嵌套，UI 上仅在视觉上区分项目 / 文件夹，
 * 数据结构是统一的，避免维护两套 CRUD。
 *
 * 节点本身不直接持有 HistoryItem id 列表；归属关系反向存放在
 * {@link HistoryItem.folderId}，这样移动 / 删除记录都不需要同步另一份索引。
 */
export interface LibraryFolder {
  id: string;
  name: string;
  /** 父节点 id；`null` 即为顶层「项目」 */
  parentId: string | null;
  createdAt: number;
  updatedAt?: number;
  /**
   * 同级节点排序权重，越小越靠前。新建时取「同级最大 sortKey + 1」，
   * 不持久化拖拽位移之外的中间值。
   */
  sortKey?: number;
  /**
   * 用户挑选的颜色 token（顶层项目主要使用），可选。
   * 取值与 PROJECT_COLORS 中定义的 key 对应（如 `'violet' | 'indigo' | …`）。
   */
  color?: string;
}

export type RegionCaptureConfirmPayload = {
  x: number;
  y: number;
  width: number;
  height: number;
  innerWidth: number;
  innerHeight: number;
};

// === 消息协议 ===
export type RuntimeMessage =
  | {
      type: 'EXTRACT_PROMPT';
      payload: {
        /** 单图或与 imageUrls[0] 一致；兼容旧客户端 */
        imageUrl: string;
        pageUrl: string;
        pageTitle: string;
        requestId: string;
        /** 多图时有序完整列表；省略则仅用 imageUrl */
        imageUrls?: string[];
        /**
         * 可选的策略覆盖。content panel 的策略选择器切换时带上，
         * background 会用它替代 settings.promptStrategy 来决定本次反推的策略。
         * 不传则走 settings 里用户配置的默认策略。
         */
        strategyOverride?: StrategyId;
      };
    }
  | {
      type: 'EXTRACT_RESULT';
      payload: {
        requestId: string;
        ok: true;
        prompt: string;
        provider: ProviderId;
        model: string;
        style: OutputStyle;
      };
    }
  | {
      type: 'EXTRACT_ERROR';
      payload: {
        requestId: string;
        ok: false;
        error: string;
      };
    }
  | {
      type: 'EXTRACT_PENDING';
      payload: {
        requestId: string;
        imageUrl: string;
        /** 多图反推时与 imageUrl 一并下发，供面板展示缩略图条 */
        imageUrls?: string[];
        /**
         * 本次反推使用的「提示词策略档位」id。
         *
         * 后台 service worker 在发送 PENDING 前为了让 panel 第一时间出现，
         * 不会等待 settings 读取完成，所以这里允许缺省；缺省时由后续的
         * EXTRACT_PROGRESS 再补发一次带 strategy 的更新即可。
         */
        strategy?: StrategyId;
        /** 与设置页共用的一键洗稿随机强度；缺省时由后续 EXTRACT_PROGRESS 补发 */
        oneClickRewriteRandomness?: OneClickRewriteRandomness;
      };
    }
  | {
      type: 'EXTRACT_PROGRESS';
      payload: {
        requestId: string;
        /**
         * 当前所处阶段，便于面板切换文案。
         *
         * 允许缺省：后台在 settings 读取完成时会发一次"只携带 strategy"的
         * progress 把策略名补回 panel，这种增量更新不应该把面板已有的
         * stage 重置回默认值。content script 侧需要在 stage === undefined
         * 时跳过 stage 的覆盖。
         */
        stage?: ExtractStage;
        /** 流式阶段时，已经收到的部分提示词文本（累计值） */
        partial?: string;
        /**
         * 本次反推所用策略档位 id（详见 strategies.ts）。
         * 仅在后台首次确认 settings 后发一次，让 loading 面板把
         * "v0.1.5 策略 / v0.1.6 策略" 等档位标签亮出来。
         */
        strategy?: StrategyId;
        /**
         * 本次反推使用的服务商 id（如 'openai' / 'gemini' / 'openrouter'）。
         * 后台在 settings 读取完成后随 strategy 一并补发，让 loading 面板
         * 在还没拿到结果时就能告诉用户"正在用谁的什么模型生成"。
         */
        provider?: ProviderId;
        /**
         * 本次反推使用的模型 id（如 'gpt-4o' / 'gemini-2.0-flash'）。
         * 同上，仅在 settings 读取完成后发一次，loading 面板用它点亮
         * 模型 badge。
         */
        model?: string;
        /** 一键洗稿随机强度（settings 就绪后与 strategy 一并下发） */
        oneClickRewriteRandomness?: OneClickRewriteRandomness;
      };
    }
  | {
      /**
       * 历史落库完成通知。
       *
       * 背景：runExtraction 为了让面板尽快看到结果，会先发 EXTRACT_RESULT，
       * 然后异步走 persistHistory。但 addHistory 对「同一张图」会自动合并到
       * 旧记录上 → storage 里真实存在的 id 不一定等于 content 此刻持有的
       * `requestId`。如果 content 用过期的 requestId 去 save / restore /
       * syncVersions，会因 findIndex<0 静默失败。
       *
       * 因此 background 在落库结束后通过这条消息把「真实 id + 当前版本数组」
       * 喂回 content，让浮窗把 currentState.requestId 切换到真实 id，并立刻
       * 填充 versions（不再需要 content 自己读 storage 排查 race）。
       */
      type: 'HISTORY_READY';
      payload: {
        /** content 当前 panel 持有的 requestId（用于路由到对应 panel） */
        requestId: string;
        /** storage 里实际落地的 HistoryItem id —— 同图合并时会和 requestId 不同 */
        actualId: string;
        /** 最新版本数组（含本次反推产生的版本） */
        versions: PromptVersion[];
        /** 真实落库后的当前 prompt，作为防御性兜底 */
        prompt: string;
      };
    }
  | {
      /**
       * 识图进行中：按与 {@link addHistory} 一致的 dedupe 键命中已有记录时，
       * 先把库里的 versions / 真实 id 推到浮窗，避免 loading 阶段「历史版本 · 0」闪烁。
       */
      type: 'HISTORY_PREFETCH';
      payload: {
        requestId: string;
        storageId: string;
        versions: PromptVersion[];
        prompt: string;
      };
    }
  | {
      type: 'REFINE_PROMPT';
      payload: {
        historyId: string;
        instruction: string;
        current: string;
        /** 并行 refine 时区分流式进度归属；省略则兼容旧客户端单路行为 */
        refineJobId?: string;
      };
    }
  | {
      /**
       * AI 调整流式进度。来自浮动面板时由后台 postToTab 投递到对应 tab；
       * popup / options 发起时由后台 chrome.runtime.sendMessage 广播，由当前
       * 正在 refine 的页面监听并更新 UI。
       */
      type: 'REFINE_PROGRESS';
      payload: {
        /** 对应 panel 的 requestId / 历史记录 id（与 REFINE_PROMPT 的 historyId 一致） */
        historyId: string;
        /** 与 REFINE_PROMPT 对应；省略则兼容旧版单路 refine */
        refineJobId?: string;
        /** 当前 refine 阶段；和 partial 至少有一个会带上 */
        stage?: RefineStage;
        /** 已收到的累计部分文本（每次都是全文，不是 delta） */
        partial?: string;
      };
    }
  | {
      type: 'PING';
    }
  | {
      type: 'CHECK_UPDATE';
    }
  | {
      /** 对齐 GitHub latest 后请求浏览器拉包并在可用时 reload */
      type: 'APPLY_EXTENSION_UPDATE';
    }
  | {
      /**
       * background → content：右键「添加到参考」菜单，把图片 URL 并入浮动面板参考列表，
       * 不触发反推（compose 态直至用户点击「生成」）。
       */
      type: 'PANEL_APPEND_REFERENCE';
      payload: { imageUrl: string };
    }
  | {
      /**
       * 内容脚本在 contextmenu（捕获阶段）探测到的「本轮首选提取 URL」与是否点亮兜底菜单。
       * extractionUrl：可为 http(s)/blob、`data:image/...`，含视频抓拍 JPEG、`poster` URL 等；
       * 为空时后台清除该 tab 的 tab 级缓存。
       * showFallback：仅在需要原生 image 上下文以外的兜底入口时为 true；
       * 直接右键 `<video>` 时可为 false，但仍写入 extractionUrl 供原生菜单点击优先于 `srcUrl`。
       */
      type: 'CTX_MENU_PREP';
      payload: { extractionUrl: string; showFallback: boolean };
    }
  | {
      /**
       * 浮动面板切换策略档位后请求后台写回 `app_settings_v1.promptStrategy`，
       * 与选项页、其它上下文共用同一份默认策略（content 不直链接 storage/settings）。
       */
      type: 'SET_PROMPT_STRATEGY';
      payload: { strategy: StrategyId };
    }
  | {
      /** 浮动面板等处切换「一键洗稿」随机强度后写回全局设置 */
      type: 'SET_ONE_CLICK_REWRITE_RANDOMNESS';
      payload: { level: OneClickRewriteRandomness };
    }
  | {
      /**
       * 从 popup / options / 浮动面板打开扩展选项页；无 payload 时等同 `openOptionsPage()`。
       * 带参时由 background 拼 hash 深链（tab / focus / dock）。
       */
      type: 'OPEN_OPTIONS';
      payload?: {
        tab?: 'settings' | 'library';
        focusId?: string;
        dock?: 'refine' | 'versions';
      };
    }
  | {
      /**
       * Popup / 快捷键 /页面右键菜单发起：在当前窗口活动标签页进入「拖拽截取区域 → 添加到参考」。
       * Background 会向该 tab 的 content script 下发 {@link START_REGION_CAPTURE}。
       */
      type: 'REQUEST_REGION_CAPTURE';
      payload?: Record<string, never>;
    }
  | {
      /**
       * Background → content：拉起全屏半透明选区 UI（仅在顶层窗口处理）。
       */
      type: 'START_REGION_CAPTURE';
      payload?: Record<string, never>;
    }
  | {
      /**
       * Content → background：用户对齐到视口的选区矩形（CSS 像素，`getBoundingClientRect` 语义），
       * 附带 `innerWidth` / `innerHeight` 便于与 captureVisibleTab 按宽高比例映射裁剪。
       */
      type: 'REGION_CAPTURE_CONFIRM';
      payload: RegionCaptureConfirmPayload;
    }
  | {
      /**
       * 由 popup（小列表）/ options 提示词库发起，请求 background 把一条
       * 历史记录"召回"到当前活跃的普通网页 tab 的浮动面板里继续编辑。
       *
       * background 收到后会：
       *   1. 找一个能注入 content script 的普通网页 tab（http/https/file 等）
       *   2. 激活该 tab + 聚焦其 window
       *   3. 向该 tab 转发 PANEL_FROM_HISTORY，由 content script 渲染面板
       *
       * 可选 `dock`：`'refine'` 初始展开 AI 调整区，`'versions'` 初始展开历史版本侧栏；
       * 省略则仅打开主编辑区（与仅「召回」一致）。
       *
       * 响应：{ ok: true, tabId } 或 { ok: false, error }。前端用于
       * 决定要不要关 popup / 弹错误提示。
       */
      type: 'OPEN_IN_PANEL';
      payload: { historyId: string; dock?: 'refine' | 'versions' };
    }
  | {
      /**
       * content → background：按 id 读取单条历史。页面里的 IndexedDB 绑定网页源，
       * 不能读扩展提示词库；面板内同步版本必须走此消息。
       */
      type: 'GET_HISTORY_ITEM';
      payload: { id: string };
    }
  | {
      /** content → background：追加提示词版本（与 {@link ./storage/versions#appendPromptVersion} 一致） */
      type: 'APPEND_PROMPT_VERSION';
      payload: {
        id: string;
        prompt: string;
        source?: PromptVersionSource;
        note?: string;
        meta?: PromptVersion['meta'];
      };
    }
  | {
      type: 'RESTORE_PROMPT_VERSION';
      payload: { id: string; versionId: string };
    }
  | {
      type: 'REMOVE_PROMPT_VERSION';
      payload: { id: string; versionId: string };
    }
  | {
      /**
       * background 转发给 content script，要求把指定 history 渲染到浮动面板。
       * 必须带上 `item` 快照：content script 里的 IndexedDB 属于**网页源**，
       * 读不到扩展后台写入的提示词库；不能依赖在页面上下文再 getHistoryItem。
       * `dock` 与 OPEN_IN_PANEL 一致，用于初始展开 AI 调整或历史侧栏。
       */
      type: 'PANEL_FROM_HISTORY';
      payload: {
        historyId: string;
        item: HistoryItem;
        dock?: 'refine' | 'versions';
        /** 当前全局设置中的一键洗稿强度，便于召回面板与选项页一致 */
        oneClickRewriteRandomness?: OneClickRewriteRandomness;
      };
    };

export interface RefineResponseOk {
  ok: true;
  prompt: string;
  provider: ProviderId;
  model: string;
  versionId: string;
  refineJobId?: string;
}
export interface RefineResponseErr {
  ok: false;
  error: string;
}
export type RefineResponse = RefineResponseOk | RefineResponseErr;

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  docsUrl: string;
  description: string;
  /** 设置页「模型供应商」：`featured` 默认展示，`extended` 折叠在「更多」 */
  uiTier?: 'featured' | 'extended';
}
