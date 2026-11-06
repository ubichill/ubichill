import { closeSync, openSync, utimesSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTerminal, debugFromEnv, processIO } from '@ubichill/terminal';

const file = process.argv[2];
if (!file) {
    createTerminal(processIO(), { debug: debugFromEnv(process.env) }).error('Usage: node touch.mjs <file>');
    process.exit(1);
}

const filePath = resolve(process.cwd(), file);

try {
    const time = new Date();
    utimesSync(filePath, time, time);
} catch {
    closeSync(openSync(filePath, 'w'));
}
