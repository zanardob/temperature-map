# Europe Monthly Temperatures

Interactive map of monthly temperatures (high / average / low, °C) for 135 European cities, scraped from English Wikipedia climate tables.

- **Frontend:** plain HTML/CSS/JS + [MapLibre GL JS](https://maplibre.org/) with [OpenFreeMap](https://openfreemap.org/) Liberty vector tiles — no API keys, no Google.
- **Data:** Node.js scraper over Wikipedia `Weather box` tables. Output is committed as `data/cities.js`, so the page works straight from a clone.

## Quick start

```bash
npm install
npm test          # parser/validator tests (22)
npm run check:web # map style layers + expressions (no browser needed)
npm run scrape    # fetch + parse + validate → data/cities.js (+ coverage report)
npm run build     # parse from cache only (offline)
npm run validate
open index.html   # works from file://
```

## The map

- One badge per city: fill colour from Wikipedia's own weather-box temperature ramp (ported from `Module:Weather box/colors`), with the rounded value and unit ("23°C") printed inside.
- Month slider (Jan–Dec) plus a play button; **High / Average / Low** metric toggle (averages shown by default).
- Overlapping badges merge into one cluster circle showing the **average of the currently selected metric** over the member count as a two-line badge (`22°C` / `(2)`); click a cluster to zoom to the level where it splits. Remaining label collisions are still dropped adaptively, and cluster averages win placement priority over individual labels.
- Click a city badge for a popup with the month's high, average, low, typical extremes and records.
- The style JSON is cached in `localStorage` for a day; tiles, glyphs and sprites rely on the browser HTTP cache (OpenFreeMap serves 24 h–10 year cache headers).
- Colour and value are always Celsius.

## The data

Candidate cities come from three Wikipedia lists, deduplicated by article:

1. [List of European cities by population within city limits](https://en.wikipedia.org/wiki/List_of_European_cities_by_population_within_city_limits) (~1M+ city proper)
2. [List of cities in the European Union by population within city limits](https://en.wikipedia.org/wiki/List_of_cities_in_the_European_Union_by_population_within_city_limits)
3. A curated list of all European national capitals (`scraper/capitals.js`)

For each city the scraper picks one climate box: city-proper station preferred, airport/outer stations penalised, newest normals period (1991–2020 > 1981–2010) and row completeness break ties. Only `table.wikitable` boxes are parsed; the CSS `{{Climate chart}}` graphic carries no row labels and is skipped.

- **High** = `Mean daily maximum`, **Average** = `Daily mean`, **Low** = `Mean daily minimum`.
- Also stored for popups: `Mean maximum`, `Mean minimum`, `Record high`, `Record low`.
- Celsius only. Missing `Daily mean` is derived as (high + low) / 2 and flagged `avgDerived`; Fahrenheit-only boxes are converted and flagged `fromFahrenheit`.
- Coverage, sources and exclusions are reported in [`data/coverage.md`](data/coverage.md) (currently 135 included, 2 excluded: Wuppertal and Vila Nova de Gaia have no climate table).

Data quality notes: some cities' Wikipedia articles only provide an airport/outlying station (e.g. London LHR, Amsterdam Schiphol, Bratislava, Skopje, Vatican City); the caption of the chosen box is recorded in every city entry.

## Layout

```
index.html, style.css, app.js   static frontend (MapLibre from CDN)
mock/mock-cities.js             UI development data (used only when data/cities.js is absent)
tools/check-web.cjs             headless style/expression check for the frontend (npm run check:web)
scraper/                        Node pipeline: lists → candidates → fetch → parse → validate → emit
  lib/                          wiki client, parsers, validator, emitters
  test/ fixtures/               22 node:test cases + HTML fixtures
data/cities.js                  generated dataset (committed)
data/candidates.json            candidate inventory with sources
data/coverage.md                included/excluded report
data/cache/                     raw API responses (gitignored, powers offline rebuilds)
```
