import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/storage/versionState.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: true,
  },
}).outputText;

const mod = await import(
  `data:text/javascript;base64,${Buffer.from(compiled, 'utf8').toString('base64')}`
);

const older = {
  id: 'v1',
  prompt: 'old prompt',
  createdAt: 100,
  source: 'extracted',
};
const newer = {
  id: 'v2',
  prompt: 'new prompt',
  createdAt: 200,
  source: 'refined',
  meta: { provider: 'openai', model: 'gpt-4o', style: 'natural-zh', strategy: 'v029' },
};
const duplicateOlder = {
  ...older,
  prompt: 'duplicate should be ignored',
  createdAt: 300,
};

assert.deepEqual(
  mod.normalizePromptVersions([older, newer, duplicateOlder]).map((v) => v.id),
  ['v2', 'v1'],
  'versions are de-duplicated by id before legacy version numbers are assigned'
);

const normalizedLegacy = mod.normalizePromptVersions([older, newer]);
assert.deepEqual(
  normalizedLegacy.map((v) => v.versionNo),
  [1, 0],
  'legacy versions are assigned stable version numbers'
);

const restoredOlder = { ...older, versionNo: 2 };
assert.deepEqual(
  mod.normalizePromptVersions([newer, restoredOlder]).map((v) => v.id),
  ['v1', 'v2'],
  'versionNo outranks createdAt when choosing the current version'
);
assert.equal(
  mod.getNextPromptVersionNo([newer, restoredOlder]),
  3,
  'next version number is max(versionNo) + 1'
);

const item = {
  id: 'item-1',
  imageUrl: 'https://example.com/a.png',
  thumbnail: 'thumb',
  prompt: 'stale prompt',
  provider: 'gemini',
  model: 'gemini-pro',
  style: 'natural-en',
  pageUrl: 'https://example.com',
  pageTitle: 'Example',
  createdAt: 50,
  updatedAt: 60,
  versions: [older, newer],
};

const mirrored = mod.mirrorCurrentVersion(item);
assert.equal(mirrored.prompt, 'new prompt');
assert.equal(mirrored.updatedAt, 200);
assert.equal(mirrored.provider, 'openai');
assert.equal(mirrored.model, 'gpt-4o');
assert.equal(mirrored.style, 'natural-zh');
assert.equal(mirrored.strategy, 'v029');
assert.equal(mirrored.versions[0].id, 'v2');

const restoredItem = mod.mirrorCurrentVersion({
  ...item,
  updatedAt: 500,
  versions: [
    { ...older, versionNo: 2 },
    { ...newer, versionNo: 1 },
  ],
});
assert.equal(restoredItem.prompt, 'old prompt');
assert.equal(restoredItem.updatedAt, 500);
assert.equal(restoredItem.versions.length, 2);
assert.equal(restoredItem.versions[0].id, 'v1');

console.log('version-state smoke tests passed');
