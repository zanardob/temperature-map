// Dataset serialisation: data/cities.js (browser-loadable global), the
// candidate inventory, and the coverage report.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from './wiki.js';

const DATA_DIR = path.join(REPO_ROOT, 'data');

export function serializeCityData(cityData) {
  return `const CITY_DATA = ${JSON.stringify(cityData, null, 2)};\n`;
}

function escapePipes(text) {
  return String(text).replace(/\|/g, '\\|');
}

function flagsFor(city) {
  const flags = [];
  if (city.avgDerived) flags.push('avgDerived');
  if (city.fromFahrenheit) flags.push('fromFahrenheit');
  return flags.length ? flags.join(', ') : '—';
}

export function buildCoverageMarkdown({ generatedAt, included, excluded }) {
  const lines = [];
  lines.push('# Data coverage', '');
  lines.push(`Generated: ${generatedAt}`, '');
  lines.push('## Summary', '');
  lines.push(`- Included cities: ${included.length}`);
  lines.push(`- Excluded cities: ${excluded.length}`);
  lines.push(
    `- Derived daily mean (avgDerived): ${included.filter((c) => c.avgDerived).length}`,
  );
  lines.push(
    `- Converted from Fahrenheit: ${included.filter((c) => c.fromFahrenheit).length}`,
  );
  lines.push('');

  lines.push('## Included cities', '');
  lines.push('| City | Country | Source caption | Flags |');
  lines.push('| --- | --- | --- | --- |');
  for (const city of included) {
    lines.push(
      `| ${escapePipes(city.name)} | ${escapePipes(city.country)} | ${escapePipes(city.source)} | ${flagsFor(city)} |`,
    );
  }
  lines.push('');

  lines.push('## Excluded cities', '');
  lines.push('| City | Article | Reason |');
  lines.push('| --- | --- | --- |');
  for (const item of excluded) {
    lines.push(`| ${escapePipes(item.name)} | ${escapePipes(item.article)} | ${escapePipes(item.reason)} |`);
  }
  lines.push('');

  return lines.join('\n');
}

export async function emitAll({ cityData, candidatesData, coverageMarkdown }) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, 'cities.js'), serializeCityData(cityData));
  await writeFile(
    path.join(DATA_DIR, 'candidates.json'),
    `${JSON.stringify(candidatesData, null, 2)}\n`,
  );
  await writeFile(path.join(DATA_DIR, 'coverage.md'), coverageMarkdown);
}
