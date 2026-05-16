import {
  REMOTE_RUNTIME_CONFIG_MAX_ANNOUNCE_LEN,
  REMOTE_RUNTIME_CONFIG_MAX_URL_LEN,
} from './constants';
import type { RemoteRuntimeConfigPayload } from './types';
import { parseVersion } from '../version';

export function isNonEmptyRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function looksSignedEnvelopeWire(root: unknown): boolean {
  if (!isNonEmptyRecord(root)) return false;
  return (
    '__signature' in root || '__signaturePayload' in root || '__signatureAlgorithm' in root
  );
}

function sanitizeAnnounce(raw: unknown, fieldName: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new Error(`字段 ${fieldName} 必须是字符串`);
  }
  const s = raw.trim();
  if (!s) return undefined;
  if (s.length > REMOTE_RUNTIME_CONFIG_MAX_ANNOUNCE_LEN) {
    throw new Error(`字段 ${fieldName} 超过最大长度`);
  }
  return s;
}

function sanitizeHttpsDocUrl(raw: unknown, fieldName: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new Error(`字段 ${fieldName} 必须是字符串 URL`);
  }
  const s = raw.trim();
  if (!s) return undefined;
  if (s.length > REMOTE_RUNTIME_CONFIG_MAX_URL_LEN) throw new Error(`${fieldName} URL 过长`);
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    throw new Error(`${fieldName} URL 格式无效`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${fieldName} 仅允许 https://`);
  }
  return s;
}

function sanitizeMinRecommendedVersion(raw: unknown, fieldName: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new Error(`${fieldName} 必须是 semver 字符串`);
  }
  const s = raw.trim().replace(/^v/i, '');
  if (!s) return undefined;
  if (!parseVersion(s)) {
    throw new Error(`${fieldName} semver 不符合 x.y.z 规范`);
  }
  return formatVersionNormalized(s);
}

function formatVersionNormalized(s: string): string {
  const p = parseVersion(s);
  if (!p) return s;
  return `${p.major}.${p.minor}.${p.patch}${p.pre ? '-' + p.pre : ''}`;
}

const ALLOW_TOP_LEVEL_KEYS_UNSIGNED = new Set([
  'schemaVersion',
  'announcementZh',
  'announcementEn',
  'docsUrl',
  'minRecommendedExtensionVersion',
]);

const ALLOW_TOP_LEVEL_KEYS_SIGNED_WRAP = new Set([
  '__signatureAlgorithm',
  '__signature',
  '__signaturePayload',
]);

function assertNoExtras(obj: Record<string, unknown>, allow: Set<string>): void {
  for (const k of Object.keys(obj)) {
    if (!allow.has(k)) throw new Error(`未知的 JSON 键：${k}`);
  }
}

/** 解析未签名的 wire JSON 对象（已剥掉信封或由调用方传入内层）。 */
export function parsePlainWireObject(root: unknown): RemoteRuntimeConfigPayload {
  if (!isNonEmptyRecord(root)) {
    throw new Error('JSON 顶层必须是对象');
  }

  const hasSig =
    '__signature' in root || '__signaturePayload' in root || '__signatureAlgorithm' in root;

  if (hasSig) {
    throw new Error('检测到签名字段，请走 unwrapVerifiedSignedEnvelope');
  }

  assertNoExtras(root, ALLOW_TOP_LEVEL_KEYS_UNSIGNED);

  const schemaRaw = root.schemaVersion;
  if (schemaRaw !== 1) {
    throw new Error(`不支持的 schemaVersion：${String(schemaRaw)}`);
  }

  const out: RemoteRuntimeConfigPayload = {
    schemaVersion: 1,
    announcementZh: sanitizeAnnounce(root.announcementZh, 'announcementZh'),
    announcementEn: sanitizeAnnounce(root.announcementEn, 'announcementEn'),
    docsUrl: sanitizeHttpsDocUrl(root.docsUrl, 'docsUrl'),
    minRecommendedExtensionVersion: sanitizeMinRecommendedVersion(
      root.minRecommendedExtensionVersion,
      'minRecommendedExtensionVersion'
    ),
  };
  return out;
}

/** 仅解析信封载荷字符串（已通过验签）；禁止包含多余键。 */
export function parseTrustedInnerPayloadJson(text: string): RemoteRuntimeConfigPayload {
  let obj: unknown;
  try {
    obj = JSON.parse(text) as unknown;
  } catch {
    throw new Error('signaturePayload JSON 无效');
  }
  return parsePlainWireObject(obj);
}

export type SignedEnvelopeParts = {
  algorithm: string;
  signatureBytes: Uint8Array;
  /** UTF-8 编码前的原始字符串必须与签名一致 */
  payloadUtf8Literal: string;
};

export function extractSignedEnvelope(root: unknown): SignedEnvelopeParts {
  if (!isNonEmptyRecord(root)) throw new Error('JSON 顶层必须是对象');
  assertNoExtras(root, ALLOW_TOP_LEVEL_KEYS_SIGNED_WRAP);

  const algorithm = root.__signatureAlgorithm;
  const signature = root.__signature;
  const payload = root.__signaturePayload;

  if (typeof algorithm !== 'string' || algorithm !== 'Ed25519') {
    throw new Error('__signatureAlgorithm 必须为 Ed25519');
  }
  if (typeof signature !== 'string' || !signature.trim()) {
    throw new Error('缺少 __signature');
  }
  if (typeof payload !== 'string') {
    throw new Error('__signaturePayload 必须是字符串');
  }

  const sigBytes = bytesFromFlexibleBase64(signature.trim());
  if (!sigBytes) throw new Error('__signature Base64 无效');
  if (sigBytes.length !== 64) throw new Error('Ed25519 签名长度必须为 64 字节');

  return {
    algorithm,
    signatureBytes: sigBytes,
    payloadUtf8Literal: payload,
  };
}

/** atob / base64 decode；接受 URL-safe 变体 */
export function bytesFromFlexibleBase64(s: string): Uint8Array | null {
  const trimmed = s.trim().replace(/\s+/g, '');
  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  try {
    let bin: string;
    if (typeof atob === 'function') {
      bin = atob(padded);
    } else if (typeof Buffer !== 'undefined') {
      bin = Buffer.from(padded, 'base64').toString('binary');
    } else {
      return null;
    }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  } catch {
    return null;
  }
}

export function decodeRawPublicKeyBase64(b64: string): Uint8Array | null {
  const b = bytesFromFlexibleBase64(b64);
  if (!b || b.length !== 32) return null;
  return b;
}
