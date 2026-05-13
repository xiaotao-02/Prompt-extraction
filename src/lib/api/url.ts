/**
 * Provider baseUrl 归一化。
 *
 * 这两个函数被 OpenAI 兼容、Anthropic、Gemini 三家协议共用，
 * 抽到独立文件避免 provider 实现互相依赖。
 */

/**
 * 去掉末尾的 `/`，并修正常见的「版本号大写」拼写错误。
 *
 * 用户经常按文档抄成 `/V1`、`/V2`、`/V1beta` 等大写版本号，
 * 但几乎所有 API 服务端的路由都是小写。这里只针对 `/V<digit>` 这一段做小写化，
 * 不会改动其它 path（避免破坏区分大小写的租户名 / 项目 ID 等）。
 *
 * 例如：
 *   `https://ai.shukelongda.cn/V1`   → `https://ai.shukelongda.cn/v1`
 *   `https://example.com/Tenant/V1/` → `https://example.com/Tenant/v1`
 */
export function trimSlash(s: string): string {
  return s.replace(/\/+$/, '').replace(/\/V(\d+)/g, '/v$1');
}

/**
 * 把 OpenAI 兼容协议的 baseUrl 归一化。
 *
 * 用户很容易把 baseUrl 填成裸域名（例如 `https://ai.shukelongda.cn`），
 * 然后请求被拼成 `https://ai.shukelongda.cn/chat/completions`，
 * 被前端网关当作普通网页请求并返回 HTML 首页，最终导致
 * `Unexpected token '<'` 这种让人摸不着头脑的错误。
 *
 * 这里在拼接前做两件事：
 * 1. 通过 `trimSlash` 修掉末尾斜杠并把大写 `/V1` 改成 `/v1`；
 * 2. 如果 baseUrl 没有任何路径段（只有 origin），自动补一个 `/v1`
 *    ——这对几乎所有 OpenAI 兼容服务都成立。
 *
 * 对已经带路径的 baseUrl（如 `…/v1`、`…/api/paas/v4`、`…/compatible-mode/v1`）
 * 不再额外补 `/v1`，保持向后兼容。
 */
export function normalizeOpenAIBase(raw: string): string {
  const trimmed = trimSlash((raw || '').trim());
  try {
    const u = new URL(trimmed);
    if (u.pathname === '' || u.pathname === '/') {
      return `${u.origin}/v1`;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}
