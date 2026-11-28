/**
 * AI エージェントの PreToolUse(Bash) フック。判定は bash-guard.mjs。
 * Claude Code は引数なし、Codex は `--agent=codex` で呼ぶ（Codex は ask に対応しないので止める）。
 * `git config ubichill.ghUser <アカウント>` があれば、GitHub に書き込む前に gh のログイン先を確かめる。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decide, inspectBashCommand } from './bash-guard.mjs';

const run = (command, args, cwd) => {
    try {
        return execFileSync(command, args, { cwd, encoding: 'utf-8', timeout: 10_000 }).trim();
    } catch {
        return null;
    }
};

const input = JSON.parse(readFileSync(0, 'utf-8'));
const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
const agent = process.argv.includes('--agent=codex') ? 'codex' : 'claude';
const command = typeof input.tool_input?.command === 'string' ? input.tool_input.command : '';
const inspection = inspectBashCommand(command);
const expected = inspection.needsGhAccount ? (run('git', ['config', '--get', 'ubichill.ghUser'], cwd) ?? '') : '';
const result = decide(
    inspection,
    { expected, actual: expected ? run('gh', ['api', 'user', '--jq', '.login'], cwd) : null },
    agent,
);

if (result) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...result } }));
}
