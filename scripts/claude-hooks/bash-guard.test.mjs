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
        ['rm -rf dist'],
        ['rm -fr dist'],
        ['rm -r -f dist'],
        ['rm --recursive --force dist'],
        ['/bin/rm -Rf dist'],
        ['gh auth login'],
        ['gh auth refresh -s delete_repo'],
        ['gh auth switch -u someone'],
        ['gh repo delete owner/repo --yes'],
        ['gh api repos/o/r/issues/1 --method DELETE'],
        ['gh api repos/o/r/issues/1 --method=delete'],
        ['gh api -X DELETE repos/o/r/milestones/1'],
        ['gh api -XDELETE repos/o/r/milestones/1'],
        ['gh pr merge 12 --squash'],
        ['mise exec -- gh pr merge 12'],
    ])('%s', (command) => {
        expect(asks(command)).toHaveLength(1);
    });

    it('連ねたコマンドは理由を全部返す', () => {
        expect(asks('git reset --hard && rm -rf node_modules')).toHaveLength(2);
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
        ['git log --format=%f'],
        ['git commit -m "git push --force は使わない"'],
        ['echo "rm -rf /"'],
        ['rm -r dist'],
        ['rm -f file'],
        ['gh auth status'],
        ['gh api repos/o/r/pulls'],
        ['gh api repos/o/r/pulls --method GET'],
        ['gh pr view 12'],
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
        ['gh issue create -t t'],
        ['gh api repos/o/r/issues -f title=t'],
        ['gh api repos/o/r/labels -X POST'],
    ])('書き込む: %s', (command) => {
        expect(needsGh(command)).toBe(true);
    });

    it.each([['gh pr list'], ['gh pr view 1'], ['gh pr checks 1'], ['gh api user'], ['git status']])(
        '読むだけ: %s',
        (command) => {
            expect(needsGh(command)).toBe(false);
        },
    );
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
});
