import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parsePopulationList } from '../lib/lists.js';

function fixture(name) {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');
}

test('parsePopulationList extracts city, article title and country', () => {
  const rows = parsePopulationList(fixture('population-list.html'));

  assert.deepEqual(rows, [
    { name: 'Istanbul', article: 'Istanbul', country: 'Turkey' },
    { name: 'Lisbon', article: 'Lisbon', country: 'Portugal' },
    { name: 'Perm', article: 'Perm, Russia', country: 'Russia' },
  ]);
});

test('parsePopulationList returns [] when no ranking table is present', () => {
  assert.deepEqual(parsePopulationList('<p>nothing here</p>'), []);
});
