// Candidate source: Wikidata settlements/municipalities with a population of at
// least MIN_POPULATION anywhere in the world, intersected with the English
// Wikipedia pages that actually transclude Template:Weather box.
//
// The intersection keeps the fetch budget honest (nearly every candidate yields
// a climate table) and acts as the city filter: most regions, counties and
// metropolitan areas do not carry weather boxes. The non-city entities that do
// survive are listed explicitly below.
//
// Wikidata is queried through QLever's public mirror (the official WDQS times
// out on these joins); responses are cached like every other request.
import { API_ENDPOINT, fetchJson, fetchText } from './wiki.js';

export const QLEVER_ENDPOINT = 'https://qlever.dev/api/wikidata';
export const MIN_POPULATION = 100000;

// Small places worth carrying even though they fall below the population
// threshold: Melilla and Ceuta are the Spanish autonomous cities on the
// Moroccan coast (~85k inhabitants each).
const EXTRA_CITIES = [
  { name: 'Ceuta', article: 'Ceuta', country: 'Spain' },
  { name: 'Melilla', article: 'Melilla', country: 'Spain' },
];

// Non-city entities that survive the type filter and carry a weather box.
// Counties, metropolitan areas and conurbations whose articles transclude a
// weather box for the region rather than for one city; districts and
// neighborhoods that would plot a second dot on top of the city they belong to.
// Real municipalities whose names merely contain "county" or "district"
// (Greater Sudbury, Langley, Yüksekova) are deliberately not listed here.
const EXCLUDED_ENTITIES = new Map([
  ['Q151993', 'Ruhr'],
  ['Q20552718', 'Athens metropolitan area'],
  ['Q3622022', 'Metropolitan City of Cagliari'],
  ['Q4095759', 'Brighton and Hove built-up area'],
  ['Q106997185', 'Metropolitan City of Sassari'],
  ['Q23157', 'Somerset'],
  ['Q205047', 'Kurdistan Region'],
  ['Q6487717', 'Lanzhou New Area'],
  ['Q2828677', 'Tampa Bay area'],
  // Inner-city districts of Istanbul (Beşiktaş, Kadıköy, Sarıyer) and Ankara
  // (Çankaya): separate Wikidata entities that would plot a second dot on top
  // of the metropolis they belong to.
  ['Q459495', 'Beşiktaş'],
  ['Q1020646', 'Çankaya'],
  ['Q932886', 'Kadıköy'],
  ['Q857107', 'Sarıyer'],
  ['Q2911280', 'Borough Park, Brooklyn'],
  ['Q877813', 'Tai Po District'],
  ['Q570509', 'Tamsui District'],
  ['Q1239362', 'Don Mueang district'],
  // US and Canadian counties whose articles carry a weather box.
  ['Q108143', 'San Diego County, California'],
  ['Q110739', 'Santa Clara County, California'],
  ['Q107146', 'Alameda County, California'],
  ['Q54065', 'Suffolk County, New York'],
  ['Q54064', 'Nassau County, New York'],
  ['Q156291', 'Allegheny County, Pennsylvania'],
  ['Q494556', 'Pinellas County, Florida'],
  ['Q54231', 'Fairfield County, Connecticut'],
  ['Q378527', 'Montgomery County, Pennsylvania'],
  ['Q1338527', 'Taoyuan County'],
  ['Q494616', 'Lee County, Florida'],
  ['Q501043', 'Polk County, Florida'],
  ['Q494192', 'Bucks County, Pennsylvania'],
  ['Q502564', 'Ocean County, New Jersey'],
  ['Q27844', 'Delaware County, Pennsylvania'],
  ['Q156156', 'New Castle County, Delaware'],
  ['Q142369', 'Lancaster County, Pennsylvania'],
  ['Q27840', 'Chester County, Pennsylvania'],
  ['Q498163', 'Morris County, New Jersey'],
  ['Q512951', 'Lake County, Indiana'],
  ['Q138141', 'Burlington County, New Jersey'],
  ['Q490914', 'York County, Pennsylvania'],
  ['Q501163', 'Sarasota County, Florida'],
  ['Q953088', 'Essex County, Ontario'],
  ['Q496886', 'Mercer County, New Jersey'],
  ['Q494117', 'Lehigh County, Pennsylvania'],
  ['Q111098', 'Rockland County, New York'],
  ['Q341639', 'Henrico County, Virginia'],
  ['Q501292', 'Luzerne County, Pennsylvania'],
  ['Q488690', 'Dauphin County, Pennsylvania'],
  ['Q494134', 'Cumberland County, Pennsylvania'],
  ['Q107126', 'Arlington County, Virginia'],
  ['Q156213', 'Sussex County, Delaware'],
  ['Q497200', 'Washington County, Pennsylvania'],
  ['Q58698', 'Yuma County, Arizona'],
  ['Q128137', 'Kent County, Delaware'],
  ['Q501323', 'Carroll County, Maryland'],
  ['Q495588', 'Monroe County, Pennsylvania'],
  ['Q495998', 'Sussex County, New Jersey'],
  ['Q488683', 'Fayette County, Pennsylvania'],
  ['Q494152', 'Blair County, Pennsylvania'],
  ['Q500871', 'La Crosse County, Wisconsin'],
  ['Q496558', 'Missoula County, Montana'],
  ['Q54251', 'Windham County, Connecticut'],
  ['Q351865', 'Adams County, Pennsylvania'],
  ['Q385365', 'Cecil County, Maryland'],
  ['Q109681', 'Nevada County, California'],
  // Metropolitan areas and conurbations (San Juan, Metro Manila is a real city
  // and stays).
  ['Q683705', 'New York metropolitan area'],
  ['Q13580', 'Metro Manila'],
  ['Q1925894', 'Philadelphia metropolitan area'],
  ['Q2915506', 'Miami metropolitan area'],
  ['Q3290452', 'Phoenix metropolitan area'],
  ['Q65061424', 'Malang metropolitan area'],
  ['Q326891', 'City of Ekurhuleni Metropolitan Municipality'],
  ['Q5120360', 'Cincinnati metropolitan area'],
  ['Q5600444', 'Greater Austin'],
  ['Q1190137', 'Greater Boston'],
  ['Q426435', 'Greater Houston'],
  ['Q1968039', 'Greater Orlando'],
]);

