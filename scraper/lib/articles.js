// Article fetching and batched coordinate lookup.
import {
  coordinatesUrl,
  fetchJson,
  parseArticleUrl,
  wikidataEntityUrl,
} from './wiki.js';

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Returns rendered HTML for an article, or null when the page does not exist.
export async function fetchArticleHtml(title, { offline = false } = {}) {
  const json = await fetchJson(parseArticleUrl(title), { offline });
  return json?.parse?.text ?? null;
}

function primaryCoordinate(page) {
  const coords = page?.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return null;
  return coords.find((c) => c.primary) ?? coords[0];
}

// Fallback for articles without on-wiki coordinates: Wikidata P625 via the
// enwiki sitelink. Returns null when unavailable (including offline cache miss).
async function fetchWikidataCoordinates(title, { offline = false } = {}) {
  try {
    const json = await fetchJson(wikidataEntityUrl(title), { offline });
    const entities = json?.entities ?? {};
    for (const entity of Object.values(entities)) {
      const claim = (entity?.claims?.P625 ?? []).find(
        (candidate) => candidate.mainsnak?.datavalue?.value,
      );
      const value = claim?.mainsnak?.datavalue?.value;
      if (value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)) {
        return { lat: value.latitude, lon: value.longitude };
      }
    }
  } catch (error) {
    if (error.code !== 'CACHE_MISS') throw error;
  }
  return null;
}

// Fetches coordinates for many article titles (batches of 50), returning a
// Map from the requested title to { lat, lon }. Batches are sorted so the cache
// keys stay stable across runs.
export async function fetchCoordinates(articles, { offline = false } = {}) {
  const sorted = [...new Set(articles)].sort();
  const byArticle = new Map();

  for (const batch of chunk(sorted, 50)) {
    const json = await fetchJson(coordinatesUrl(batch), { offline });
    const query = json?.query ?? {};
    const byTitle = new Map();
    for (const page of query.pages ?? []) {
      const coords = primaryCoordinate(page);
      if (coords) byTitle.set(page.title, { lat: coords.lat, lon: coords.lon });
    }
    const normalized = new Map((query.normalized ?? []).map((n) => [n.from, n.to]));
    const redirects = new Map((query.redirects ?? []).map((r) => [r.from, r.to]));

    for (const original of batch) {
      let title = original;
      if (normalized.has(title)) title = normalized.get(title);
      if (redirects.has(title)) title = redirects.get(title);
      const coords = byTitle.get(title);
      if (coords) byArticle.set(original, coords);
    }
  }

  for (const title of sorted) {
    if (byArticle.has(title)) continue;
    const coords = await fetchWikidataCoordinates(title, { offline });
    if (coords) byArticle.set(title, coords);
  }

  return byArticle;
}
