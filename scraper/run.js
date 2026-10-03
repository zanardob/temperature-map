#!/usr/bin/env node
// Full pipeline: lists -> candidates -> articles -> coordinates -> parse ->
// validate -> emit. Pass --no-fetch to reuse the on-disk cache with no network.
import { finalize } from './lib/finalize.js';
import { buildDataset } from './lib/pipeline.js';

const offline = process.argv.includes('--no-fetch');

try {
  const { candidates, included, excluded } = await buildDataset({
    offline,
    onProgress: (done, total) => console.log(`  ${done}/${total} candidates processed...`),
  });
  console.log(`Candidates: ${candidates.length}${offline ? ' (offline, cache only)' : ''}`);
  await finalize({ candidates, included, excluded });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
