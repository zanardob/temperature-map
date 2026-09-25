// Merges the candidate sources (population ranking, EU city ranking, curated
// capitals) and deduplicates by Wikipedia article title.
export function mergeCandidates(sources) {
  const byArticle = new Map();

  const add = (row, source) => {
    const existing = byArticle.get(row.article);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    byArticle.set(row.article, {
      name: row.name,
      country: row.country,
      article: row.article,
      sources: [source],
    });
  };

  for (const { rows, source } of sources) {
    for (const row of rows) add(row, source);
  }

  return [...byArticle.values()];
}
