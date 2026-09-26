// Shared pipeline: candidate lists -> article HTML -> coordinates -> parse ->
// per-city validation. run.js and build.js differ only in whether they may hit
// the network.
import { CAPITALS } from '../capitals.js';
import { fetchArticleHtml, fetchCoordinates } from './articles.js';
import { mergeCandidates } from './candidates.js';
import { parseEuList, parsePopulationList } from './lists.js';
import { parseClimateFromHtml } from './parse.js';
import { checkCity } from './validate.js';
import { fetchWikidataCandidates } from './wikidata.js';

export const POPULATION_LIST_PAGE =
  'List of European cities by population within city limits';
export const EU_LIST_PAGE =
  'List of cities in the European Union by population within city limits';

function wikipediaUrl(article) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(article.replace(/ /g, '_'))}`;
}

export async function buildDataset({ offline = false } = {}) {
  const listHtml = await fetchArticleHtml(POPULATION_LIST_PAGE, { offline });
  const populationRows = listHtml ? parsePopulationList(listHtml) : [];
  const euHtml = await fetchArticleHtml(EU_LIST_PAGE, { offline });
  const euRows = euHtml ? parseEuList(euHtml) : [];
  // Bulk source: every European settlement >= 100k that has a weather box.
  const wikidataRows = await fetchWikidataCandidates({ offline });
  const candidates = mergeCandidates([
    { rows: populationRows, source: 'population-list' },
    { rows: euRows, source: 'eu-list' },
    { rows: wikidataRows, source: 'wikidata' },
    { rows: CAPITALS, source: 'capitals' },
  ]);

  const coords = await fetchCoordinates(
    candidates.map((candidate) => candidate.article),
    { offline },
  );

  const included = [];
  const excluded = [];

  for (const candidate of candidates) {
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
