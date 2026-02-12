import { writeFileSync, utimesSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';

const file = process.argv[2];
if (!file) {
    console.error('Usage: node touch.mjs <file>');
    process.exit(1);
}

const filePath = resolve(process.cwd(), file);

try {
    const time = new Date();
    utimesSync(filePath, time, time);
} catch (err) {
    closeSync(openSync(filePath, 'w'));
}
