import type { ProviderId, ProviderMeta } from './types';

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.5',
    docsUrl: 'https://platform.openai.com/api-keys',
    description: '官方 GPT 系列视觉模型，识别效果稳定，需要海外网络',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Claude 3.5，描述细腻，适合自然语言提示词',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    docsUrl: 'https://aistudio.google.com/apikey',
    description: 'Google Gemini，速度快、免费额度足',
  },
  zhipu: {
    id: 'zhipu',
    label: '智谱 GLM',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4v-flash',
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    description: '智谱 GLM-4V，国产视觉模型，glm-4v-flash 免费',
  },
  qwen: {
    id: 'qwen',
    label: '通义千问 Qwen-VL',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-vl-max-latest',
    docsUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    description: '阿里云百炼 Qwen-VL，国产视觉旗舰',
  },
  siliconflow: {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/deepseek-vl2',
    docsUrl: 'https://cloud.siliconflow.cn/account/ak',
    description: '聚合多家开源 VL 模型，含 DeepSeek-VL2，国内可直连',
  },
  shukelongda: {
    id: 'shukelongda',
    label: '数科隆达 中转',
    defaultBaseUrl: 'https://ai.shukelongda.cn/v1',
    defaultModel: 'gpt-5.5',
    docsUrl: 'https://ai.shukelongda.cn',
    description: '第三方 OpenAI 兼容中转网关，可聚合多家模型；需自行到该站点申请 Key',
  },
  custom: {
    id: 'custom',
    label: '自定义 (OpenAI 兼容)',
    defaultBaseUrl: 'https://your-endpoint.com/v1',
    defaultModel: 'your-model',
    docsUrl: '',
    description: '任何 OpenAI Chat Completions 协议兼容的服务',
  },
};

export const PROVIDER_LIST: ProviderMeta[] = Object.values(PROVIDERS);
