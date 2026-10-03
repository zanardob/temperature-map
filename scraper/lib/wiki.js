// MediaWiki/QLever API client with on-disk caching and polite, sequential
// request pacing. Every uncached request waits at least MIN_REQUEST_INTERVAL_MS
// after the previous one, so re-runs from cache never touch the network.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, 'data', 'cache');

export const API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
export const USER_AGENT =
  'WorldTemperatureMap/0.1 (https://github.com/example/temperature-map; temperature-map@example.org)';

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

export function cachePathFor(url, extension = 'json') {
  const hash = createHash('sha1').update(url).digest('hex');
  return path.join(CACHE_DIR, `${hash}.${extension}`);
}

async function readCached(url, extension) {
  try {
    return await readFile(cachePathFor(url, extension), 'utf8');
  } catch {
    return undefined;
  }
}

async function writeCached(url, extension, text) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePathFor(url, extension), text);
}

export class CacheMissError extends Error {
  constructor(url) {
    super(`cache miss (offline): ${url}`);
    this.name = 'CacheMissError';
    this.code = 'CACHE_MISS';
  }
}

// Returns the response body for `url` as text, reading from cache when present.
// Throws CacheMissError when offline and not cached; retries transient failures.
async function requestText(url, { offline = false, extension = 'json' } = {}) {
  const cached = await readCached(url, extension);
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
        headers: { 'User-Agent': USER_AGENT },
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
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
        continue;
      }
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

    const text = await response.text();
    await writeCached(url, extension, text);
    return text;
  }
}

// Returns parsed JSON for `url`, reading from cache when present.
export async function fetchJson(url, options = {}) {
  return JSON.parse(await requestText(url, { ...options, extension: 'json' }));
}

// Returns the raw response body (e.g. TSV) for `url`, cached as `.txt`.
export async function fetchText(url, options = {}) {
  return requestText(url, { ...options, extension: 'txt' });
}
