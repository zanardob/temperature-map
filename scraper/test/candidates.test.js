import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeCandidates } from '../lib/candidates.js';

test('mergeCandidates deduplicates by article title and merges sources', () => {
  const merged = mergeCandidates(
    [
      { name: 'Moscow', article: 'Moscow', country: 'Russia' },
      { name: 'Paris', article: 'Paris', country: 'France' },
    ],
    [
      { name: 'Ankara', article: 'Ankara', country: 'Turkey' },
      { name: 'Moscow', article: 'Moscow', country: 'Russia' },
    ],
  );

  assert.equal(merged.length, 3);
  const moscow = merged.find((c) => c.article === 'Moscow');
  assert.deepEqual(moscow.sources, ['population-list', 'capitals']);
  const ankara = merged.find((c) => c.article === 'Ankara');
  assert.deepEqual(ankara.sources, ['capitals']);
});
