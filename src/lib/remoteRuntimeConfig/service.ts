/**
 * 远端运行时配置：`fetch`、节流、降级缓存、可选 Ed25519 验签。
 */
import {
  REMOTE_RUNTIME_CONFIG_FETCH_TIMEOUT_MS,
  REMOTE_RUNTIME_CONFIG_MAX_BODY_BYTES,
  REMOTE_RUNTIME_CONFIG_PUBLIC_KEY_RAW_B64,
  REMOTE_RUNTIME_CONFIG_REFRESH_COOLDOWN_MS,
  REMOTE_RUNTIME_CONFIG_URL,
} from './constants';
import './policy';
import {
  decodeRawPublicKeyBase64,
  extractSignedEnvelope,
  looksSignedEnvelopeWire,
  parsePlainWireObject,
  parseTrustedInnerPayloadJson,
} from './parse';
import type { RemoteRuntimeConfigPayload, RemoteRuntimeConfigCache } from './types';
import { REMOTE_RUNTIME_CONFIG_CACHE_KEY } from '../storage/keys';

let coolingRefresh: Promise<void> | null = null;

function emptyCache(): RemoteRuntimeConfigCache {
  return {
    lastFetchAttemptAt: 0,
    lastSuccessAt: null,
    payload: null,
  };
}

function coerceStoredCache(raw: unknown): RemoteRuntimeConfigCache {
  if (!raw || typeof raw !== 'object') return emptyCache();
  const r = raw as Partial<RemoteRuntimeConfigCache>;
  const lastFetchAttemptAt =
    typeof r.lastFetchAttemptAt === 'number' && Number.isFinite(r.lastFetchAttemptAt)
      ? r.lastFetchAttemptAt
      : 0;
  const lastSuccessAt =
    typeof r.lastSuccessAt === 'number' && Number.isFinite(r.lastSuccessAt)
      ? r.lastSuccessAt
      : null;
  const payload =
    r.payload &&
    typeof r.payload === 'object' &&
    (r.payload as RemoteRuntimeConfigPayload).schemaVersion === 1
      ? (r.payload as RemoteRuntimeConfigPayload)
      : null;
  return {
    lastFetchAttemptAt,
    lastSuccessAt,
    lastError: typeof r.lastError === 'string' ? r.lastError : undefined,
    payload,
  };
}

export async function readRemoteRuntimeConfigCache(): Promise<RemoteRuntimeConfigCache> {
  try {
    const row = await chrome.storage.local.get(REMOTE_RUNTIME_CONFIG_CACHE_KEY);
    return coerceStoredCache(row[REMOTE_RUNTIME_CONFIG_CACHE_KEY]);
  } catch {
    return emptyCache();
  }
}

async function persistRemoteRuntimeConfigCache(cache: RemoteRuntimeConfigCache): Promise<void> {
  await chrome.storage.local.set({ [REMOTE_RUNTIME_CONFIG_CACHE_KEY]: cache });
}

async function loadOptionalVerifyKey(): Promise<CryptoKey | null> {
  const trimmed = REMOTE_RUNTIME_CONFIG_PUBLIC_KEY_RAW_B64.trim();
  if (!trimmed) return null;
  const raw = decodeRawPublicKeyBase64(trimmed);
  if (!raw) {
    throw new Error('REMOTE_RUNTIME_CONFIG_PUBLIC_KEY_RAW_B64 无法解码为 32 字节公钥');
  }
  const pk = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  try {
    return await crypto.subtle.importKey('raw', pk, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    throw new Error('REMOTE_RUNTIME_CONFIG_PUBLIC_KEY_RAW_B64 无法导入为 Ed25519 验签密钥');
  }
}

async function verifyEnvelopeSignature(
  payloadUtf8Literal: string,
  signatureBytes: Uint8Array,
  publicKey: CryptoKey
): Promise<void> {
  const sigBuf = signatureBytes.buffer.slice(
    signatureBytes.byteOffset,
    signatureBytes.byteOffset + signatureBytes.byteLength
  ) as ArrayBuffer;
  const ok = await crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    sigBuf,
    new TextEncoder().encode(payloadUtf8Literal)
  );
  if (!ok) throw new Error('Ed25519 验签失败');
}

/**
 * @param verifyKeyPromise — resolve 为非 null 时必须走签名信封，并拒绝明文 JSON。
 */
