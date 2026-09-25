// MediaWiki API client with on-disk caching and polite, sequential request pacing.
// Every uncached request waits at least MIN_REQUEST_INTERVAL_MS after the previous
// one so re-runs from cache never touch the network.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, 'data', 'cache');

export const API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
export const USER_AGENT =
  'EuropeTemperatureMap/0.1 (https://github.com/example/temperature-map; temperature-map@example.org)';

const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_RETRIES = 4;

let lastRequestAt = 0;
export const netStats = { requests: 0, cacheHits: 0, retries: 0 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseArticleUrl(title) {
  return `${API_ENDPOINT}?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2&redirects=1`;
}

export function coordinatesUrl(titles) {
  const joined = titles.map((t) => encodeURIComponent(t)).join('%7C');
  return `${API_ENDPOINT}?action=query&prop=coordinates&titles=${joined}&colimit=max&format=json&formatversion=2&redirects=1`;
}

// Wikidata P625 lookup via the enwiki sitelink; used when the Wikipedia
// GeoData extension has no coordinates for an article.
export function wikidataEntityUrl(title) {
  return `https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&titles=${encodeURIComponent(title)}&props=claims&format=json&formatversion=2`;
}

export function cachePathFor(url) {
  const hash = createHash('sha1').update(url).digest('hex');
  return path.join(CACHE_DIR, `${hash}.json`);
}

async function readCached(url) {
  try {
    return JSON.parse(await readFile(cachePathFor(url), 'utf8'));
  } catch {
    return undefined;
  }
}

async function writeCached(url, data) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePathFor(url), JSON.stringify(data));
}

export class CacheMissError extends Error {
  constructor(url) {
    super(`cache miss (offline): ${url}`);
    this.name = 'CacheMissError';
    this.code = 'CACHE_MISS';
  }
}

// Returns parsed JSON for `url`, reading from cache when present.
// Throws CacheMissError when offline and not cached; retries transient failures.
export async function fetchJson(url, { offline = false } = {}) {
  const cached = await readCached(url);
  if (cached !== undefined) {
    netStats.cacheHits += 1;
    return cached;
  }
  if (offline) throw new CacheMissError(url);

  for (let attempt = 0; ; attempt += 1) {
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    netStats.requests += 1;

    let response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        netStats.retries += 1;
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw error;
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt < MAX_RETRIES) {
        netStats.retries += 1;
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

    const json = await response.json();
    await writeCached(url, json);
    return json;
  }
}
