import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeCandidates } from '../lib/candidates.js';

test('mergeCandidates deduplicates by article title and merges sources', () => {
  const merged = mergeCandidates([
    {
      rows: [
        { name: 'Moscow', article: 'Moscow', country: 'Russia' },
        { name: 'Paris', article: 'Paris', country: 'France' },
      ],
      source: 'population-list',
    },
    {
      rows: [{ name: 'Lyon', article: 'Lyon', country: 'France' }],
      source: 'eu-list',
    },
    {
      rows: [
        { name: 'Ankara', article: 'Ankara', country: 'Turkey' },
        { name: 'Moscow', article: 'Moscow', country: 'Russia' },
      ],
      source: 'capitals',
    },
  ]);

  assert.equal(merged.length, 4);
  const moscow = merged.find((c) => c.article === 'Moscow');
  assert.deepEqual(moscow.sources, ['population-list', 'capitals']);
  const ankara = merged.find((c) => c.article === 'Ankara');
  assert.deepEqual(ankara.sources, ['capitals']);
  const lyon = merged.find((c) => c.article === 'Lyon');
  assert.deepEqual(lyon.sources, ['eu-list']);
});
