/**
 * AI エージェントの PostToolUse フック（Claude Code: Edit|Write|MultiEdit、Codex: apply_patch）。
 * 書いたファイルに biome check --write をかけ、自動で直せない違反だけをエージェントに返す（exit 2 の stderr が届く）。
 * 対象かどうかは biome.json の files.includes に任せる。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { editedFiles } from './edited-files.mjs';

const MAX_REPORT = 4000;

const projectRoot = (cwd) => {
    if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
    try {
        return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8' }).trim();
    } catch {
        return cwd;
    }
};

const input = JSON.parse(readFileSync(0, 'utf-8'));
const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
const root = projectRoot(cwd);
const biome = join(root, 'node_modules', '.bin', 'biome');
const targets = editedFiles(input.tool_input, cwd)
    .filter((path) => existsSync(path))
    .map((path) => relative(root, path))
    .filter((rel) => rel !== '' && !rel.startsWith('..') && !rel.startsWith('/'));

if (targets.length > 0 && existsSync(biome)) {
    const run = spawnSync(
        biome,
        ['check', '--write', '--no-errors-on-unmatched', '--files-ignore-unknown=true', '--colors=off', ...targets],
        { cwd: root, encoding: 'utf-8', timeout: 30_000 },
    );
    if (run.status !== 0 && run.status !== null) {
        const report = `${run.stdout}${run.stderr}`.trim();
        process.stderr.write(`biome check が自動で直せない違反: ${targets.join(', ')}\n${report.slice(0, MAX_REPORT)}\n`);
        process.exit(2);
    }
}
