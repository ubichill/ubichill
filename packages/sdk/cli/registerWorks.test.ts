import type { ModLockEntry } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { compareVersions, latestPerMod, normalizePublicUrl, type RegisterRequest, registerExternalWorks } from './registerWorks.ts';

const entry = (id: string, version: string) => ({ entry: { id, version } as ModLockEntry });

describe('compareVersions（SemVer の優先順位）', () => {
    it.each([
        ['1.10.0', '1.9.0', 1],
        ['2.0.0', '10.0.0', -1],
        ['1.0.0', '1.0.0', 0],
        ['1.0.0', '1.0.0-alpha', 1],
        ['1.0.0-alpha', '1.0.0', -1],
        ['1.0.0-alpha.1', '1.0.0-alpha', 1],
        ['1.0.0-alpha.beta', '1.0.0-alpha.1', 1],
        ['1.0.0-beta.11', '1.0.0-beta.2', 1],
        ['1.0.0-rc.1', '1.0.0-beta.11', 1],
        ['1.0.0+build.2', '1.0.0+build.1', 0],
        ['1.0.0+zzz', '1.0.0', 0],
        ['1.0.1-alpha', '1.0.0', 1],
    ])('%s と %s', (a, b, sign) => {
        expect(Math.sign(compareVersions(a, b))).toBe(sign);
    });

    it('SemVer の例の並び（alpha < alpha.1 < alpha.beta < beta < beta.2 < beta.11 < rc.1 < 正式版）', () => {
        const order = [
            '1.0.0-alpha',
            '1.0.0-alpha.1',
            '1.0.0-alpha.beta',
            '1.0.0-beta',
            '1.0.0-beta.2',
            '1.0.0-beta.11',
            '1.0.0-rc.1',
            '1.0.0',
        ];
        expect([...order].reverse().sort(compareVersions)).toEqual(order);
    });
});

describe('latestPerMod', () => {
    it('正式版があればプレリリースより正式版を残す', () => {
        const latest = latestPerMod([entry('pen', '2.0.0'), entry('pen', '2.0.0-alpha.3'), entry('pen', '2.0.0+meta')]);
        expect(latest.map((m) => m.entry.version)).toEqual(['2.0.0']);
    });

    it('mod ごとに一番新しい版だけを残す（10 は 9 より新しい）', () => {
        const latest = latestPerMod([entry('pen', '2.9.0'), entry('pen', '2.10.0'), entry('vp', '3.1.0'), entry('pen', '2.0.0')]);
        expect(latest.map((m) => `${m.entry.id}@${m.entry.version}`).sort()).toEqual(['pen@2.10.0', 'vp@3.1.0']);
    });
});

describe('normalizePublicUrl', () => {
    it('末尾の / を除く', () => {
        expect(normalizePublicUrl('https://a.github.io/repo/')).toBe('https://a.github.io/repo');
        expect(normalizePublicUrl('https://a.github.io/repo//')).toBe('https://a.github.io/repo');
    });
});

describe('registerExternalWorks', () => {
    const registration = { kind: 'world' as const, url: 'https://a.example/w.yaml', yaml: '', signature: {} };

    it('登録できた件数を返し、断られた・通信できないものは理由つきで警告して続ける', async () => {
        const logs: string[] = [];
        const answers = [
            { status: 200, body: {} },
            { status: 403, body: { error: '署名の作者がログイン中のアカウントではありません' } },
        ];
        const request: RegisterRequest = async () => {
            const next = answers.shift();
            if (!next) throw new Error('offline');
            return next;
        };
        const registered = await registerExternalWorks(request, [registration, registration, registration], (m) =>
            logs.push(m),
        );
        expect(registered).toBe(1);
        expect(logs.filter((m) => m.startsWith('⚠'))).toEqual([
            expect.stringContaining('署名の作者がログイン中のアカウントではありません'),
            expect.stringContaining('通信できません'),
        ]);
    });
});
