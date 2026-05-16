/**
 * 远端「纯数据」配置的默认开关位。
 *
 * - 默认不提供公网 JSON URL：`fetch` 链路在发布后处于关闭状态。
 * - 填入 **仅 HTTPS** 的静态 JSON（或你方 CDN）地址后，`background` 会在冷启动节流窗口内偶尔拉取一次。
 *
 * 【隐私披露】若在商店上架版本中开启 URL，建议在商店「隐私／数据用途」一节注明：
 * 「扩展会向该 HTTPS 地址请求一份小型 JSON（例如公告文案、文档链接），不携带用户密钥或提问内容。」
 */

/** `fetch` GET；留空则不发起任何远端配置请求（推荐默认）。 */
export const REMOTE_RUNTIME_CONFIG_URL = '';

/**
 * Base64(URL-safe 或标准均可)编码的 **32 字节 Raw Ed25519 公钥**，用于校验带签 envelope。
 * - 为空：仅接受顶层未签名的 whitelist JSON（仍需 HTTPS）。
 * - 非空：**仅接受** `{ __signature*, __signaturePayload* }` 信封；避免“误以为已签名”的中间态。
 */
export const REMOTE_RUNTIME_CONFIG_PUBLIC_KEY_RAW_B64 = '';

/** GET 超时（毫秒）；失败则降级为缓存上一次成功载荷。 */
export const REMOTE_RUNTIME_CONFIG_FETCH_TIMEOUT_MS = 8000;

/** 响应正文最大可读字节（防 DoS）；超出则丢弃。 */
export const REMOTE_RUNTIME_CONFIG_MAX_BODY_BYTES = 24 * 1024;

/** SW 节流：两次拉取尝试之间的最小间隔。 */
export const REMOTE_RUNTIME_CONFIG_REFRESH_COOLDOWN_MS = 6 * 3600 * 1000;

/** announcement 单行最大 Unicode 字符数。 */
export const REMOTE_RUNTIME_CONFIG_MAX_ANNOUNCE_LEN = 800;

/** URL 字段最大字符数（仅允许 https）。 */
export const REMOTE_RUNTIME_CONFIG_MAX_URL_LEN = 512;