const PREFIXES = [
  'PREFIX wdt: <http://www.wikidata.org/prop/direct/>',
  'PREFIX wd: <http://www.wikidata.org/entity/>',
  'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>',
  'PREFIX schema: <http://schema.org/>',
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>',
].join('\n');

const QID = /^Q\d+$/;

export function citiesQuery(minPopulation = MIN_POPULATION) {
  return `${PREFIXES}
SELECT ?city ?cityLabel ?country ?pop ?coord ?article WHERE {
  ?city wdt:P17 ?country .
  ?city wdt:P1082 ?pop .
  FILTER(xsd:decimal(?pop) >= ${minPopulation})
  ?city wdt:P625 ?coord .
  { ?city wdt:P31/wdt:P279* wd:Q486972 } UNION { ?city wdt:P31/wdt:P279* wd:Q15284 }
  ?article schema:about ?city ; schema:isPartOf <https://en.wikipedia.org/> .
  ?city rdfs:label ?cityLabel . FILTER(LANG(?cityLabel) = "en")
}`;
}

export function countryLabelsQuery(qids) {
  const values = qids.map((qid) => `wd:${qid}`).join(' ');
  return `${PREFIXES}
SELECT ?country ?countryLabel WHERE {
  VALUES ?country { ${values} }
  ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en")
}`;
}

export function sparqlUrl(query) {
  const params = new URLSearchParams({ query, action: 'tsv_export' });
  return `${QLEVER_ENDPOINT}?${params.toString().replace(/\+/g, '%20')}`;
}

export function weatherBoxPagesUrl(continueToken) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'embeddedin',
    eititle: 'Template:Weather box',
    einamespace: '0',
    eilimit: '500',
    format: 'json',
    formatversion: '2',
  });
  if (continueToken) params.set('eicontinue', continueToken);
  return `${API_ENDPOINT}?${params}`;
}

