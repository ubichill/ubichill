/**
 * Claude Code の PreToolUse(Bash) フック。判定は bash-guard.mjs。
 * UBICHILL_GH_USER（.claude/settings.local.json の env など）を置くと、GitHub に書き込む前に gh のログイン先を確かめる。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decide, inspectBashCommand } from './bash-guard.mjs';

const activeGhUser = () => {
    try {
        return execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf-8', timeout: 10_000 }).trim();
    } catch {
        return null;
    }
};

const input = JSON.parse(readFileSync(0, 'utf-8'));
const command = input.tool_input?.command ?? '';
const inspection = inspectBashCommand(command);
const expected = process.env.UBICHILL_GH_USER;
const result = decide(inspection, {
    expected,
    actual: inspection.needsGhAccount && expected ? activeGhUser() : null,
});

if (result) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...result } }));
}
