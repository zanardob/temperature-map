// Shared pipeline: candidate inventory -> article HTML -> coordinates -> parse ->
// per-city validation. run.js and build.js differ only in whether they may hit
// the network.
import { CAPITALS } from '../capitals.js';
import { fetchArticleHtml, fetchCoordinates } from './articles.js';
import { mergeCandidates } from './candidates.js';
import { parseClimateFromHtml } from './parse.js';
import { checkCity } from './validate.js';
import { fetchWikidataCandidates } from './wikidata.js';

function wikipediaUrl(article) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(article.replace(/ /g, '_'))}`;
}

export async function buildDataset({ offline = false, onProgress = null } = {}) {
  // Bulk source: every settlement >= 100k worldwide that has a weather box, plus
  // the curated capitals (which bypass the population threshold but must still
  // carry a weather box).
  const wikidataRows = await fetchWikidataCandidates({ offline });
  const candidates = mergeCandidates([
    { rows: wikidataRows, source: 'wikidata' },
    { rows: CAPITALS, source: 'capitals' },
  ]);

  const coords = await fetchCoordinates(
    candidates.map((candidate) => candidate.article),
    { offline },
  );

  const included = [];
  const excluded = [];
  let processed = 0;

  for (const candidate of candidates) {
    processed += 1;
    if (onProgress && processed % 250 === 0) onProgress(processed, candidates.length);
    let html;
    try {
      html = await fetchArticleHtml(candidate.article, { offline });
    } catch (error) {
      const reason =
        error.code === 'CACHE_MISS' ? 'not cached (offline run)' : `fetch error: ${error.message}`;
      excluded.push({ ...candidate, reason });
      continue;
    }

    if (html === null) {
      excluded.push({ ...candidate, reason: 'no article' });
      continue;
    }

    const parsed = parseClimateFromHtml(html, candidate.name);
    if (!parsed.box) {
      excluded.push({
        ...candidate,
        reason: parsed.chartGraphicOnly
          ? 'climate-chart graphic only (unsupported)'
          : 'no climate table',
      });
      continue;
    }

    const hasHigh = parsed.box.months.meanDailyMax.some((value) => value !== null);
    const hasLow = parsed.box.months.meanDailyMin.some((value) => value !== null);
    if (!hasHigh || !hasLow) {
      excluded.push({ ...candidate, reason: 'no usable Celsius high/low' });
      continue;
    }

    const coordinate = coords.get(candidate.article);
    if (!coordinate) {
      excluded.push({ ...candidate, reason: 'no coordinates' });
      continue;
    }

    const city = {
      name: candidate.name,
      country: candidate.country,
      lat: coordinate.lat,
      lon: coordinate.lon,
      wikipedia: wikipediaUrl(candidate.article),
      // Section anchor for a "Source: Wikipedia" link (null when the box sits
      // before the first heading, e.g. in the lead).
      climateAnchor: parsed.box.anchor ?? null,
      source: parsed.box.source,
      avgDerived: parsed.box.avgDerived,
      fromFahrenheit: parsed.box.fromFahrenheit,
      months: parsed.box.months,
    };

    const violations = checkCity(city);
    if (violations.length > 0) {
      excluded.push({ ...candidate, reason: `validation failure: ${violations[0]}` });
      continue;
    }

    included.push(city);
  }

  included.sort((a, b) => a.name.localeCompare(b.name));

  return { candidates, included, excluded };
}
