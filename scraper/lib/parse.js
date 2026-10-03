// Parser for English Wikipedia climate tables.
//
// Only row-labelled `table.wikitable` climate boxes are supported ({{Weather box}}
// output and the "Average high"/"Average low" labelled variants). The CSS
// {{Climate chart}} graphic is NOT a wikitable and carries no row labels, so it
// cannot be parsed here; callers report such pages as excluded.
import { load } from 'cheerio';

export const MONTHS = 12;

// Order matters: "Mean daily maximum" must be claimed before "Daily mean",
// and "Daily mean" before "Mean maximum"/"Mean minimum".
const LABEL_MATCHERS = [
  ['meanDailyMax', /^(mean daily maximum|average high)\b/],
  ['meanDailyMin', /^(mean daily minimum|average low)\b/],
  ['dailyMean', /^daily mean\b/],
  ['meanMax', /^mean maximum\b/],
  ['meanMin', /^mean minimum\b/],
  ['recordHigh', /^record high\b/],
  ['recordLow', /^record low\b/],
];

const MONTH_FIELDS = [
  'meanDailyMax',
  'dailyMean',
  'meanDailyMin',
  'meanMax',
  'meanMin',
  'recordHigh',
  'recordLow',
];

export function round1(value) {
  return Math.round(value * 10) / 10;
}

