import type { HistoryItem, PromptVersion } from '@/lib/types';
import { getHistoryItem, historyCount } from '@/lib/storage';
import { bulkPutHistoryItems } from '@/lib/storage/historyDb';
import { migrateItem, finalizeHistoryMutation } from '@/lib/storage/history';

/** Popup / Options / Panel 开发预览共用首条占位记录 id。 */
export const PREVIEW_DEMO_PRIMARY_ID = 'preview-demo-1' as const;

/** SD 标签风格占位（单版本、置顶）。 */
export const PREVIEW_DEMO_SD_TAGS_ID = 'preview-demo-2' as const;

/** 含 refined 源的双版本占位。 */
export const PREVIEW_DEMO_REFINED_PAIR_ID = 'preview-demo-3' as const;

/** 开发预览：10 版本链条（Popup 折叠列表 >6 条）占位记录 id。 */
export const PREVIEW_DEMO_TEN_VERSIONS_ID = 'preview-demo-10v' as const;

/** 四条占位记录在库中的顺序（与 `ensurePreviewLibrarySeed` 写入批次一致）。 */
export const PREVIEW_DEMO_ALL_IDS = [
  PREVIEW_DEMO_PRIMARY_ID,
  PREVIEW_DEMO_SD_TAGS_ID,
  PREVIEW_DEMO_REFINED_PAIR_ID,
  PREVIEW_DEMO_TEN_VERSIONS_ID,
] as const;

/** Panel 开发预览 iframe 默认加载本条（便于测长版本列表 UI）。 */
export const PREVIEW_DEMO_PANEL_DEFAULT_ID = PREVIEW_DEMO_TEN_VERSIONS_ID;

