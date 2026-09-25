import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseClimateFromHtml, parseNumbers } from '../lib/parse.js';

function fixture(name) {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');
}

function assertShape(months) {
  for (const field of ['meanDailyMax', 'dailyMean', 'meanDailyMin', 'meanMax', 'meanMin', 'recordHigh', 'recordLow']) {
    assert.ok(Array.isArray(months[field]), `${field} should be an array`);
    assert.equal(months[field].length, 12, `${field} should have 12 entries`);
    for (const value of months[field]) {
      assert.ok(value === null || typeof value === 'number', `${field} entries are number|null`);
    }
  }
}

test('clean weather box (Lisbon) yields exact monthly normals', () => {
  const { box, climateTableCount } = parseClimateFromHtml(fixture('lisbon.html'), 'Lisbon');

  assert.equal(climateTableCount, 1);
  assert.match(box.source, /Climate data for Lisbon \(Instituto Geofísico D\. Luís\)/);
  assert.equal(box.avgDerived, false);
  assert.equal(box.fromFahrenheit, false);
  assertShape(box.months);

  assert.deepEqual(box.months.meanDailyMax, [15.1, 16.4, 18.9, 20.4, 23.1, 26.1, 28.2, 28.8, 26.6, 22.8, 18.1, 15.4]);
  assert.deepEqual(box.months.dailyMean, [11.8, 12.8, 14.9, 16.3, 18.8, 21.5, 23.2, 23.8, 22.1, 19.1, 15, 12.4]);
  assert.deepEqual(box.months.meanDailyMin, [8.6, 9.1, 11, 12.3, 14.4, 16.8, 18.2, 18.8, 17.6, 15.3, 11.8, 9.4]);
  assert.deepEqual(box.months.recordHigh, [22.6, 25.4, 29.4, 32.4, 35.1, 41.5, 40.6, 44, 42, 35.3, 27.8, 23.2]);
  assert.deepEqual(box.months.recordLow, [-0.8, -1.5, 0.2, 4.4, 6.4, 10.2, 12.1, 13.3, 10.3, 7.7, 3.6, 0.4]);
  assert.deepEqual(box.months.meanMax, [19.1, 20.9, 24.8, 26.9, 30.8, 34.9, 36.8, 37.2, 34.5, 29.3, 22, 19.2]);
  assert.deepEqual(box.months.meanMin, [4.5, 5.4, 6.8, 8.3, 10.9, 13.5, 15.2, 15.6, 14.3, 11.8, 8.1, 5.6]);

  // Spot check the documented example value.
  assert.equal(box.months.meanDailyMax[6], 28.2);
});

test('multi-box city (Paris) selects the city box, not the airport box', () => {
  const { box, climateTableCount } = parseClimateFromHtml(fixture('paris-multibox.html'), 'Paris');

  assert.equal(climateTableCount, 2);
  assert.match(box.source, /Parc Montsouris/);
  assert.doesNotMatch(box.source, /Orly/);
  assert.equal(box.months.meanDailyMax[6], 25.7);
  assert.equal(box.months.dailyMean[6], 20.9);
  assert.equal(box.months.meanDailyMin[6], 16.2);
});

test('climate-chart-style table uses the Average high/low aliases and derives the mean', () => {
  const { box } = parseClimateFromHtml(fixture('climate-chart-style.html'), 'Springfield');

  assert.equal(box.source, 'Climate chart for Springfield (1991–2020 normals)');
  assert.equal(box.avgDerived, true);
  assert.equal(box.fromFahrenheit, false);
  assert.deepEqual(box.months.meanDailyMax, [10, 11, 14, 17, 21, 24, 27, 27, 23, 18, 13, 10]);
  assert.deepEqual(box.months.meanDailyMin, [0, 1, 3, 5, 9, 12, 14, 14, 11, 7, 3, 0]);
  assert.deepEqual(box.months.dailyMean, [5, 6, 8.5, 11, 15, 18, 20.5, 20.5, 17, 12.5, 8, 5]);
  // Missing extremes keep the uniform null shape.
  assert.deepEqual(box.months.recordHigh, new Array(12).fill(null));
  assert.deepEqual(box.months.meanMax, new Array(12).fill(null));
});

test('°F-only box is converted to Celsius', () => {
  const { box } = parseClimateFromHtml(fixture('fahrenheit.html'), 'Fairbanks');

  assert.equal(box.fromFahrenheit, true);
  assert.equal(box.avgDerived, true);
  assert.deepEqual(box.months.meanDailyMax, [10, 11, 14, 17, 21, 24, 27, 27, 23, 18, 14, 10]);
  assert.deepEqual(box.months.meanDailyMin, [0, 1, 3, 5, 9, 12, 14, 14, 11, 7, 3, 0]);
  assert.equal(box.months.meanDailyMax[6], 27);
  assert.equal(box.months.dailyMean[2], 8.5);
});

test('°F-first bilingual rows ("50.0 (10.0)") are read as Celsius, not converted twice', () => {
  const { box } = parseClimateFromHtml(fixture('fahrenheit-bilingual.html'), 'Testford');

  assert.equal(box.fromFahrenheit, false);
  assert.equal(box.avgDerived, false);
  assert.equal(box.months.meanDailyMax[0], 10);
  assert.equal(box.months.meanDailyMax[6], 27);
  assert.equal(box.months.meanDailyMin[0], 0);
  assert.equal(box.months.dailyMean[0], 5);
  assert.equal(box.months.dailyMean[6], 20);
});

test('article without climate data yields no box', () => {
  const result = parseClimateFromHtml(fixture('no-climate.html'), 'Exampleville');

  assert.equal(result.box, null);
  assert.equal(result.climateTableCount, 0);
  assert.equal(result.chartGraphicOnly, false);
});

test('a page whose only climate table is the CSS climate-chart graphic is flagged', () => {
  const html = `<table class="infobox"><tbody>
      <tr><th>Foo</th></tr>
      <tr><th>Climate chart (<a href="#">explanation</a>)</th></tr>
      <tr><td><div style="background:#ace">J</div></td></tr>
    </tbody></table>`;
  const result = parseClimateFromHtml(html, 'Foo');

  assert.equal(result.box, null);
  assert.equal(result.chartGraphicOnly, true);
});

test('parseNumbers handles unicode minus, dashes and comma decimals', () => {
  assert.deepEqual(parseNumbers('15.1 (59.2)'), [15.1, 59.2]);
  assert.deepEqual(parseNumbers('\u22120.8 (30.6)'), [-0.8, 30.6]);
  assert.deepEqual(parseNumbers('\uff0d4\u20105'), [-4, -5]);
  assert.deepEqual(parseNumbers('15,1 (59,2)'), [15.1, 59.2]);
  assert.deepEqual(parseNumbers('−4\u2013\u20145'), [-4, -5]);
  assert.deepEqual(parseNumbers(''), []);
});
