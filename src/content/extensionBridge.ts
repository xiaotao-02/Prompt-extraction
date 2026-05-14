/**
 * 内容脚本与安全 runtime 交互的共用入口。
 * （避免多处复制 isContextValid / safeSendMessage，防止未来行为分叉。）
 */
export function isExtensionContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

/**
 * 安全发送消息。上下文失效时静默忽略，避免 Uncaught Error。
 */
export function safeSendMessage(
  message: unknown,
  callback?: (response: unknown) => void
): void {
  if (!isExtensionContextValid()) return;
  try {
    if (callback) {
      chrome.runtime.sendMessage(message, callback);
    } else {
      chrome.runtime.sendMessage(message);
    }
  } catch {
    /* context invalidated */
  }
}
