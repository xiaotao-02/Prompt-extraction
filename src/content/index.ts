import type { RuntimeMessage } from '@/lib/types';
import { renderPanel, updatePanel, closePanel } from './panel';

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'EXTRACT_PENDING') {
    renderPanel({
      requestId: message.payload.requestId,
      imageUrl: message.payload.imageUrl,
      status: 'loading',
    });
    return false;
  }
  if (message.type === 'EXTRACT_RESULT') {
    updatePanel(message.payload.requestId, {
      status: 'success',
      prompt: message.payload.prompt,
      provider: message.payload.provider,
      model: message.payload.model,
    });
    return false;
  }
  if (message.type === 'EXTRACT_ERROR') {
    updatePanel(message.payload.requestId, {
      status: 'error',
      error: message.payload.error,
    });
    return false;
  }
  return false;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
});
