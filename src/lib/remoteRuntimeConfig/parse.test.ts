import { describe, expect, it } from 'vitest';
import { parsePlainWireObject, parseTrustedInnerPayloadJson } from './parse';

describe('remoteRuntimeConfig parsePlainWireObject', () => {
  it('accepts minimal v1 payload', () => {
    const p = parsePlainWireObject({ schemaVersion: 1 });
    expect(p).toEqual({ schemaVersion: 1 });
  });

  it('strips undefined optional fields from result shape', () => {
    const p = parsePlainWireObject({
      schemaVersion: 1,
      announcementZh: 'hello',
      docsUrl: 'https://example.com/readme',
      minRecommendedExtensionVersion: '1.2.3',
    });
    expect(p.announcementZh).toBe('hello');
    expect(p.docsUrl).toBe('https://example.com/readme');
    expect(p.minRecommendedExtensionVersion).toBe('1.2.3');
  });

  it('rejects unknown keys', () => {
    expect(() =>
      parsePlainWireObject({ schemaVersion: 1, evil: true } as Record<string, unknown>)
    ).toThrow(/未知/);
  });

  it('rejects non-https docsUrl', () => {
    expect(() =>
      parsePlainWireObject({
        schemaVersion: 1,
        docsUrl: 'http://example.com/',
      })
    ).toThrow(/https/);
  });

  it('rejects signature envelope at plain path', () => {
    expect(() =>
      parsePlainWireObject({
        __signatureAlgorithm: 'Ed25519',
        __signature: 'aa',
        __signaturePayload: '{"schemaVersion":1}',
      })
    ).toThrow(/签名字段/);
  });
});

describe('remoteRuntimeConfig parseTrustedInnerPayloadJson', () => {
  it('parses inner JSON string', () => {
    const p = parseTrustedInnerPayloadJson('{"schemaVersion":1,"announcementZh":"x"}');
    expect(p.schemaVersion).toBe(1);
    expect(p.announcementZh).toBe('x');
  });
});