function demoThumb(seed: string): string {
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90">
      <rect fill="#e4e4e7" width="120" height="90" rx="8"/>
      <text x="60" y="50" text-anchor="middle" fill="#52525b" font-size="10" font-family="system-ui,sans-serif">预览 ${seed}</text>
    </svg>`
    )
  );
}

/** 构建四条开发预览占位记录（已 migrate）。`base` 为锚点时间戳，用于相对稳定的时间线。 */
export function buildPreviewSeedItems(base: number): HistoryItem[] {
  const img1 = demoThumb('1');
  const img2 = demoThumb('2');
  const img3 = demoThumb('3');
  const t0 = base - 180_000;
  const t1 = base - 120_000;
  const t2 = base - 60_000;

  const vExtracted: PromptVersion = {
    id: `${PREVIEW_DEMO_PRIMARY_ID}:v0`,
    prompt: '一碗热气腾腾的日式拉面，木制桌面，暖色侧光，食欲感强。',
    versionNo: 0,
    createdAt: t0,
    source: 'extracted',
    meta: { provider: 'openai', model: 'gpt-4o-mini', style: 'natural-zh' },
  };
  const vEdited: PromptVersion = {
    id: `${PREVIEW_DEMO_PRIMARY_ID}:v1`,
    prompt:
      '一碗热气腾腾的日式拉面，木制桌面，暖色侧光，浅景深，8k 画质，电影感构图。（已人工润色占位）',
    versionNo: 1,
    createdAt: t1,
    source: 'edited',
  };

  const item1: HistoryItem = {
    id: PREVIEW_DEMO_PRIMARY_ID,
    imageUrl: img1,
    thumbnail: img1,
    prompt: vEdited.prompt,
    provider: 'openai',
    model: 'gpt-4o-mini',
    style: 'natural-zh',
    pageUrl: 'https://example.com/preview-gallery',
    pageTitle: '预览 · 占位页面 A',
    createdAt: t0,
    updatedAt: t1,
    versions: [vEdited, vExtracted],
    note: '双版本 · 可展开历史',
  };

  const v2a: PromptVersion = {
    id: `${PREVIEW_DEMO_SD_TAGS_ID}:v0`,
    prompt: '赛博朋克雨夜街景，霓虹倒影，电影宽画幅。',
    versionNo: 0,
    createdAt: base - 240_000,
    source: 'extracted',
    meta: { provider: 'openai', model: 'gpt-4o', style: 'sd-tags' },
  };

  const item2: HistoryItem = {
    id: PREVIEW_DEMO_SD_TAGS_ID,
    imageUrl: img2,
    thumbnail: img2,
    prompt: v2a.prompt,
    provider: 'openai',
    model: 'gpt-4o',
    style: 'sd-tags',
    pageUrl: 'https://example.com/neon-city',
    pageTitle: '预览 · SD 标签风格占位',
    createdAt: base - 240_000,
    updatedAt: base - 240_000,
    versions: [v2a],
    pinned: true,
  };

  const v3a: PromptVersion = {
    id: `${PREVIEW_DEMO_REFINED_PAIR_ID}:v0`,
    prompt: '水彩风森林小径，晨雾，柔和绿色调。',
    versionNo: 0,
    createdAt: t2,
    source: 'extracted',
    meta: { provider: 'anthropic', model: 'claude-3-5-sonnet-latest', style: 'natural-en' },
  };
  const v3b: PromptVersion = {
    id: `${PREVIEW_DEMO_REFINED_PAIR_ID}:v1`,
    prompt:
      'A watercolor forest trail at dawn, soft green palette, mist among the trees. (placeholder)',
    versionNo: 1,
    createdAt: t2 + 5000,
    source: 'refined',
    meta: { provider: 'anthropic', model: 'claude-3-5-sonnet-latest', style: 'natural-en' },
  };

  const item3: HistoryItem = {
    id: PREVIEW_DEMO_REFINED_PAIR_ID,
    imageUrl: img3,
    thumbnail: img3,
    prompt: v3b.prompt,
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-latest',
    style: 'natural-en',
    pageUrl: 'https://example.com/watercolor',
    pageTitle: '预览 · 含 refined 占位',
    createdAt: t2,
    updatedAt: t2 + 5000,
    versions: [v3b, v3a],
  };

  const img10 = demoThumb('10v');
  const t10 = base - 200_000;
  const tenStep = 15_000;
  const tenPrompts = [
    '冷萃咖啡夏季促销海报草稿：清爽蓝白主色，冰杯与咖啡豆静物，横版 16:9。',
    '冷萃咖啡夏季促销海报：蓝白渐变底，半透明冰块与冷凝水珠，横版 16:9。',
    '冷萃咖啡夏季促销海报：蓝白渐变底，冰块与冷凝水珠强化，顶部大标题区、底部卖点条，横版 16:9。（人工改稿）',
    '冷萃咖啡夏季促销海报：蓝白渐变与浅橙点缀，标题区「夏日冷萃」字重对比，底部三条卖点，横版 16:9。',
    '冷萃咖啡夏季促销海报：蓝白渐变、浅橙点缀，左侧产品特写、右侧留白给价格条，玻璃台面条反光，横版 16:9。',
    '冷萃咖啡夏季促销海报：构图改为中心对称杯体，价格条加粗，去掉过多装饰线。（人工改稿）',
    '冷萃咖啡夏季促销海报：中心对称杯体，价格条加粗，背景轻颗粒与柔边光斑，整体轻商务风，横版 16:9。',
    '冷萃咖啡夏季促销海报：中心杯体、粗价格条，轻颗粒背景；左上角小 logo、右下角扫码角标，横版 16:9。',
    '冷萃咖啡夏季促销海报：扫码角标缩小，标题字距略收紧，价格条对比度 +5%。（人工改稿）',
    '冷萃咖啡夏季促销海报定稿：中心杯体、蓝白渐变 + 浅橙点缀，粗体价格条与三条卖点，左上 logo、右下小号扫码区，轻颗粒背景与柔边光斑，轻商务夏季促销，横版 16:9。',
  ] as const;
  const tenSources: PromptVersion['source'][] = [
    'extracted',
    'refined',
    'edited',
    'refined',
    'extracted',
    'edited',
    'refined',
    'extracted',
    'edited',
    'refined',
  ];
  const tenMetas: (PromptVersion['meta'] | undefined)[] = [
    { provider: 'openai', model: 'gpt-4o-mini', style: 'natural-zh' },
    { provider: 'openai', model: 'gpt-4o', style: 'natural-zh' },
    undefined,
    { provider: 'openai', model: 'gpt-4o', style: 'natural-zh' },
    { provider: 'zhipu', model: 'glm-4-flash', style: 'natural-zh' },
    undefined,
    { provider: 'anthropic', model: 'claude-3-5-sonnet-latest', style: 'natural-zh' },
    { provider: 'deepseek', model: 'deepseek-chat', style: 'natural-zh' },
    undefined,
    { provider: 'openai', model: 'gpt-4o-mini', style: 'natural-zh' },
  ];
  const tenVersions: PromptVersion[] = tenPrompts.map((prompt, n) => ({
    id: `${PREVIEW_DEMO_TEN_VERSIONS_ID}:v${n}`,
    prompt,
    versionNo: n,
    createdAt: t10 + n * tenStep,
    source: tenSources[n]!,
    ...(tenMetas[n] ? { meta: tenMetas[n] } : {}),
  }));
  const vTenLatest = tenVersions[9]!;
  const itemTen: HistoryItem = {
    id: PREVIEW_DEMO_TEN_VERSIONS_ID,
    imageUrl: img10,
    thumbnail: img10,
    prompt: vTenLatest.prompt,
    provider: vTenLatest.meta!.provider,
    model: vTenLatest.meta!.model,
    style: vTenLatest.meta!.style,
    pageUrl: 'https://example.com/cold-brew-poster',
    pageTitle: '预览 · 10 版本占位',
    createdAt: t10,
    updatedAt: vTenLatest.createdAt,
    versions: tenVersions,
    note: '10 版本 · 折叠预览',
  };

  return [item1, item2, item3, itemTen].map(migrateItem);
}

/**
 * 开发预览：占位历史写入 IndexedDB。
 *
 * - 库为空：一次性写入四条（含 10 版本链 `preview-demo-10v`）。
 * - 库非空：只为缺失的 `PREVIEW_DEMO_*` id 补写，避免老预览库永远看不到后来新增的种子。
 */
export async function ensurePreviewLibrarySeed(): Promise<void> {
  const base = Date.now();
  const items = buildPreviewSeedItems(base);

  if ((await historyCount()) === 0) {
    await bulkPutHistoryItems(items);
    await finalizeHistoryMutation();
    return;
  }

  const missing: HistoryItem[] = [];
  for (const it of items) {
    if (!(await getHistoryItem(it.id))) missing.push(it);
  }
  if (missing.length === 0) return;
  await bulkPutHistoryItems(missing);
  await finalizeHistoryMutation();
}
