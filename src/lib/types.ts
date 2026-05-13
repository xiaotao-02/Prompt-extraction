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
}

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
  modelOptions: string[];
  docsUrl: string;
  description: string;
}
