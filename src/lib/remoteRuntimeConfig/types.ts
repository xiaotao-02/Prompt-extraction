/**
 * 「远端运行时配置」：仅 whitelist 纯数据字段，扩展内逻辑固定解释。
 *
 * ⚠️ 禁止把远端字符串喂给 eval / Function / `new Blob`+URL+script，
 *    也不得实现“通用指令虚拟机”绕过商店对 RHC 的约束。
 */

export interface RemoteRuntimeConfigPayload {
  /** 当前仅定义 v1 schema；不匹配则整块丢弃。 */
  schemaVersion: 1;
  /** 设置页「检查更新」区块上方纯展示的公告（中文）；不受信为代码。 */
  announcementZh?: string;
  announcementEn?: string;
  /** 必须以 https:// 开头的文档／发布说明链接。 */
  docsUrl?: string;
  /**  semver `x.y.z`：低于该版本时在 UI 软性提示尽快从商店更新；不改变扩展执行路径。 */
  minRecommendedExtensionVersion?: string;
}

export interface RemoteRuntimeConfigCache {
  /** 最近一次发起 fetch 尝试的时间戳（节流用，含失败）。 */
  lastFetchAttemptAt: number;
  /** 最近一次校验通过并成功解析的时间戳 */
  lastSuccessAt: number | null;
  lastError?: string;
  payload: RemoteRuntimeConfigPayload | null;
}
