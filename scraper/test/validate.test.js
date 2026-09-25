import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeCityData } from '../lib/emit.js';
import { checkCity, checkCityData, loadCityData } from '../lib/validate.js';

function makeCity(overrides = {}) {
  const month = (values) => values;
  return {
    name: 'Testville',
    country: 'Testland',
    lat: 0,
    lon: 0,
    wikipedia: 'https://en.wikipedia.org/wiki/Testville',
    source: 'Climate data for Testville',
    avgDerived: false,
    fromFahrenheit: false,
    months: {
      meanDailyMax: month([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
      dailyMean: month([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
      meanDailyMin: month([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
      meanMax: new Array(12).fill(null),
      meanMin: new Array(12).fill(null),
      recordHigh: new Array(12).fill(null),
      recordLow: new Array(12).fill(null),
    },
    ...overrides,
  };
}

test('a well-formed city passes validation', () => {
  assert.deepEqual(checkCity(makeCity()), []);
});

test('an array of the wrong length is rejected', () => {
  const city = makeCity();
  city.months.recordHigh = [1, 2, 3];
  assert.match(checkCity(city)[0], /recordHigh is not an array of 12/);
});

test('an out-of-range value is rejected', () => {
  const city = makeCity();
  city.months.meanDailyMax[0] = 120;
  assert.match(checkCity(city)[0], /out of range/);
});

test('ordering violations are rejected', () => {
  const city = makeCity();
  city.months.dailyMean[3] = 50; // above the daily max
  assert.ok(checkCity(city).some((v) => /meanDailyMax < dailyMean/.test(v)));
});

test('derived daily mean must match the midpoint', () => {
  const city = makeCity({ avgDerived: true });
  city.months.dailyMean[0] = 9; // midpoint of 10 and 0 is 5
  assert.ok(checkCity(city).some((v) => /derived dailyMean off midpoint/.test(v)));
});

test('serialize -> evaluate -> validate round trip', () => {
  const city = makeCity();
  const source = serializeCityData({
    generatedAt: '2026-01-01T00:00:00.000Z',
    source: 'English Wikipedia climate tables',
    cities: [city],
  });

  assert.match(source, /^const CITY_DATA = \{/);
  const data = loadCityData(source);
  assert.equal(data.cities.length, 1);
  assert.deepEqual(checkCityData(data), []);
});

test('checkCityData reports a non-array cities field', () => {
  assert.deepEqual(checkCityData({ cities: null }), ['CITY_DATA.cities is not an array']);
});

test('checkCity reports a non-object city instead of throwing', () => {
  assert.deepEqual(checkCity(null), ['<unnamed>: city is not an object']);
});

test('checkCityData flags empty, unsorted and coordinate-less datasets', () => {
  assert.ok(checkCityData({ cities: [] }).includes('CITY_DATA.cities is empty'));

  const outOfOrder = [makeCity({ name: 'Bravo' }), makeCity({ name: 'Alpha' })];
  assert.ok(checkCityData({ cities: outOfOrder }).some((v) => /not sorted/.test(v)));

  const noCoordinates = makeCity();
  delete noCoordinates.lat;
  assert.ok(checkCityData({ cities: [noCoordinates] }).some((v) => /coordinates/.test(v)));
});
