/**
 * 【扩展「在线更新」与绕过审核的现实边界 —— 在产品代码中的固定说明】
 *
 * ### 请先确认你到底要解决哪一类问题
 *
 * 1. **「用户侧无感更新」（无需用户手动重装 .crx / 再找 zip）**
 *    - Chromium 自带机制：当你在 **Chrome Web Store / Microsoft Partner Center** 发布并通过审核的新版本后，
 *      浏览器会**自动分发**扩展更新包给用户；用户不需要再走一遍安装向导。
 *    - **这不是绕过审核**：你仍要为每个版本打包、上传并接受商店审核。
 *
 * 2. **「开发者希望永远不再上传商店包、用热修补丁替代审核」**
 *    - 在 Manifest V3 与 Chromium 商店政策下，**远端下载并执行的 JavaScript/WebAssembly /
 *      可被当作程序解释执行的通用字节码**，通常归为 **Remote Hosted Code（远程托管代码）**，**不允许**
 *      用作替代商店提交的「核心业务逻辑补丁」路径。
 *    - Prompt Extracto 若只 `fetch()` **纯 JSON 配置数据**并在**已提交的扩展代码**里按固定 whitelist
 *      字段解释，且不引入“远程脚本执行器 / eval / Function 拼装执行远程字符串”等行为，才可视为在政策讨论里
 *      更接近「远端数据」范式；即便如此，也应在商店隐私说明与合作方政策语境下自检是否充分披露数据来源。
 *
 * ### 推荐阅读（外链以官方文档为准）
 *
 * - Remote hosted code：https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
 * - MV3 program policies：https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
 * - Edge 开发者政策：https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies
 */

/** 占位导出，便于从依赖图确认本模块在政策说明上的职责边界。 */
export const REMOTE_RUNTIME_CONFIG_POLICY_MARKER = Symbol.for(
  '@prompt-extracto/remote-runtime-config-policy'
);