export async function parseRemoteRuntimeWireRoot(
  root: unknown,
  verifyKeyPromise: Promise<CryptoKey | null>
): Promise<RemoteRuntimeConfigPayload> {
  const key = await verifyKeyPromise;

  const signedLooks = looksSignedEnvelopeWire(root);
  if (!signedLooks && key) {
    throw new Error('已配置验签公钥：仅允许带 __signaturePayload 的信封响应');
  }
  if (signedLooks && !key) {
    throw new Error('响应为签名信封，但扩展未配置 REMOTE_RUNTIME_CONFIG_PUBLIC_KEY_RAW_B64');
  }
  if (!signedLooks) {
    return parsePlainWireObject(root);
  }

  const env = extractSignedEnvelope(root);
  await verifyEnvelopeSignature(env.payloadUtf8Literal, env.signatureBytes, key as CryptoKey);

  /**
   * 重要：必须使用「UTF-8 字节与签名完全一致」的那段字符串，
   * 不能直接 JSON.stringify(parse(...))。
   */
  return parseTrustedInnerPayloadJson(env.payloadUtf8Literal);
}

export async function fetchAndParseRemoteRuntimeConfig(): Promise<RemoteRuntimeConfigPayload> {
  const url = REMOTE_RUNTIME_CONFIG_URL.trim();
  if (!url) {
    throw new Error('REMOTE_RUNTIME_CONFIG_URL 未配置');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('REMOTE_RUNTIME_CONFIG_URL 非法');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('REMOTE_RUNTIME_CONFIG_URL 必须使用 https');
  }

  const verifyKeyPromise = loadOptionalVerifyKey();

  /** `AbortSignal.timeout` 仅在较新 Chromium 可用；不可用则只靠 fetch 外层竞争。 */
  let ac: AbortSignal | undefined;
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    ac = AbortSignal.timeout(REMOTE_RUNTIME_CONFIG_FETCH_TIMEOUT_MS);
  }

  let resp: Response;
  try {
    const p = fetch(url, {
      method: 'GET',
      cache: 'no-store',
      ...(ac ? { signal: ac } : {}),
    });

    resp = ac
      ? await p
      : await Promise.race([
          p,
          new Promise<Response>((_, reject) =>
            setTimeout(() => reject(new Error('拉取远端配置超时')), REMOTE_RUNTIME_CONFIG_FETCH_TIMEOUT_MS)
          ),
        ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg || 'fetch 失败');
  }

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }

  const buf = await resp.arrayBuffer();
  if (buf.byteLength > REMOTE_RUNTIME_CONFIG_MAX_BODY_BYTES) {
    throw new Error('响应体积超过上限');
  }
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // 温和裁掉 BOM
  text = text.replace(/^\uFEFF/, '').trimStart();

  let root: unknown;
  try {
    root = JSON.parse(text) as unknown;
  } catch {
    throw new Error('响应 JSON 无效');
  }

  return parseRemoteRuntimeWireRoot(root, verifyKeyPromise);
}

/** 节流 + 失败后保留上次成功载荷；可被 background / 「检查更新」触发。 */
export async function refreshRemoteRuntimeConfigNow(): Promise<RemoteRuntimeConfigCache> {
  const prev = await readRemoteRuntimeConfigCache();
  const now = Date.now();

  const url = REMOTE_RUNTIME_CONFIG_URL.trim();
  if (!url) {
    const next = {
      ...prev,
      lastFetchAttemptAt: now,
      lastError: undefined,
    };
    await persistRemoteRuntimeConfigCache(next);
    return next;
  }

  if (
    prev.lastFetchAttemptAt > 0 &&
    now - prev.lastFetchAttemptAt < REMOTE_RUNTIME_CONFIG_REFRESH_COOLDOWN_MS
  ) {
    return prev;
  }

  try {
    const payload = await fetchAndParseRemoteRuntimeConfig();
    const next: RemoteRuntimeConfigCache = {
      ...prev,
      lastFetchAttemptAt: now,
      lastSuccessAt: now,
      lastError: undefined,
      payload,
    };
    await persistRemoteRuntimeConfigCache(next);
    return next;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const next: RemoteRuntimeConfigCache = {
      ...prev,
      lastFetchAttemptAt: now,
      lastError: msg,
      // payload 保留 prev.payload 作为降级（若有）
    };
    await persistRemoteRuntimeConfigCache(next);
    return next;
  }
}

/** Service worker / 前台页面均可调用：在冷却期内合并为单次刷新。 */
export function maybeRefreshRemoteRuntimeConfig(): Promise<void> {
  if (coolingRefresh) return coolingRefresh;
  coolingRefresh = (async () => {
    await refreshRemoteRuntimeConfigNow();
  })().finally(() => {
    coolingRefresh = null;
  });
  return coolingRefresh;
}
