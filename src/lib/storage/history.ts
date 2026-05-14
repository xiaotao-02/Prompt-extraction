import type { HistoryItem, PromptVersion } from '../types';
import { notifyBackupSubscribers } from './events';

const HISTORY_KEY = 'history_v1';
/**
 * 「同图记录已合并」一次性迁移标记。
 *
 * 旧版本一张图反推 N 次会生成 N 条独立 HistoryItem，新版本改为合并到同一条的
 * versions 里。第一次冷启读 history 时检测到此 flag 不存在，就把现有数据按
 * imageUrl/thumbnail 去重一次，然后写入 flag。后续每次写入都是"先合并后落盘"，
 * 不会再产生重复条目。
 */
const HISTORY_DEDUP_FLAG = 'history_dedup_by_image_v1';
// 后台管理页支持的最大记录数。提升到 300 是因为「提示词库」鼓励用户长期保留与整理结果。
// 由于 chrome.storage.local 配额为 5MB 且我们已经把缩略图直接复用原图 URL，几乎不会触顶。
export const HISTORY_LIMIT = 300;

export function migrateItem(raw: HistoryItem): HistoryItem {
  if (raw.versions && raw.versions.length > 0) return raw;
  const seedVersion: PromptVersion = {
    id: raw.id + ':v0',
    prompt: raw.prompt,
    createdAt: raw.createdAt || Date.now(),
    source: 'extracted',
  };
  return {
    ...raw,
    updatedAt: raw.updatedAt ?? raw.createdAt,
    versions: [seedVersion],
  };
}

/**
 * History 内存缓存。
 *
 * 为什么需要：`HISTORY_LIMIT = 300` + 每条带 ~32KB 缩略图 dataUrl，整段 history JSON
 * 累积起来可达 5–10MB。原本 `addHistory` 流程是「`storage.local.get` 反序列化整段 →
 * unshift → `storage.local.set` 序列化整段」，每次右键抽图都要为此付出 100–300ms
 * 同步 IPC + JSON 开销。**因为 service worker 是单线程**，这会让"刚抽完上一张、紧
 * 接着抽下一张"明显卡一拍；并且开销随历史条数线性增长，正好对应用户感觉到的
 * 「越用越慢」。
 *
 * 缓存策略：
 * - 首次读时从 storage 反序列化一份并存到 `historyCache`
 * - 之后的所有 read/write 都直接走缓存（write 会同步把数组替换并异步写回 storage）
 * - 其它 context（options / popup）修改了 history 时，通过 `storage.onChanged` 监听
 *   及时使缓存失效 / 同步
 *
 * service worker 30s 闲置销毁后第一次冷启会重读一次，这是预期且可接受的成本。
 */
export let historyCache: HistoryItem[] | null = null;

/**
 * 把外部 `storage.onChanged` 事件传过来的新值同步进缓存。
 *
 * 注意：因为 `storage.local.set` 会把内层对象做结构化克隆后回传，
 * 不能用引用相等保证 newValue === 我们刚写进去的那份；这里始终重建一份。
 */
function syncHistoryCacheFromExternal(rawNew: unknown): void {
  if (!Array.isArray(rawNew)) {
    historyCache = null;
    return;
  }
  try {
    historyCache = (rawNew as HistoryItem[]).map(migrateItem);
  } catch {
    historyCache = null;
  }
}

// service worker / options / popup 都能跑到这一行：监听 storage 跨 context 变化，
// 保证不同 context 里的 historyCache 不会发生分歧。
try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    if (HISTORY_KEY in changes) {
      syncHistoryCacheFromExternal(changes[HISTORY_KEY].newValue);
    }
  });
} catch {
  /* 测试环境 / 无 chrome.storage 时静默 */
}

/**
 * 「同一张图」判定。
 *
 * - 优先比较 `imageUrl`：完全相等即视为同一张。注意短小 URL（如 `''` / `'about:blank'`）
 *   不参与比较，避免空字符串/异常占位互相吸附成一组。
 * - 回退：比较 `thumbnail` dataUrl。两次写入若都走过 `makeStorageThumbnail`，
 *   对同一原图通常会落到相同 base64；长度阈值过滤掉占位/空值。
 */
function isSameImage(a: HistoryItem, b: HistoryItem): boolean {
  const ua = a.imageUrl || '';
  const ub = b.imageUrl || '';
  if (ua && ub && ua.length > 8 && ua === ub) return true;
  const ta = a.thumbnail || '';
  const tb = b.thumbnail || '';
  if (ta && tb && ta.length > 64 && ta === tb) return true;
  return false;
}