function stripDiacritics(text) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalizeName(text) {
  return stripDiacritics(String(text)).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeLabel(text) {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function matchLabel(label) {
  for (const [field, pattern] of LABEL_MATCHERS) {
    if (pattern.test(label)) return field;
  }
  return null;
}

// Temperature units named in a row header, in the order they appear. A cell's
// first number belongs to the first unit, its second number to the second one.
function unitsInOrder(label) {
  const c = label.indexOf('°c');
  const f = label.indexOf('°f');
  if (c !== -1 && f !== -1) return f < c ? ['F', 'C'] : ['C', 'F'];
  if (c !== -1) return ['C'];
  if (f !== -1) return ['F'];
  return ['C'];
}

// Extracts numeric tokens, normalising unicode minus signs, dashes and comma
// decimal separators.
export function parseNumbers(text) {
  const normalized = String(text)
    .replace(/[\u2212\u2010\u2011\u2012\u2013\u2014\u2015\uff0d]/g, '-')
    .replace(/\u00a0/g, ' ');
  const numbers = [];
  const pattern = /-?\d+(?:[.,]\d+)?/g;
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    let raw = match[0];
    if (raw.includes(',') && raw.includes('.')) {
      const lastSeparator = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
      raw = `${raw.slice(0, lastSeparator).replace(/[.,]/g, '')}.${raw.slice(lastSeparator + 1)}`;
    } else if (raw.includes(',')) {
      raw = raw.replace(',', '.');
    }
    const value = Number(raw);
    if (Number.isFinite(value)) numbers.push(value);
  }
  return numbers;
}

// Returns the Celsius value in a cell. When the cell carries no Celsius number
// (Fahrenheit-only label or row), returns { fahrenheit }; toArray() converts
// those values exactly once.
function cellValue(cellText, order) {
  const numbers = parseNumbers(cellText);
  if (numbers.length === 0) return null;
  for (let i = 0; i < numbers.length && i < order.length; i += 1) {
    if (order[i] === 'C') return round1(numbers[i]);
  }
  return { fahrenheit: round1(numbers[0]) };
}

function cleanTitleText($, node) {
  const clone = $(node).clone();
  // Weather-box titles can embed TemplateStyles <style> blocks, a vte navbar
  // ("vte" links) and footnote <sup> references; strip them from the provenance.
  clone.find('style, script, sup').remove();
  clone.find('.navbar, .navbox, .mw-editsection').remove();
  return clone.text().replace(/\s+/g, ' ').trim();
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, div.mw-heading';

// Id of a heading, wherever the renderer put it: <h2 id> directly, a modern
// <div class="mw-heading"> wrapping the <h2 id>, or a legacy
// <h2><span class="mw-headline" id>.
function headingId($, heading) {
  const $heading = $(heading);
  if ($heading.is('h1, h2, h3, h4, h5, h6')) {
    return $heading.attr('id') ?? $heading.find('[id]').first().attr('id') ?? null;
  }
  return $heading.find('h1, h2, h3, h4, h5, h6').first().attr('id')
    ?? $heading.find('[id]').first().attr('id')
    ?? null;
}

// Anchor of the section a table sits in: the nearest heading before it in
// document order. The table's own siblings are checked first, then each ancestor
// level, because weather boxes are sometimes wrapped in a collapsible div.
// Returns null for tables that have no preceding heading (e.g. in the lead).
function sectionAnchorOf($, table) {
  const levels = [$(table), ...$(table).parents().toArray().map((parent) => $(parent))];
  for (const level of levels) {
    const heading = level.prevAll(HEADING_SELECTOR).first();
    if (heading.length) return headingId($, heading.get(0));
  }
  return null;
}

function provenanceOf($, table) {
  const caption = $(table).children('caption').first();
  if (caption.length) {
    const text = cleanTitleText($, caption.get(0));
    if (text) return text;
  }
  const firstRow = $(table).find('tr').first();
  const cells = firstRow.children('th,td');
  if (cells.length === 1) return cleanTitleText($, cells.get(0));
  return '';
}

function extractRows($, table) {
  const fields = {};
  let fahrenheitUsed = false;
  $(table)
    .find('tr')
    .each((_, row) => {
      const cells = $(row).children('th,td');
      // Need a label plus twelve month cells.
      if (cells.length < MONTHS + 1) return;
      const label = normalizeLabel($(cells[0]).text());
      const field = matchLabel(label);
      if (!field || fields[field]) return;
      const order = unitsInOrder(label);
      const monthTexts = cells
        .slice(1, MONTHS + 1)
        .toArray()
        .map((cell) => $(cell).text());
      fields[field] = monthTexts.map((text) => {
        const value = cellValue(text, order);
        if (value && typeof value === 'object') fahrenheitUsed = true;
        return value;
      });
    });
  return { fields, fahrenheitUsed };
}

function scoreBox(box, cityName) {
  const caption = box.source.toLowerCase();
  let score = 0;
  if (normalizeName(box.source).includes(normalizeName(cityName))) score += 3;
  if (/airport|airfield/.test(caption) || /\([A-Z]{3,4}\)/.test(box.source)) score -= 3;
  if (/1991\s*[–-]\s*2020/.test(caption)) score += 2;
  else if (/1981\s*[–-]\s*2010/.test(caption)) score += 1;
  // The high/low rows are what the map plots, so they outweigh the optional
  // daily mean when several boxes compete: some articles pair a long-normals
  // box that only carries a daily mean with a second box that has the daily
  // extremes (e.g. Drammen), and the extremes are the ones we need.
  if (box.fields.meanDailyMax) score += 2;
  if (box.fields.meanDailyMin) score += 2;
  if (box.fields.dailyMean) score += 1;
  return score;
}

function toArray(values) {
  if (!values) return new Array(MONTHS).fill(null);
  return values.map((value) => {
    if (value === null) return null;
    if (typeof value === 'object') return round1(((value.fahrenheit - 32) * 5) / 9);
    return value;
  });
}

function buildBox(box) {
  const meanDailyMax = toArray(box.fields.meanDailyMax);
  const meanDailyMin = toArray(box.fields.meanDailyMin);

  let avgDerived = false;
  let dailyMean;
  if (box.fields.dailyMean) {
    dailyMean = toArray(box.fields.dailyMean);
  } else {
    avgDerived = true;
    dailyMean = meanDailyMax.map((high, index) => {
      const low = meanDailyMin[index];
      if (high === null || low === null) return null;
      return round1((high + low) / 2);
    });
  }

  return {
    source: box.source,
    anchor: box.anchor,
    avgDerived,
    fromFahrenheit: box.fahrenheitUsed,
    months: {
      meanDailyMax,
      dailyMean,
      meanDailyMin,
      meanMax: toArray(box.fields.meanMax),
      meanMin: toArray(box.fields.meanMin),
      recordHigh: toArray(box.fields.recordHigh),
      recordLow: toArray(box.fields.recordLow),
    },
  };
}

function hasClimateChartGraphic($) {
  let found = false;
  $('table.infobox th').each((_, header) => {
    if (/Climate chart/.test($(header).text())) found = true;
  });
  return found;
}

// Parses a rendered article HTML payload. Returns { box, climateTableCount,
// chartGraphicOnly } where box is the selected climate box or null.
export function parseClimateFromHtml(html, cityName) {
  const $ = load(html);
  const boxes = [];
  $('table.wikitable').each((_, table) => {
    const { fields, fahrenheitUsed } = extractRows($, table);
    if (Object.keys(fields).length === 0) return;
    boxes.push({
      source: provenanceOf($, table),
      anchor: sectionAnchorOf($, table),
      fields,
      fahrenheitUsed,
    });
  });

  if (boxes.length === 0) {
    return { box: null, climateTableCount: 0, chartGraphicOnly: hasClimateChartGraphic($) };
  }

  let best = boxes[0];
  let bestScore = scoreBox(best, cityName);
  for (const box of boxes.slice(1)) {
    const score = scoreBox(box, cityName);
    if (score > bestScore) {
      best = box;
      bestScore = score;
    }
  }

  return { box: buildBox(best), climateTableCount: boxes.length, chartGraphicOnly: false };
}

export const CITY_MONTH_FIELDS = MONTH_FIELDS;
