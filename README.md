# Europe Monthly Temperatures

Interactive map of monthly temperatures (high / average / low, °C) for major European cities, scraped from English Wikipedia climate tables.

- **Frontend:** plain HTML/CSS/JS + [MapLibre GL JS](https://maplibre.org/) with [OpenFreeMap](https://openfreemap.org/) vector tiles — no API keys, no Google.
- **Data:** Node.js scraper over Wikipedia `Weather box` tables. Output is committed as `data/cities.js`, so the page works straight from a clone.

## Quick start

```bash
npm install
npm test          # parser tests
npm run scrape    # fetch + parse + validate → data/cities.js (+ coverage report)
npm run validate
open index.html   # works from file://
```

Full details land here as the project is built.
