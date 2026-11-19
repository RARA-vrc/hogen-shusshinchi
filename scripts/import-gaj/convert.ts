// Placeholder for a future converter from NINJAL dialect survey data
// (Grammar Atlas of Japanese Dialects, etc.) to this project's question
// distribution format. NOT IMPLEMENTED: no licence has been obtained yet, and
// no NINJAL data may be committed to this repository.
//
// Planned shape:
//   input : scripts/import-gaj/input/   (git-ignored; survey points with
//           latitude/longitude and the recorded form per map item)
//   output: scripts/import-gaj/output/  (git-ignored; per-cell answer
//           distributions in the same structure the question build step
//           produces, so the engine needs no changes)

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const inputDir = join(here, 'input');

function main(): void {
  console.log('import-gaj is a placeholder and does nothing yet.');
  console.log('NINJAL data requires permission before it can be used; see README.md.');
  console.log(`Input directory ${existsSync(inputDir) ? 'exists' : 'does not exist'}: ${inputDir}`);
}

if (import.meta.main) main();
