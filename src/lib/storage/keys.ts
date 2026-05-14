/** Storage 键名单独成文件，content 脚本可仅依赖本文件而不拉取 `settings.ts` → `strategies` 重包。 */

export const SETTINGS_KEY = 'app_settings_v1';

/**
 * 「从端点拉取的模型列表」缓存所在的 local storage 键（与 SETTINGS_KEY 分离见 settings.ts 注释）。
 */
export const DISCOVERED_KEY = 'discovered_models_v1';
