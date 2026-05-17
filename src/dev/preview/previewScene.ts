/**
 * 开发预览 iframe 的场景（由 URL `?scene=` 驱动）。
 * 在 {@link ../../lib/storage/historyDb.ts} 中作为首依赖导入，确保首次 `indexedDB.open`
 * 前已写入库名覆盖（例如空库预览）。
 */
const DEFAULT_SCENE = 'default';

function readSceneFromLocation(): string {
  if (typeof globalThis.location?.search !== 'string') return DEFAULT_SCENE;
  try {
    const raw = new URLSearchParams(globalThis.location.search).get('scene');
    if (!raw) return DEFAULT_SCENE;
    const s = raw.trim().toLowerCase();
    return s || DEFAULT_SCENE;
  } catch {
    return DEFAULT_SCENE;
  }
}

const INITIAL_SCENE = readSceneFromLocation();

if (INITIAL_SCENE === 'empty') {
  const g = globalThis as unknown as { __PE_PREVIEW_HISTORY_DB__?: string };
  g.__PE_PREVIEW_HISTORY_DB__ = 'prompt-extracto-library-dev-preview-empty';
}

export function getDevPreviewScene(): string {
  return INITIAL_SCENE;
}
