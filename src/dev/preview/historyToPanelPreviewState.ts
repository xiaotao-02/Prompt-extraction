import type { PanelState } from '@/content/panel/state';
import type { HistoryItem } from '@/lib/types';
import { DEFAULT_STRATEGY_ID } from '@/lib/strategies';
import { DEFAULT_ONE_CLICK_REWRITE_RANDOMNESS } from '@/lib/oneClickRewrite';

/** 对齐 content script 中 `PANEL_FROM_HISTORY` → `renderPanel` 的字段。 */
export function historyItemToPanelPreviewState(item: HistoryItem): PanelState {
  return {
    requestId: item.id,
    imageUrl: item.thumbnail || item.imageUrl,
    status: 'success',
    prompt: item.prompt,
    draft: item.prompt,
    provider: item.provider,
    model: item.model,
    versions: item.versions,
    versionsOpen: false,
    refineOpen: false,
    strategy: item.strategy ?? DEFAULT_STRATEGY_ID,
    rewriteRandomness: DEFAULT_ONE_CLICK_REWRITE_RANDOMNESS,
  };
}
