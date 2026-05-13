export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'zhipu'
  | 'qwen'
  | 'siliconflow'
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
 * 具体的版本注册表与策略 → 组件版本的映射在 {@link ./strategies.ts}。这里只保留
 * id 类型，避免 types.ts 反向依赖 strategies.ts。
 *
 *   - 'classic'  : UI 显示为 "v0.1.5 策略"。全部组件取 v0.1.0（温度 0.4 / 上限 1024 /
 *                  custom 尾部追加 / 经典指令）。id 保持英文 'classic' 是为了不让
 *                  老用户 settings 里持久化的字段因重命名而失效。
 *   - 'v016'     : UI 显示为 "v0.1.6 策略"。全部组件也取 v0.1.0 —— 因为 v0.1.1~v0.1.6
 *                  这 6 个版本里 stylePrompts/temperature/maxTokens/customPosition 一字
 *                  未改，v0.1.6 那套行为本质就是 v0.1.0 那组组件版本。保留独立档位是
 *                  为了给习惯按版本号回滚的用户一个显式入口，并方便后续在不动
 *                  classic 的前提下把它换成新组件版本单独迭代。
 *
 * 历史上还存在过 'fidelity' (v0.1.7 高保真档)，已下线；老 settings 里如果还存着这个
 * 值，会在 getStrategy 里安全回退到 DEFAULT_STRATEGY_ID。
 */
export type StrategyId = 'classic' | 'v016' | 'v010' | 'v022';

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

export interface UpdateSettings {
  lastCheckedAt: number;
  lastResult: UpdateCheckResult | null;
}

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
}

/**
 * 反推流程的阶段。面板会根据这个值切换 loading 文案：
 *   fetching   → 正在下载/解码图片（含动图扁平化、视频抓帧）
 *   calling    → 已把图片发给大模型，等待首 token
 *   streaming  → 模型已经开始吐字，正在流式接收
 *   finalizing → 流式结束，正在保存历史/收尾
 */
export type ExtractStage = 'fetching' | 'calling' | 'streaming' | 'finalizing';

export type PromptVersionSource = 'extracted' | 'edited' | 'restored' | 'refined';

export interface PromptVersion {
  id: string;
  prompt: string;
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
  meta?: { provider: ProviderId; model: string; style: OutputStyle };
}

export interface HistoryItem {
  id: string;
  imageUrl: string;
  thumbnail: string;
  prompt: string;
  provider: ProviderId;
  model: string;
  style: OutputStyle;
  pageUrl: string;
  pageTitle: string;
  createdAt: number;
  updatedAt?: number;
  versions: PromptVersion[];
  /** 用户置顶收藏，置顶项排在管理后台列表最前面 */
  pinned?: boolean;
  /** 用户给这条记录写的备注/标签，便于检索 */
  note?: string;
}

// === 消息协议 ===
export type RuntimeMessage =
  | {
      type: 'EXTRACT_PROMPT';
      payload: {
        imageUrl: string;
        pageUrl: string;
        pageTitle: string;
        requestId: string;
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
        /**
         * 本次反推使用的「提示词策略档位」id。
         *
         * 后台 service worker 在发送 PENDING 前为了让 panel 第一时间出现，
         * 不会等待 settings 读取完成，所以这里允许缺省；缺省时由后续的
         * EXTRACT_PROGRESS 再补发一次带 strategy 的更新即可。
         */
        strategy?: StrategyId;
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
      };
    }
  | {
      type: 'REFINE_PROMPT';
      payload: {
        historyId: string;
        instruction: string;
        current: string;
      };
    }
  | {
      type: 'PING';
    }
  | {
      type: 'CHECK_UPDATE';
    }
  | {
      /**
       * 内容脚本在用户按下右键时探测到鼠标位置的图片（含 <img> / <canvas> /
       * 内联 <svg> / CSS background-image），用于在原生 'image' 上下文菜单
       * 不出现时通过 fallback 菜单兜底。imageUrl 为空表示当前位置不是图片。
       */
      type: 'CTX_MENU_PREP';
      payload: { imageUrl: string };
    };

export interface RefineResponseOk {
  ok: true;
  prompt: string;
  provider: ProviderId;
  model: string;
  versionId: string;
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
}
