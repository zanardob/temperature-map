import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleTitle, buildCandidates, parsePoint, parseTsv, withExtraCities } from '../lib/wikidata.js';

const HEADER = '?city\t?cityLabel\t?country\t?pop\t?coord\t?article';

function row({ qid, name, country = 'Q45', pop = '500000', coord = 'POINT(-9.14 38.72)', article }) {
  return `<http://www.wikidata.org/entity/${qid}>\t"${name}"@en\t<http://www.wikidata.org/entity/${country}>\t${pop}\t${coord}\t<https://en.wikipedia.org/wiki/${article}>`;
}

test('parseTsv unquotes URIs and language-tagged labels', () => {
  const rows = parseTsv([HEADER, row({ qid: 'Q90', name: 'Paris', country: 'Q142', article: 'Paris' })].join('\n'));

  assert.deepEqual(rows, [{
    city: 'Q90',
    cityLabel: 'Paris',
    country: 'Q142',
    pop: '500000',
    coord: 'POINT(-9.14 38.72)',
    article: 'https://en.wikipedia.org/wiki/Paris',
  }]);
});

test('parseTsv rejects a non-TSV response', () => {
  assert.throws(() => parseTsv('{"exception":"boom"}'), /unexpected SPARQL response/);
});

test('parsePoint and articleTitle handle the exported formats', () => {
  assert.deepEqual(parsePoint('POINT(2.352222 48.856613)'), { lon: 2.352222, lat: 48.856613 });
  assert.equal(parsePoint('not a point'), null);
  assert.equal(articleTitle('https://en.wikipedia.org/wiki/S%C3%A3o_Paulo'), 'São Paulo');
  assert.equal(articleTitle('https://en.wikipedia.org/wiki/Vila_Nova_de_Gaia'), 'Vila Nova de Gaia');
});

test('buildCandidates keeps only qualifying, weather-boxed cities worldwide', () => {
  const rows = parseTsv([
    HEADER,
    row({ qid: 'Q597', name: 'Lisbon', article: 'Lisbon' }),
    row({ qid: 'Q2', name: 'Smallville', pop: '40000', article: 'Smallville' }),
    row({ qid: 'Q3', name: 'Tbilisi', country: 'Q230', coord: 'POINT(44.8 41.7)', article: 'Tbilisi' }),
    row({ qid: 'Q4', name: 'Novosibirsk', country: 'Q159', coord: 'POINT(82.9 55)', article: 'Novosibirsk' }),
    row({ qid: 'Q5', name: 'Wuppertal', country: 'Q183', coord: 'POINT(7.2 51.3)', article: 'Wuppertal' }),
    row({ qid: 'Q151993', name: 'Ruhr', country: 'Q183', pop: '5152152', coord: 'POINT(7 51)', article: 'Ruhr' }),
    row({ qid: 'Q6', name: 'Rabat', country: 'Q1028', coord: 'POINT(-6.84 34.02)', article: 'Rabat' }),
    row({ qid: 'Q7', name: 'Dakhla', country: 'Q1028', coord: 'POINT(-15.93 23.71)', article: 'Dakhla' }),
    row({ qid: 'Q459495', name: 'Beşiktaş', country: 'Q43', pop: '175190', coord: 'POINT(29.02 41.07)', article: 'Beşiktaş' }),
    row({ qid: 'Q1', name: 'Erdemli district', country: 'Q43', coord: 'POINT(34.3 36.6)', article: 'Erdemli' }),
  ].join('\n'));
  const weatherBoxTitles = new Set([
    'Lisbon', 'Smallville', 'Tbilisi', 'Novosibirsk', 'Ruhr', 'Rabat', 'Dakhla', 'Beşiktaş', 'Erdemli',
  ]);
  const countryLabels = new Map([['Q45', 'Portugal'], ['Q1028', 'Morocco'], ['Q43', 'Turkey']]);

  const candidates = buildCandidates(rows, countryLabels, weatherBoxTitles);

  // Wuppertal has no weather box, Ruhr/Beşiktaş are denylisted, Smallville is
  // under the population threshold; Tbilisi and Dakhla are now in scope.
  assert.deepEqual(candidates, [
    { name: 'Dakhla', article: 'Dakhla', country: 'Morocco' },
    { name: 'Erdemli', article: 'Erdemli', country: 'Turkey' }, // "… district" stripped
    { name: 'Lisbon', article: 'Lisbon', country: 'Portugal' },
    { name: 'Novosibirsk', article: 'Novosibirsk', country: 'Q159' },
    { name: 'Rabat', article: 'Rabat', country: 'Morocco' },
    { name: 'Tbilisi', article: 'Tbilisi', country: 'Q230' },
  ]);
});

