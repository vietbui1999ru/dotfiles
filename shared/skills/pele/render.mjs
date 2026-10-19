#!/usr/bin/env node
// pele-render: render Mermaid text to a standalone SVG with the pinned pele in this folder.
// Linked to ~/.local/bin/pele-render by scripts/bootstrap-dirs.sh. Node resolves the
// symlink, so `import 'pele'` finds this folder's node_modules.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { render } from 'pele';

const usage = 'usage: pele-render [input.mmd|-] [-o output.svg] [--max-width N] [--padding N]';

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      'max-width': { type: 'string' },
      padding: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (err) {
  console.error(`pele-render: ${err.message}\n${usage}`);
  process.exit(2);
}

const { values, positionals } = args;
if (values.help) {
  console.log(usage);
  process.exit(0);
}

const input = positionals[0] ?? '-';
const source = readFileSync(input === '-' ? 0 : input, 'utf8');

const options = {};
if (values['max-width']) options.maxWidth = Number(values['max-width']);
if (values.padding) options.padding = Number(values.padding);

let result;
try {
  result = render(source, options);
} catch (err) {
  console.error(`pele-render: ${input}: ${err.message}`);
  process.exit(1);
}

if (values.output) writeFileSync(values.output, result.svg + '\n');
else process.stdout.write(result.svg + '\n');
