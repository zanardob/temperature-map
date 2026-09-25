// Shared validation rules for CITY_DATA, used both per-city during the pipeline
// (to decide exclusions) and by scraper/validate.js (whole-dataset check).
import { CITY_MONTH_FIELDS } from './parse.js';

const VALUE_MIN = -60;
const VALUE_MAX = 60;
const ORDER_TOLERANCE = 0.1;
const DERIVED_TOLERANCE = 0.05;
// Guards against binary floating-point error in midpoint comparisons.
const FLOAT_EPSILON = 1e-9;

export function checkCity(city) {
  const violations = [];
  if (!city || typeof city !== 'object') return ['<unnamed>: city is not an object'];
  const label = city.name ?? '<unnamed>';

  if (!city.months || typeof city.months !== 'object') {
    violations.push(`${label}: missing months object`);
    return violations;
  }

  for (const field of CITY_MONTH_FIELDS) {
    const values = city.months[field];
    if (!Array.isArray(values) || values.length !== 12) {
      violations.push(`${label}: ${field} is not an array of 12`);
      continue;
    }
    values.forEach((value, index) => {
      if (value === null) return;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        violations.push(`${label}: ${field}[${index}] is not a number`);
      } else if (value < VALUE_MIN || value > VALUE_MAX) {
        violations.push(`${label}: ${field}[${index}] out of range (${value})`);
      }
    });
  }

  const { meanDailyMax, meanDailyMin, dailyMean, recordHigh, recordLow } = city.months;
  for (let i = 0; i < 12; i += 1) {
    const high = meanDailyMax?.[i];
    const low = meanDailyMin?.[i];
    const mean = dailyMean?.[i];
    if (typeof high === 'number' && typeof low === 'number') {
      if (high < low - ORDER_TOLERANCE - FLOAT_EPSILON) {
        violations.push(`${label}: month ${i + 1} meanDailyMax < meanDailyMin`);
      }
      if (typeof mean === 'number') {
        if (high < mean - ORDER_TOLERANCE - FLOAT_EPSILON) {
          violations.push(`${label}: month ${i + 1} meanDailyMax < dailyMean`);
        }
        if (mean < low - ORDER_TOLERANCE - FLOAT_EPSILON) {
          violations.push(`${label}: month ${i + 1} dailyMean < meanDailyMin`);
        }
      }
    }
    if (city.avgDerived && typeof mean === 'number' && typeof high === 'number' && typeof low === 'number') {
      const midpoint = (high + low) / 2;
      if (Math.abs(mean - midpoint) > DERIVED_TOLERANCE + FLOAT_EPSILON) {
        violations.push(`${label}: month ${i + 1} derived dailyMean off midpoint`);
      }
    }
    if (typeof recordHigh === 'number' && typeof high === 'number' && recordHigh < high) {
      violations.push(`${label}: month ${i + 1} recordHigh < meanDailyMax`);
    }
    if (typeof recordLow === 'number' && typeof low === 'number' && recordLow > low) {
      violations.push(`${label}: month ${i + 1} recordLow > meanDailyMin`);
    }
  }

  return violations;
}

export function checkCityData(data) {
  const violations = [];
  if (!data || typeof data !== 'object') return ['CITY_DATA is not an object'];
  if (!Array.isArray(data.cities)) return ['CITY_DATA.cities is not an array'];
  if (data.cities.length === 0) violations.push('CITY_DATA.cities is empty');

  let previousName = null;
  for (const city of data.cities) {
    violations.push(...checkCity(city));
    if (!city || typeof city !== 'object') continue;
    if (!Number.isFinite(city.lat) || !Number.isFinite(city.lon)) {
      violations.push(`${city.name ?? '<unnamed>'}: missing or invalid coordinates`);
    }
    const name = String(city.name ?? '');
    if (previousName !== null && name.localeCompare(previousName) < 0) {
      violations.push(`CITY_DATA.cities is not sorted at "${name}"`);
    }
    previousName = name;
  }
  return violations;
}

export function loadCityData(source) {
  // eslint-disable-next-line no-new-func
  return new Function(`${source};return CITY_DATA;`)();
}
