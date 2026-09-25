#!/usr/bin/env node
// Cache-only build: parse from cache, validate, emit. Never touches the network.
import { finalize } from './lib/finalize.js';
import { buildDataset } from './lib/pipeline.js';

try {
  const { candidates, included, excluded } = await buildDataset({ offline: true });
  console.log(`Candidates: ${candidates.length} (cache only)`);
  await finalize({ candidates, included, excluded });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
