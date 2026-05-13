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
  enabled: boolean;
  feedUrl: string;
  intervalHours: number;
  notifyDesktop: boolean;
  lastCheckedAt: number;
  lastResult: UpdateCheckResult | null;
  dismissedVersion: string;
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
      payload?: { force?: boolean };
    }
  | {
      type: 'CHECK_UPDATE_RESULT';
      payload: UpdateCheckResult;
    }
  | {
      type: 'APPLY_UPDATE';
    }
  | {
      type: 'APPLY_UPDATE_RESULT';
      payload: {
        ok: boolean;
        mode: 'native' | 'manual';
        message?: string;
        downloadUrl?: string;
        releaseUrl?: string;
      };
    }
  | {
      type: 'DISMISS_UPDATE';
      payload: { version: string };
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
