# World Monthly Temperatures

<p align="center">
  <a href="https://howhotis.it"><img src="assets/live-map-badge.svg" alt="Open the live map at howhotis.it"></a>
</p>

Interactive map of monthly temperatures (high / average / low, °C) for 3,614 cities worldwide, scraped from English Wikipedia climate tables.

- **Frontend:** plain HTML/CSS/JS + [MapLibre GL JS](https://maplibre.org/) with [OpenFreeMap](https://openfreemap.org/) Liberty vector tiles — no API keys, no Google.
- **Data:** Node.js scraper over Wikipedia `Weather box` tables. Output is committed as `data/cities.js`, so the page works straight from a clone.

## Quick start

```bash
npm install
npm test          # parser/validator tests (29)
npm run check:web # map style layers + expressions (no browser needed)
npm run scrape    # fetch + parse + validate → data/cities.js (+ coverage report)
npm run build     # parse from cache only (offline)
npm run validate
open index.html   # works from file://
```

A cold `npm run scrape` takes roughly an hour: every request is paced at one
per second (~3,800 requests for 3,600 cities), and `data/cache/` (gitignored)
makes re-runs near-instant.

## The map

- One badge per city: fill colour from Wikipedia's own weather-box temperature ramp (ported from `Module:Weather box/colors`), with the rounded value and unit ("23°C") printed inside.
- Month slider (Jan–Dec) plus a play button; **High / Average / Low** metric toggle (averages shown by default).
- Overlapping badges merge into one cluster circle showing the **average of the currently selected metric** over the member count as a two-line badge (`22°C` / `(2)`); click a cluster to zoom to the level where it splits. Remaining label collisions are still dropped adaptively, and cluster averages win placement priority over individual labels.
- Click a city badge for a popup with the month's high, average, low, typical extremes and records, plus a **Source: Wikipedia ↗** link that deep-links the article section holding the chosen weather box.
- The equator (continuous) and both tropics (dashed) are drawn as faded reference lines with labels (`EQUATOR`, `TROPIC OF CANCER`, `TROPIC OF CAPRICORN`) under the badges; the reference labels opt out of collision handling so they can never steal placement from the city/cluster labels.
- The style JSON is cached in `localStorage` for a day; tiles, glyphs and sprites rely on the browser HTTP cache (OpenFreeMap serves 24 h–10 year cache headers).
- Colour and value are always Celsius.
- The initial view fits every city, so the whole world is visible on load; pan and zoom in for individual badges.

## The data

Candidate cities come from two sources, deduplicated by article:

1. **Wikidata** (queried through QLever, cached like everything else): every settlement or municipality with a population of at least 100,000, anywhere in the world, that has an English Wikipedia article and **transcludes `Template:Weather box`** — 3,621 cities. The intersection with the template means almost every candidate yields a climate table, and it filters out most districts, regions and metro areas. The few non-city survivors (US and Canadian counties whose articles carry a weather box, metropolitan areas such as Greater Boston or Metro Manila, city districts and neighbourhoods such as Tai Po or Borough Park) are denylisted explicitly in `scraper/lib/wikidata.js`.
2. A curated list of national capitals (`scraper/capitals.js`, drafted from Wikidata's `P36` and cross-checked against Wikipedia's "List of national capitals"). Capitals bypass the population threshold but still have to carry a weather box; this adds 39 small capitals that fall below 100,000 inhabitants (Monaco, Vaduz, Ngerulmud, Funafuti, Majuro, …).

For each city the scraper picks one climate box: city-proper station preferred, airport/outer stations penalised, newest normals period (1991–2020 > 1981–2010), and boxes carrying the rows that are actually plotted (daily high/low) outweigh boxes with only a daily mean. Only `table.wikitable` boxes are parsed; the CSS `{{Climate chart}}` graphic carries no row labels and is skipped.

- **High** = `Mean daily maximum`, **Average** = `Daily mean`, **Low** = `Mean daily minimum`.
- Also stored for popups: `Mean maximum`, `Mean minimum`, `Record high`, `Record low`, and the section anchor of the chosen box (`climateAnchor`), used to deep-link the popup's "Source: Wikipedia ↗" link.
- Celsius only. Missing `Daily mean` is derived as (high + low) / 2 and flagged `avgDerived`; Fahrenheit-only boxes are converted and flagged `fromFahrenheit`.
- Coverage, sources and exclusions are reported in [`data/coverage.md`](data/coverage.md) (currently 3,614 included, 46 excluded: 34 whose only climate table carries a daily mean but no daily high/low — mostly German cities with short DWD station records — nine without any usable climate table (Singapore included), and three whose published rows fail the ordering check: Hanoi, Narowal and Vologda).

Data quality notes: some cities' Wikipedia articles only provide an airport/outlying station (e.g. London LHR, Amsterdam Schiphol, Bratislava, Skopje); the caption of the chosen box is recorded in every city entry. Hanau falls just below Wikidata's population threshold (98,582) and is not carried by hand; Greater Sudbury and Peterborough are real cities whose names merely contain "Greater" and "borough".

## Layout

```
index.html, style.css, app.js   static frontend (MapLibre from CDN)
mock/mock-cities.js             UI development data (used only when data/cities.js is absent)
tools/check-web.cjs             headless style/expression check for the frontend (npm run check:web)
scraper/                        Node pipeline: candidates → fetch → parse → validate → emit
  lib/                          wiki client, parsers, validator, emitters
  test/ fixtures/               29 node:test cases + HTML fixtures
data/cities.js                  generated dataset (committed, one city per line)
data/candidates.json            candidate inventory with sources
data/coverage.md                included/excluded report
data/cache/                     raw API responses (gitignored, powers offline rebuilds)
```
