import {
  KEEPALIVE_PORT_PREP_KIND,
  PROMPT_EXTRACTO_KEEPALIVE_PORT,
  type CtxMenuPrepPayload,
  type KeepaliveCtxPrepEnvelope,
} from '@/lib/keepalivePort';
import { isExtensionContextValid } from '@/content/extensionBridge';

let keepalivePort: chrome.runtime.Port | null = null;

function connectKeepalivePort(): void {
  if (!isExtensionContextValid()) return;
  try {
    const port = chrome.runtime.connect({ name: PROMPT_EXTRACTO_KEEPALIVE_PORT });
    keepalivePort = port;
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      keepalivePort = null;
      if (!isExtensionContextValid()) return;
      window.setTimeout(connectKeepalivePort, 800);
    });
  } catch {
    keepalivePort = null;
    /* ignore */
  }
}

/** 先于 sendMessage，让 SW 尽快收到 prep，减轻兜底菜单更新竞态。 */
export function postCtxMenuPrepViaKeepalivePort(payload: CtxMenuPrepPayload): void {
  if (!keepalivePort) return;
  try {
    const env: KeepaliveCtxPrepEnvelope = { kind: KEEPALIVE_PORT_PREP_KIND, payload };
    keepalivePort.postMessage(env);
  } catch {
    /* port 已断开 */
  }
}

connectKeepalivePort();
