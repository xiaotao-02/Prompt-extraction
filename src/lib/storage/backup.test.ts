import { describe, expect, it } from 'vitest';
import type { AppSettings, HistoryItem } from '../types';
import { parseBackupPayload } from './backup';
import { migrateItem } from './history';

const minimalSettings = { x: 1 } as unknown as AppSettings;

describe('parseBackupPayload', () => {
  it('coerces numeric version strings', () => {
    const p = parseBackupPayload({
      version: '2',
      exportedAt: '2020-01-01T00:00:00.000Z',
      settings: minimalSettings,
      history: [],
      folders: [],
    });
    expect(p.version).toBe(2);
  });

  it('infers v3 when version invalid but strategyPresets exists', () => {
    const p = parseBackupPayload({
      version: 'nope',
      settings: minimalSettings,
      history: [],
      strategyPresets: [],
    });
    expect(p.version).toBe(3);
  });

  it('infers v2 when version invalid but folders exists', () => {
    const p = parseBackupPayload({
      settings: minimalSettings,
      history: [],
      folders: [{ id: 'a', name: 'A', parentId: null, createdAt: 0 }],
    });
    expect(p.version).toBe(2);
  });

  it('defaults to v1 when version invalid and no v2/v3 markers', () => {
    const p = parseBackupPayload({
      settings: minimalSettings,
      history: [],
    });
    expect(p.version).toBe(1);
  });

  it('throws when settings missing', () => {
    expect(() => parseBackupPayload({ history: [] })).toThrow(/settings/);
  });

  it('throws when history is not an array', () => {
    expect(() =>
      parseBackupPayload({
        settings: minimalSettings,
        history: {},
      })
    ).toThrow(/history/);
  });
});

describe('migrateItem meta backfill', () => {
  it('fills meta on extracted versions from item top-level fields', () => {
    const raw: HistoryItem = {
      id: 'item-1',
      imageUrl: '',
      thumbnail: '',
      prompt: 'top',
      provider: 'openai',
      model: 'gpt-4o',
      style: 'natural-zh',
      pageUrl: '',
      pageTitle: '',
      createdAt: 100,
      versions: [
        {
          id: 'v1',
          prompt: 'a',
          createdAt: 100,
          source: 'extracted',
        },
      ],
    };
    const m = migrateItem(raw);
    expect(m.versions[0]?.meta?.provider).toBe('openai');
    expect(m.versions[0]?.meta?.model).toBe('gpt-4o');
    expect(m.versions[0]?.meta?.style).toBe('natural-zh');
  });
});