function unquote(value) {
  const text = String(value ?? '').trim();
  if (text.startsWith('<') && text.endsWith('>')) {
    const uri = text.slice(1, -1);
    const entity = /^https?:\/\/www\.wikidata\.org\/entity\/(.+)$/.exec(uri);
    return entity ? entity[1] : uri;
  }
  return text.replace(/^"/, '').replace(/"@[a-z-]+$/i, '');
}

// Parses QLever's TSV export (header cells look like "?city").
export function parseTsv(text) {
  const lines = String(text).split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0 || !lines[0].startsWith('?')) {
    throw new Error(`unexpected SPARQL response: ${String(text).slice(0, 120)}`);
  }
  const header = lines[0]
    .replace(/^\uFEFF/, '')
    .split('\t')
    .map((cell) => cell.replace(/^\?/, ''));
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row = {};
    header.forEach((key, index) => {
      row[key] = unquote(cells[index]);
    });
    return row;
  });
}

export function parsePoint(value) {
  const match = /POINT\((-?[\d.]+) (-?[\d.]+)\)/i.exec(String(value));
  if (!match) return null;
  return { lon: Number(match[1]), lat: Number(match[2]) };
}

export function articleTitle(articleUri) {
  const raw = String(articleUri).replace('https://en.wikipedia.org/wiki/', '');
  return decodeURIComponent(raw).replace(/_/g, ' ').normalize('NFC');
}

// Rows in the shape mergeCandidates() expects: name, article, country.
export function buildCandidates(cityRows, countryLabels, weatherBoxTitles) {
  const byArticle = new Map();
  for (const row of cityRows) {
    if (!QID.test(row.city)) continue;
    if (EXCLUDED_ENTITIES.has(row.city)) continue;
    const population = Number(row.pop);
    if (!Number.isFinite(population) || population < MIN_POPULATION) continue;
    const point = parsePoint(row.coord);
    if (!point) continue;
    const article = articleTitle(row.article);
    if (!weatherBoxTitles.has(article)) continue;

    const existing = byArticle.get(article);
    if (!existing || population > existing.population) {
      byArticle.set(article, {
        // Wikidata labels Turkish district centres as "Erdemli district"; the
        // bare town name reads better on a badge.
        name: String(row.cityLabel || '').trim().replace(/\s+district$/i, '') || article,
        article,
        country: countryLabels.get(row.country) || row.country,
        population,
      });
    }
  }
  return [...byArticle.values()]
    .map(({ name, article, country }) => ({ name, article, country }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// All pages transcluding Template:Weather box (~31k across the wiki).
export async function fetchWeatherBoxTitles({ offline = false } = {}) {
  const titles = new Set();
  let token = null;
  do {
    const json = await fetchJson(weatherBoxPagesUrl(token), { offline });
    if (!Array.isArray(json?.query?.embeddedin)) {
      throw new Error(`unexpected embeddedin response: ${JSON.stringify(json).slice(0, 200)}`);
    }
    for (const page of json.query.embeddedin) titles.add(String(page.title).normalize('NFC'));
    token = json?.continue?.eicontinue ?? null;
  } while (token);
  return titles;
}

// Nudges in the hand-picked places that sit below the population threshold;
// they still have to carry a weather box to be worth fetching.
export function withExtraCities(candidates, weatherBoxTitles) {
  const result = [...candidates];
  for (const extra of EXTRA_CITIES) {
    if (!weatherBoxTitles.has(extra.article)) continue;
    if (result.some((candidate) => candidate.article === extra.article)) continue;
    result.push({ ...extra });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchWikidataCandidates({ offline = false } = {}) {
  const cityRows = parseTsv(await fetchText(sparqlUrl(citiesQuery()), { offline }));
  const countryQids = [...new Set(cityRows.map((row) => row.country).filter((qid) => QID.test(qid)))].sort();
  const labelRows = countryQids.length
    ? parseTsv(await fetchText(sparqlUrl(countryLabelsQuery(countryQids)), { offline }))
    : [];
  const countryLabels = new Map(labelRows.map((row) => [row.country, row.countryLabel]));
  const weatherBoxTitles = await fetchWeatherBoxTitles({ offline });
  return withExtraCities(buildCandidates(cityRows, countryLabels, weatherBoxTitles), weatherBoxTitles);
}
