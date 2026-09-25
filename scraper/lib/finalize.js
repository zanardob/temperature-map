// Builds the emitted artefacts, writes them, and validates the result.
import { buildCoverageMarkdown, emitAll } from './emit.js';
import { checkCityData } from './validate.js';
import { netStats } from './wiki.js';

export async function finalize({ candidates, included, excluded, log = console.log }) {
  const generatedAt = new Date().toISOString();
  const cityData = {
    generatedAt,
    source: 'English Wikipedia climate tables',
    cities: included,
  };
  const candidatesData = {
    generatedAt,
    candidates: candidates.map((candidate) => ({
      name: candidate.name,
      country: candidate.country,
      article: candidate.article,
      sources: candidate.sources,
    })),
  };
  const coverageMarkdown = buildCoverageMarkdown({ generatedAt, included, excluded });

  const violations = checkCityData(cityData);
  log(`Included ${included.length} cities, excluded ${excluded.length}.`);
  log(
    `Network requests: ${netStats.requests}, cache hits: ${netStats.cacheHits}, retries: ${netStats.retries}.`,
  );

  if (violations.length > 0) {
    log(`Validation FAILED (${violations.length} violation(s)):`);
    for (const violation of violations.slice(0, 20)) log(`  - ${violation}`);
    const error = new Error('dataset validation failed');
    error.violations = violations;
    throw error;
  }

  await emitAll({ cityData, candidatesData, coverageMarkdown });
  log(`Validation passed (${included.length} cities).`);
  return { cityData, candidatesData, coverageMarkdown };
}
