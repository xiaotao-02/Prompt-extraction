import type { PanelState } from '@/content/panel/state';
import { DEFAULT_STRATEGY_ID } from '@/lib/strategies';
import { DEFAULT_ONE_CLICK_REWRITE_RANDOMNESS } from '@/lib/oneClickRewrite';

function devPreviewThumb(label: string): string {
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90">
      <rect fill="#e4e4e7" width="120" height="90" rx="8"/>
      <text x="60" y="50" text-anchor="middle" fill="#52525b" font-size="10" font-family="system-ui,sans-serif">${label}</text>
    </svg>`
    )
  );
}

/** 不读 IndexedDB 的合成面板状态，供开发 UI 预览。 */
export function syntheticPanelStateFromScene(scene: string): PanelState | null {
  const s = scene.trim().toLowerCase();
  const img = devPreviewThumb('合成');
  const startedAt = Date.now() - 8000;
  const strategyExtras = {
    strategy: DEFAULT_STRATEGY_ID,
    rewriteRandomness: DEFAULT_ONE_CLICK_REWRITE_RANDOMNESS,
  } as const;

  if (s === 'loading') {
    return {
      requestId: 'dev-preview-loading',
      imageUrl: img,
      imageUrls: [img],
      status: 'loading',
      stage: 'streaming',
      partial: '一只琥珀色眼睛的猫头鹰，落在覆雪的夜晚树枝上，细节随流式输出逐步呈现……',
      startedAt,
      provider: 'openai',
      model: 'gpt-4o-mini',
      ...strategyExtras,
      versions: [],
      versionsOpen: false,
      refineOpen: false,
      draft: '',
    };
  }

  if (s === 'error') {
    return {
      requestId: 'dev-preview-error',
      imageUrl: img,
      imageUrls: [img],
      status: 'error',
      error: '预览：反推失败（占位）。可检查 API Key、网络或模型可用性。',
      prompt: '（失败后编辑器可展示缓存或占位 copy）',
      draft: '',
      provider: 'openai',
      model: 'gpt-4o-mini',
      ...strategyExtras,
      versions: [],
    };
  }

  if (s === 'compose') {
    return {
      requestId: 'dev-preview-compose',
      imageUrl: img,
      imageUrls: [img],
      status: 'compose',
      draft: '',
      ...strategyExtras,
      versions: [],
    };
  }

  return null;
}
