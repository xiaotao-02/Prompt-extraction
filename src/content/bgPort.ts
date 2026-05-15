import { PROMPT_EXTRACTO_KEEPALIVE_PORT } from '@/lib/keepalivePort';
import { isExtensionContextValid } from '@/content/extensionBridge';

function connectKeepalivePort(): void {
  if (!isExtensionContextValid()) return;
  try {
    const port = chrome.runtime.connect({ name: PROMPT_EXTRACTO_KEEPALIVE_PORT });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (!isExtensionContextValid()) return;
      window.setTimeout(connectKeepalivePort, 800);
    });
  } catch {
    /* ignore */
  }
}

connectKeepalivePort();
