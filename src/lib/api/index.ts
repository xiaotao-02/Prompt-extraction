/**
 * @/lib/api 的对外门面（barrel）。
 *
 * 历史上整套 api 实现都堆在这一个文件里。重构后按职责拆到子模块：
 *   - extract.ts            视觉反推主入口
 *   - refine.ts             提示词重写
 *   - models.ts             /models 列表
 *   - providers/openai.ts   OpenAI 兼容（含智谱 / Qwen / SiliconFlow / 自定义）
 *   - providers/anthropic.ts Claude
 *   - providers/gemini.ts   Gemini
 *   - http.ts / url.ts      跨 provider 共用工具
 *   - types.ts              对外类型签名
 *
 * 业务代码继续 `import { extractPrompt, refinePrompt, listModels } from '@/lib/api'` 即可，
 * 不需要感知拆分。
 */
export { extractPrompt } from './extract';
export { refinePrompt } from './refine';
export { listModels } from './models';
export type {
  ExtractParams,
  ExtractResult,
  ExtractProgressEvent,
  RefineParams,
  RefineResult,
} from './types';
