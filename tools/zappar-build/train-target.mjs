// Trains a Zappar image target (.zpt) from a photo, offline, using @zappar/imagetraining.
// Usage: node train-target.mjs <photo.jpg|png> <output.zpt>
import { train } from '@zappar/imagetraining';
import fs from 'fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node train-target.mjs <photo.jpg|png> <output.zpt>');
  process.exit(1);
}
const zpt = await train(fs.readFileSync(input), {});
fs.writeFileSync(output, Buffer.from(zpt));
console.log(`Wrote ${output} (${fs.statSync(output).size} bytes)`);