/**
 * 一次性把现有 history 里"识别同一张图片的多条记录"按图合并到同一条 versions 里。
 *
 * 规则：
 * - 同一组里以"最近活跃（updatedAt/createdAt 最大）"的那条为主条；其他条目里
 *   的 versions 整体追加进主条，按 createdAt 倒序排列；主条 prompt/updatedAt 等
 *   元数据来自最新版本。
 * - 任何一条 `pinned=true` → 合并后主条 pinned；其余 note 字段择最新者一份。
 *
 * 仅在 `HISTORY_DEDUP_FLAG` 不存在时执行一次；执行后写入标记。
 */
function dedupHistoryByImage(list: HistoryItem[]): HistoryItem[] {
  if (list.length <= 1) return list;
  const groups: HistoryItem[][] = [];
  for (const item of list) {
    let matched: HistoryItem[] | null = null;
    for (const g of groups) {
      if (isSameImage(g[0], item)) {
        matched = g;
        break;
      }
    }
    if (matched) matched.push(item);
    else groups.push([item]);
  }
  if (groups.every((g) => g.length === 1)) return list;
  return groups.map((g) => {
    if (g.length === 1) return g[0];
    const sorted = [...g].sort(
      (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
    );
    const head = sorted[0];
    const allVersions: PromptVersion[] = [];
    const seen = new Set<string>();
    for (const it of sorted) {
      for (const v of it.versions || []) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        allVersions.push(v);
      }
    }
    allVersions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const top = allVersions[0] || head.versions?.[0];
    return {
      ...head,
      prompt: top?.prompt ?? head.prompt,
      updatedAt: top?.createdAt ?? head.updatedAt,
      versions: allVersions,
      pinned: sorted.some((it) => it.pinned) || undefined,
      note: sorted.map((it) => it.note).find((n) => n && n.trim()) || head.note,
    };
  });
}

let dedupRan = false;
async function maybeRunDedupMigration(list: HistoryItem[]): Promise<HistoryItem[]> {
  if (dedupRan) return list;
  try {
    const flag = await chrome.storage.local.get(HISTORY_DEDUP_FLAG);
    if (flag[HISTORY_DEDUP_FLAG]) {
      dedupRan = true;
      return list;
    }
    const next = dedupHistoryByImage(list);
    if (next !== list && next.length !== list.length) {
      historyCache = next;
      await chrome.storage.local.set({ [HISTORY_KEY]: next });
    }
    await chrome.storage.local.set({ [HISTORY_DEDUP_FLAG]: Date.now() });
    dedupRan = true;
    return next;
  } catch (err) {
    console.debug('[PromptExtracto] history dedup migration failed', err);
    dedupRan = true;
    return list;
  }
}

export async function getHistory(): Promise<HistoryItem[]> {
  if (!historyCache) {
    const data = await chrome.storage.local.get(HISTORY_KEY);
    const raw = (data[HISTORY_KEY] as HistoryItem[]) || [];
    historyCache = raw.map(migrateItem);
  }
  if (!dedupRan) {
    historyCache = await maybeRunDedupMigration(historyCache);
  }
  // 返回浅拷贝：原代码契约里 mutator（addHistory / patchHistoryItem 等）会直接
  // mutate 自己拿到的 list 再 writeHistory；调用方 (PromptLibrary 等) 拿到的引用
  // 不应被这些 mutate 偷偷修改。slice() 在 300 条以内是微秒级，不构成开销。
  return historyCache.slice();
}

export async function writeHistory(list: HistoryItem[]): Promise<void> {
  // 先更新内存缓存，确保紧随其后的 getHistory 不需要等 storage 落盘就能拿到最新值
  historyCache = list;
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
  notifyBackupSubscribers();
}

/**
 * 把一条新提取结果写入历史。
 *
 * 关键行为：**自动按图片去重**。
 *
 * - 如果列表里已存在「同一张图」的记录（参见 {@link isSameImage}），则把新结果
 *   作为一条新的 PromptVersion（source='extracted'，带 meta 描述这次用到的
 *   provider/model/style）追加进原记录的 versions，并把原记录的 prompt / updatedAt /
 *   provider / model / style 同步成新结果（代表"当前展示"指向最新这一次反推），
 *   同时把该记录顶到列表最前。**不会**重复创建条目。
 * - 如果不存在同图记录，行为退化为老逻辑：把新条目 unshift 到列表头部，并按
 *   HISTORY_LIMIT 截尾。
 *
 * 这样设计的好处：
 *   1. 同一张图反复反推，只会在一条记录下增长 versions 列表，列表始终整洁。
 *   2. 历史里第一条版本永远是"最新一次反推"，符合 popup 列表"最新在上"的直觉。
 *   3. 不同 provider/model 的结果都以版本形式保存下来，可在版本列表里通过 meta 区分。
 */
