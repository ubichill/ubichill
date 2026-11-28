import { describe, expect, it } from 'vitest';
import { decide, inspectBashCommand, tokenize } from './bash-guard.mjs';

const asks = (command) => inspectBashCommand(command).asks;
const needsGh = (command) => inspectBashCommand(command).needsGhAccount;

describe('tokenize', () => {
    it('クォートの中の区切りは語の一部', () => {
        expect(tokenize(`git commit -m "a && b; c"`)).toEqual(['git', 'commit', '-m', 'a && b; c']);
    });

    it('&& と || を 1 つの区切りにする', () => {
        expect(tokenize('a&&b||c')).toEqual(['a', '&', 'b', '|', 'c']);
    });
});

describe('inspectBashCommand: 確かめさせる', () => {
    it.each([
        ['git push --force origin main'],
        ['git push -f'],
        ['git push -uf origin feat'],
        ['git push --force-with-lease'],
        ['git push --force-with-lease=main:abc'],
        ['git push origin +feat:feat'],
        ['git -C /tmp/wt push --force'],
        ['cd packages && git push --force'],
        ['FOO=1 git push --force'],
        ['sudo git push --force'],
        ['echo ok; git push -f'],
        ['echo "$(git push -f)"'],
        ['echo "x $(echo $(git push -f))"'],
        ['echo "`git push -f`"'],
        ['bash -c "git push --force"'],
        ['bash -lc "git push --force"'],
        ['/bin/zsh -ec \'git push -f\''],
    ])('強制 push: %s', (command) => {
        expect(asks(command)).toEqual([expect.stringContaining('強制')]);
    });

    it.each([['git push origin --delete feat'], ['git push origin :feat'], ['git push -d origin feat']])(
        'リモートのブランチを消す: %s',
        (command) => {
            expect(asks(command)).toEqual([expect.stringContaining('消す')]);
        },
    );

    it.each([
        ['git reset --hard'],
        ['git reset --hard origin/main'],
        ['git clean -fdx'],
    ])('%s', (command) => {
        expect(asks(command)).toHaveLength(1);
    });

    it('連ねたコマンドは理由を全部返す', () => {
        expect(asks('git reset --hard && git clean -fdx')).toHaveLength(2);
    });
});

describe('inspectBashCommand: 止めない', () => {
    it.each([
        ['git push'],
        ['git push -u origin feat/x'],
        ['git push origin feat/force-fix'],
        ['git reset --soft HEAD~1'],
        ['git reset HEAD file.ts'],
        ['git clean -n'],
        ['git branch -d -- old-branch'],
        ['git log --format=%f'],
        ['git commit -m "git push --force は使わない"'],
        ['echo "rm -rf /"'],
        ['rm -r dist'],
        ['rm -f file'],
        ['rm -rf dist'],
        ['/bin/rm --recursive --force dist'],
        ['gh auth status'],
        ['gh auth switch -u someone'],
        ['gh api repos/o/r/pulls'],
        ['gh api repos/o/r/pulls --method GET'],
        ['gh pr view 12'],
        ['gh pr merge 12 --squash'],
        ['grep -rf patterns.txt .'],
        ['pnpm test'],
        [''],
    ])('%s', (command) => {
        expect(asks(command)).toEqual([]);
    });
});

describe('inspectBashCommand: gh のログイン先を確かめるもの', () => {
    it.each([
        ['git push'],
        ['gh pr create --title t --body b'],
        ['gh pr comment 1 --body b'],
        ['mise exec -- gh pr merge 12 --squash'],
        ['gh issue create -t t'],
        ['gh repo edit owner/repo --description t'],
        ['gh repo delete owner/repo'],
        ['gh repo deploy-key add key.pub'],
        ['gh api repos/o/r/issues -f title=t'],
        ['gh api repos/o/r/issues --raw-field=title=t'],
        ['gh api repos/o/r/issues -Ftitle=t'],
        ['gh api repos/o/r/labels -X POST'],
        ['gh api repos/o/r/labels -XDELETE'],
    ])('書き込む: %s', (command) => {
        expect(needsGh(command)).toBe(true);
    });

    it.each([
        ['gh pr list'],
        ['gh pr view 1'],
        ['gh pr checks 1'],
        ['gh repo view owner/repo'],
        ['gh repo deploy-key list'],
        ['gh repo clone owner/repo'],
        ['gh repo set-default owner/repo'],
        ['gh api user'],
        ['gh api search/issues --method=GET --field=q=issue'],
        ['git status'],
    ])('読み取りや手元の操作: %s', (command) => {
        expect(needsGh(command)).toBe(false);
    });
});

describe('decide', () => {
    const write = { asks: [], needsGhAccount: true };

    it('期待するアカウントが無ければログイン先は確かめない', () => {
        expect(decide(write, { expected: undefined, actual: null })).toBeNull();
        expect(decide(write, { expected: '  ', actual: 'other' })).toBeNull();
    });

    it('ログイン先が違えば止める', () => {
        expect(decide(write, { expected: 'me', actual: 'other' })).toMatchObject({ permissionDecision: 'deny' });
    });

    it('ログイン先が取れなければ止める', () => {
        expect(decide(write, { expected: 'me', actual: null })).toMatchObject({ permissionDecision: 'deny' });
    });

    it('ログイン先が合っていれば確かめる理由だけ返す', () => {
        expect(decide(write, { expected: 'me', actual: 'me' })).toBeNull();
        expect(
            decide({ asks: ['a', 'b'], needsGhAccount: true }, { expected: 'me', actual: 'me' }),
        ).toEqual({ permissionDecision: 'ask', permissionDecisionReason: 'a / b' });
    });

    it('止める方が確かめるより優先', () => {
        expect(
            decide({ asks: ['force'], needsGhAccount: true }, { expected: 'me', actual: 'other' }),
        ).toMatchObject({ permissionDecision: 'deny' });
    });

    describe('Codex（ask に対応しない）', () => {
        it('確かめる理由があれば止め、ユーザーに実行してもらうよう伝える', () => {
            const result = decide({ asks: ['force'], needsGhAccount: false }, { expected: '', actual: null }, 'codex');
            expect(result).toMatchObject({ permissionDecision: 'deny' });
            expect(result?.permissionDecisionReason).toContain('ユーザー');
        });

        it('何も無ければ何も返さない（Codex の確認の仕組みに任せる）', () => {
            expect(decide({ asks: [], needsGhAccount: false }, { expected: '', actual: null }, 'codex')).toBeNull();
        });

        it('ask は 1 つも返さない', () => {
            const inputs = [
                { asks: ['a'], needsGhAccount: false },
                { asks: ['a'], needsGhAccount: true },
                { asks: [], needsGhAccount: true },
            ];
            const accounts = [
                { expected: '', actual: null },
                { expected: 'me', actual: 'me' },
                { expected: 'me', actual: 'other' },
            ];
            const decisions = inputs.flatMap((i) => accounts.map((a) => decide(i, a, 'codex')?.permissionDecision));
            expect(decisions).not.toContain('ask');
        });
    });
});
