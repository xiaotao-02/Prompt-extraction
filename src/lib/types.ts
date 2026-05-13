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
 * 一档策略对应一组绑定的 stylePrompts + temperature + maxTokens + customPosition，
 * 具体定义见 {@link ./strategies.ts}。这里只保留 id 类型，避免 types.ts 反向依赖
 * strategies.ts。
 *
 *   - 'classic'  : 修改前 v0.1.0 经典策略（温度 0.4 / 上限 1024 / custom 尾部追加）
 *   - 'v016'     : v0.1.6 策略。数值与 classic 完全相同——因为从 v0.1.1 一直到
 *                  v0.1.6 这 6 个版本的 stylePrompts/temperature/maxTokens/customPosition
 *                  一字未改。保留为独立档位是为了给习惯按版本号回滚的用户一个
 *                  显式入口（"我就是要 v0.1.6 那一版的输出感"），并方便后续
 *                  在不动 classic 的前提下单独迭代这一档。
 *   - 'fidelity' : 修改后 v0.1.7 高保真策略（温度 0.8 / 上限 2048 / custom 前置 + 有序展开指令）
 */
export type StrategyId = 'classic' | 'v016' | 'fidelity';

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
   * 当前生效的提示词策略档位。决定 4 套 stylePrompts 的措辞、采样温度、
   * 输出上限、以及用户自定义模板的拼接位置。详见 {@link ./strategies.ts}。
   *
   * 老 settings 没有此字段 → 由 `getSettings` 合并 base 默认值时填上
   * `DEFAULT_STRATEGY_ID`，保证旧数据无缝升级。
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
         * "高保真 v0.1.7 / 经典 v0.1.0" 等档位标签亮出来。
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