test('buildCandidates drops denylisted regions but keeps real municipalities with regional names', () => {
  const rows = parseTsv([
    HEADER,
    row({ qid: 'Q1190137', name: 'Greater Boston', coord: 'POINT(-71 42.3)', article: 'Greater Boston' }),
    row({ qid: 'Q108143', name: 'San Diego County, California', coord: 'POINT(-116.7 32.7)', article: 'San Diego County, California' }),
    row({ qid: 'Q383434', name: 'Greater Sudbury', coord: 'POINT(-80.99 46.49)', article: 'Greater Sudbury' }),
    row({ qid: 'Q1805330', name: 'Langley, British Columbia (district municipality)', coord: 'POINT(-122.6 49.1)', article: 'Langley, British Columbia (district municipality)' }),
  ].join('\n'));
  const weatherBoxTitles = new Set([
    'Greater Boston', 'San Diego County, California', 'Greater Sudbury', 'Langley, British Columbia (district municipality)',
  ]);

  const candidates = buildCandidates(rows, new Map(), weatherBoxTitles);

  assert.deepEqual(candidates, [
    { name: 'Greater Sudbury', article: 'Greater Sudbury', country: 'Q45' },
    { name: 'Langley, British Columbia (district municipality)', article: 'Langley, British Columbia (district municipality)', country: 'Q45' },
  ]);
});

test('buildCandidates deduplicates by article and keeps the largest population', () => {
  const rows = parseTsv([
    HEADER,
    row({ qid: 'Q1', name: 'Lisbon', pop: '545000', article: 'Lisbon' }),
    row({ qid: 'Q2', name: 'Lisbon', pop: '600000', article: 'Lisbon' }),
  ].join('\n'));

  const candidates = buildCandidates(rows, new Map([['Q45', 'Portugal']]), new Set(['Lisbon']));

  assert.deepEqual(candidates, [{ name: 'Lisbon', article: 'Lisbon', country: 'Portugal' }]);
});

test('buildCandidates falls back to the country QID when no label is cached', () => {
  const rows = parseTsv([HEADER, row({ qid: 'Q1', name: 'Lisbon', article: 'Lisbon' })].join('\n'));

  const candidates = buildCandidates(rows, new Map(), new Set(['Lisbon']));

  assert.deepEqual(candidates, [{ name: 'Lisbon', article: 'Lisbon', country: 'Q45' }]);
});

test('withExtraCities adds the hand-picked places that have a weather box', () => {
  const base = [{ name: 'Lisbon', article: 'Lisbon', country: 'Portugal' }];

  const withBoxes = withExtraCities(base, new Set(['Lisbon', 'Ceuta', 'Melilla']));
  assert.deepEqual(withBoxes.map((c) => c.name), ['Ceuta', 'Lisbon', 'Melilla']);
  assert.deepEqual(withBoxes.find((c) => c.name === 'Ceuta'), { name: 'Ceuta', article: 'Ceuta', country: 'Spain' });

  // No weather box -> not added; already present -> not duplicated.
  assert.deepEqual(withExtraCities(base, new Set(['Lisbon'])), base);
  assert.deepEqual(withExtraCities([...base, { name: 'Ceuta', article: 'Ceuta', country: 'Spain' }], new Set(['Ceuta'])).length, 2);
});
