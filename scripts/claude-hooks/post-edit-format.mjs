/**
 * Claude Code の PostToolUse(Edit|Write|MultiEdit) フック。書いたファイルに biome check --write をかけ、
 * 自動で直せない違反だけを Claude に返す（exit 2 の stderr が Claude に届く）。
 * 対象かどうかは biome.json の files.includes に任せる。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const MAX_REPORT = 4000;

const input = JSON.parse(readFileSync(0, 'utf-8'));
const filePath = input.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const biome = join(root, 'node_modules', '.bin', 'biome');
const rel = typeof filePath === 'string' ? relative(root, filePath) : '';
const inProject = rel !== '' && !rel.startsWith('..') && !rel.startsWith('/');

if (inProject && existsSync(filePath) && existsSync(biome)) {
    const run = spawnSync(
        biome,
        ['check', '--write', '--no-errors-on-unmatched', '--files-ignore-unknown=true', '--colors=off', rel],
        { cwd: root, encoding: 'utf-8', timeout: 30_000 },
    );
    if (run.status !== 0 && run.status !== null) {
        const report = `${run.stdout}${run.stderr}`.trim();
        process.stderr.write(`biome check が自動で直せない違反: ${rel}\n${report.slice(0, MAX_REPORT)}\n`);
        process.exit(2);
    }
}
