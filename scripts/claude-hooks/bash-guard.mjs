/**
 * Claude Code の PreToolUse(Bash) で、取り返しのつかないコマンドを人に確かめさせる判定。
 * 入出力は pre-bash.mjs が持つ。ここは文字列だけを見る純粋な関数。
 *
 * 守りの網であって境界ではない（eval・変数展開・スクリプト経由は見えない）。
 */

const SEPARATORS = new Set(['&&', '||', ';', '|', '&', '\n', '(', ')']);

/** クォートを解いて語と区切りに分ける。`$(` の中身も別のコマンドとして出す。 */
export const tokenize = (command) => {
    const tokens = [];
    const state = { word: null, quote: null };
    const flush = () => {
        if (state.word !== null) tokens.push(state.word);
        state.word = null;
    };
    const append = (ch) => {
        state.word = (state.word ?? '') + ch;
    };
    for (const [i, ch] of [...command].entries()) {
        const next = command[i + 1];
        if (state.quote) {
            if (ch === state.quote) state.quote = null;
            else append(ch);
        } else if (ch === "'" || ch === '"') {
            state.quote = ch;
            state.word = state.word ?? '';
        } else if (ch === ' ' || ch === '\t') {
            flush();
        } else if (ch === '$' && next === '(') {
            flush();
        } else if ((ch === '&' || ch === '|') && next === ch) {
            // 2 文字目は次の周回で区切りとして出るので、ここでは 1 文字目を捨てる
            flush();
        } else if (SEPARATORS.has(ch)) {
            flush();
            tokens.push(ch);
        } else {
            append(ch);
        }
    }
    flush();
    return tokens;
};

export const splitSegments = (tokens) =>
    tokens
        .reduce(
            (segments, token) =>
                SEPARATORS.has(token)
                    ? [...segments, []]
                    : [...segments.slice(0, -1), [...segments[segments.length - 1], token]],
            [[]],
        )
        .filter((segment) => segment.length > 0);

const WRAPPERS = new Set(['sudo', 'env', 'command', 'time', 'nohup', 'exec']);
const isAssignment = (token) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
const basename = (path) => path.split('/').pop();

/** 環境変数の代入・sudo・`mise exec ... --` などの前置きを外す。 */
export const stripWrappers = (segment) => {
    const [head, ...rest] = segment;
    if (head === undefined) return segment;
    if (isAssignment(head) || WRAPPERS.has(basename(head))) return stripWrappers(rest);
    if (basename(head) === 'mise' && rest[0] === 'exec') {
        const dashdash = rest.indexOf('--');
        return dashdash === -1 ? [] : stripWrappers(rest.slice(dashdash + 1));
    }
    return segment;
};

/** git の大域オプション（-C path など）を飛ばして、サブコマンドと引数を返す。 */
const gitSubcommand = (args) => {
    const [head, ...rest] = args;
    if (head === undefined) return { sub: undefined, args: [] };
    if (head === '-C' || head === '-c' || head === '--git-dir' || head === '--work-tree') {
        return gitSubcommand(rest.slice(1));
    }
    if (head.startsWith('-')) return gitSubcommand(rest);
    return { sub: head, args: rest };
};

const hasShortFlag = (args, letter) => args.some((a) => /^-[A-Za-z]+$/.test(a) && a.includes(letter));
const hasAny = (args, flags) => args.some((a) => flags.some((f) => a === f || a.startsWith(`${f}=`)));

const inspectGit = (args) => {
    const { sub, args: rest } = gitSubcommand(args);
    if (sub === 'push') {
        const positional = rest.filter((a) => !a.startsWith('-'));
        const force =
            hasAny(rest, ['--force', '--force-with-lease']) ||
            hasShortFlag(rest, 'f') ||
            positional.some((a) => a.startsWith('+'));
        const remoteDelete =
            hasAny(rest, ['--delete', '--mirror', '--prune']) ||
            hasShortFlag(rest, 'd') ||
            positional.some((a) => a.startsWith(':'));
        return {
            asks: [
                ...(force ? ['git push の強制（--force / --force-with-lease / +refspec）はリモートの履歴を壊す'] : []),
                ...(remoteDelete ? ['git push でリモートのブランチを消す'] : []),
            ],
            needsGhAccount: true,
        };
    }
    if (sub === 'reset' && rest.includes('--hard')) {
        return { asks: ['git reset --hard はコミットしていない変更を捨てる'], needsGhAccount: false };
    }
    if (sub === 'clean' && (hasShortFlag(rest, 'f') || hasAny(rest, ['--force']))) {
        return { asks: ['git clean -f は追跡していないファイルを消す'], needsGhAccount: false };
    }
    return { asks: [], needsGhAccount: false };
};

const GH_READ_ONLY = new Set(['list', 'view', 'status', 'diff', 'checks', 'checkout']);

