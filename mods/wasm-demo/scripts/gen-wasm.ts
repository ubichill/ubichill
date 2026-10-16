import { writeFileSync } from 'node:fs';
import { buildFnv1aWasm } from '../src/fnv1aWasm.ts';

const out = new URL('../assets/fnv1a.wasm', import.meta.url);
writeFileSync(out, buildFnv1aWasm());
console.log(`wrote ${out.pathname}`);
