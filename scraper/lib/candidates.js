// Merges the two candidate sources (population ranking table + curated capitals)
// and deduplicates by Wikipedia article title.
export function mergeCandidates(populationRows, capitalRows) {
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

  for (const row of populationRows) add(row, 'population-list');
  for (const row of capitalRows) add(row, 'capitals');

  return [...byArticle.values()];
}