const ghApiMethod = (args) => {
    const explicit = args.flatMap((a, i) => {
        if (a === '-X' || a === '--method') return [args[i + 1] ?? ''];
        if (a.startsWith('--method=')) return [a.slice('--method='.length)];
        if (/^-X[A-Za-z]+$/.test(a)) return [a.slice(2)];
        return [];
    });
    if (explicit.length > 0) return explicit[explicit.length - 1].toUpperCase();
    // フィールドを渡すと gh api は既定で POST になる
    const hasFields = args.some((a) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(a));
    return hasFields ? 'POST' : 'GET';
};

const inspectGh = (args) => {
    const [group, sub, ...rest] = args;
    if (group === 'auth') {
        return sub === 'status'
            ? { asks: [], needsGhAccount: false }
            : { asks: [`gh auth ${sub ?? ''} はログイン先や権限の範囲を変える`], needsGhAccount: false };
    }
    if (group === 'repo' && sub === 'delete') {
        return { asks: ['gh repo delete はリポジトリごと消す'], needsGhAccount: false };
    }
    if (group === 'api') {
        const method = ghApiMethod([sub, ...rest].filter((a) => a !== undefined));
        return {
            asks: method === 'DELETE' ? ['gh api の DELETE は gh のサブコマンドの制約を受けずに消す'] : [],
            needsGhAccount: method !== 'GET',
        };
    }
    if (group === 'pr' && sub === 'merge') {
        return { asks: ['PR は人がレビューしてからマージする'], needsGhAccount: true };
    }
    if (['pr', 'issue', 'release', 'label'].includes(group) && sub !== undefined && !GH_READ_ONLY.has(sub)) {
        return { asks: [], needsGhAccount: true };
    }
    return { asks: [], needsGhAccount: false };
};

const inspectRm = (args) => {
    const flags = args.filter((a) => a.startsWith('-'));
    const recursive = hasShortFlag(flags, 'r') || hasShortFlag(flags, 'R') || flags.includes('--recursive');
    const force = hasShortFlag(flags, 'f') || flags.includes('--force');
    return { asks: recursive && force ? ['rm -rf はファイルを完全に消す'] : [], needsGhAccount: false };
};

const SHELLS = new Set(['bash', 'sh', 'zsh']);

const inspectSegment = (segment) => {
    const [program, ...args] = stripWrappers(segment);
    if (program === undefined) return { asks: [], needsGhAccount: false };
    const name = basename(program);
    if (SHELLS.has(name)) {
        const script = args[args.indexOf('-c') + 1];
        return args.includes('-c') && script !== undefined
            ? inspectBashCommand(script)
            : { asks: [], needsGhAccount: false };
    }
    if (name === 'git') return inspectGit(args);
    if (name === 'gh') return inspectGh(args);
    if (name === 'rm') return inspectRm(args);
    return { asks: [], needsGhAccount: false };
};

/**
 * `$(...)` と `...` の中身。ダブルクォートの中でも実行されるので、クォートに関係なく取り出す
 * （シングルクォートの中も拾うが、確かめる側に倒れるだけ）。
 */
export const commandSubstitutions = (command) => {
    const backticks = [...command.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
    const dollar = [...command.matchAll(/\$\(/g)].map((m) => {
        const start = m.index + 2;
        const end = [...command.slice(start)].reduce(
            (acc, ch, i) => {
                if (acc.end !== null) return acc;
                const depth = acc.depth + (ch === '(' ? 1 : ch === ')' ? -1 : 0);
                return { depth, end: depth === 0 ? start + i : null };
            },
            { depth: 1, end: null },
        ).end;
        return command.slice(start, end ?? command.length);
    });
    return [...backticks, ...dollar];
};

/**
 * @param {string} command
 * @returns {{ asks: string[], needsGhAccount: boolean }}
 *   asks: 人に確かめさせる理由。needsGhAccount: GitHub に書き込むので gh のログイン先を確かめるべきか。
 */
export const inspectBashCommand = (command) => {
    const results = [
        ...splitSegments(tokenize(command)).map(inspectSegment),
        ...commandSubstitutions(command).map(inspectBashCommand),
    ];
    return {
        asks: [...new Set(results.flatMap((r) => r.asks))],
        needsGhAccount: results.some((r) => r.needsGhAccount),
    };
};

/**
 * 判定結果を PreToolUse の hookSpecificOutput に変える。何も言うことがなければ null。
 * @param {{ asks: string[], needsGhAccount: boolean }} inspection
 * @param {{ expected?: string, actual?: string | null }} account
 *   expected が空なら gh のログイン先は確かめない。actual は取れなかったら null。
 */
export const decide = (inspection, account) => {
    const expected = account.expected?.trim();
    if (inspection.needsGhAccount && expected) {
        if (account.actual !== expected) {
            const actual = account.actual ?? '（取得できない）';
            return {
                permissionDecision: 'deny',
                permissionDecisionReason: `gh のログイン先が ${actual} で、${expected} ではない。\`gh auth switch -u ${expected}\` を人に頼むこと。`,
            };
        }
    }
    if (inspection.asks.length > 0) {
        return { permissionDecision: 'ask', permissionDecisionReason: inspection.asks.join(' / ') };
    }
    return null;
};
