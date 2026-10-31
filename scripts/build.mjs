import { mkdir } from 'node:fs/promises';
import { formatError } from '@punyts/stateui-app/build';
import { COMPONENT_GROUPS } from '../dist/index.js';
import { buildComponents } from './buildComponents.mjs';

const SOURCE = 'components';
const OUT = 'dist/components';

for (const group of COMPONENT_GROUPS) await mkdir(`${SOURCE}/${group}`, { recursive: true });

const result = await buildComponents(SOURCE, OUT);
for (const error of result.errors) process.stderr.write(`${formatError(error)}\n`);
const count = result.built.length;
process.stdout.write(`Built ${count} component${count === 1 ? '' : 's'} into ${OUT}\n`);
process.exit(result.errors.some((error) => error.severity !== 'warning') ? 1 : 0);
