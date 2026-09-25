#!/usr/bin/env node
// Validates data/cities.js by reading the emitted file and evaluating it.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCityData, loadCityData } from './lib/validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, '..', 'data', 'cities.js');

try {
  const source = await readFile(FILE, 'utf8');
  const data = loadCityData(source);
  const violations = checkCityData(data);

  if (violations.length > 0) {
    console.error(`Validation FAILED: ${violations.length} violation(s)`);
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Validation passed: ${data.cities.length} cities (generated ${data.generatedAt}).`,
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