/**
 * 返回值是「最终落库的那条 HistoryItem」——可能是新插入的 incoming 本身，
 * 也可能是合并到旧记录后产生的 merged（id 还是 existing 的 id）。
 *
 * 调用方（background.runExtraction）需要拿到这个返回值来通知 content：
 * 「你手里那个 requestId 在 storage 里实际对应的是哪条 id / 此刻的 versions」，
 * 否则同图反推时 content 会一直拿着一个 storage 里不存在的 id 去 save / restore
 * / syncVersions，全部 findIndex<0 静默失败 → 用户看到「编辑后历史版本没更新」。
 */
export async function addHistory(item: HistoryItem): Promise<HistoryItem> {
  const list = await getHistory();
  const incoming = migrateItem(item);
  const existingIdx = list.findIndex((it) => isSameImage(it, incoming));
  if (existingIdx >= 0) {
    const existing = list[existingIdx];
    // 把"这次反推产生的那一条版本"提出来，加上 meta，方便版本列表里区分。
    const incomingHead = incoming.versions[0];
    const newVersion: PromptVersion = {
      id: incomingHead?.id || newVersionId(),
      prompt: incoming.prompt,
      createdAt: incomingHead?.createdAt || incoming.createdAt || Date.now(),
      source: 'extracted',
      meta: {
        provider: incoming.provider,
        model: incoming.model,
        style: incoming.style,
      },
    };
    // 老 versions 没有 meta 时，按 existing 的当前 provider/model/style 回填一份，
    // 这样新旧版本在 UI 上都能看到归属，避免"只有最新一条带 meta"的视觉断层。
    const oldVersions = (existing.versions || []).map<PromptVersion>((v) =>
      v.meta
        ? v
        : {
            ...v,
            meta: {
              provider: existing.provider,
              model: existing.model,
              style: existing.style,
            },
          }
    );
    const merged: HistoryItem = {
      ...existing,
      // 当前指向最新一次反推：prompt + provider/model/style + updatedAt 都同步过去。
      prompt: incoming.prompt,
      provider: incoming.provider,
      model: incoming.model,
      style: incoming.style,
      // imageUrl / thumbnail / pageUrl / pageTitle 保留 existing 的，避免抖动；
      // 但若 existing 的对应字段为空，用 incoming 的补上一次。
      imageUrl: existing.imageUrl || incoming.imageUrl,
      thumbnail: existing.thumbnail || incoming.thumbnail,
      pageUrl: existing.pageUrl || incoming.pageUrl,
      pageTitle: existing.pageTitle || incoming.pageTitle,
      updatedAt: newVersion.createdAt,
      versions: [newVersion, ...oldVersions],
    };
    list.splice(existingIdx, 1);
    list.unshift(merged);
    if (list.length > HISTORY_LIMIT) list.length = HISTORY_LIMIT;
    await writeHistory(list);
    return merged;
  }
  // 没找到同图记录：走老路径。同时给首条 version 也补上 meta，方便后续展示一致。
  if (incoming.versions[0] && !incoming.versions[0].meta) {
    incoming.versions[0] = {
      ...incoming.versions[0],
      meta: {
        provider: incoming.provider,
        model: incoming.model,
        style: incoming.style,
      },
    };
  }
  list.unshift(incoming);
  if (list.length > HISTORY_LIMIT) list.length = HISTORY_LIMIT;
  await writeHistory(list);
  return incoming;
}

export async function clearHistory(): Promise<void> {
  historyCache = [];
  await chrome.storage.local.remove(HISTORY_KEY);
  notifyBackupSubscribers();
}

export async function removeHistory(id: string): Promise<void> {
  const list = await getHistory();
  const next = list.filter((i) => i.id !== id);
  await writeHistory(next);
}

/** 批量删除若干条历史项；用于「提示词库」的多选删除。 */
export async function removeHistoryItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const set = new Set(ids);
  const list = await getHistory();
  const next = list.filter((i) => !set.has(i.id));
  await writeHistory(next);
}

/**
 * 局部更新一条 HistoryItem（例如 `pinned`、`note`、`thumbnail` 等只读元数据）。
 * 注意：不允许通过此方法改写 `versions` / `prompt`，那两者应走 appendPromptVersion / restorePromptVersion。
 */
export async function patchHistoryItem(
  id: string,
  patch: Partial<Pick<HistoryItem, 'pinned' | 'note' | 'thumbnail' | 'pageTitle' | 'folderId'>>
): Promise<HistoryItem | null> {
  const list = await getHistory();
  const idx = list.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const updated: HistoryItem = { ...list[idx], ...patch };
  list[idx] = updated;
  await writeHistory(list);
  return updated;
}

export async function getHistoryItem(id: string): Promise<HistoryItem | null> {
  const list = await getHistory();
  return list.find((i) => i.id === id) || null;
}

export function newVersionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
