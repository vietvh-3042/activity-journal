import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

for (const directory of ['dist', 'dist-electron']) {
  rmSync(resolve(directory), { recursive: true, force: true });
}
