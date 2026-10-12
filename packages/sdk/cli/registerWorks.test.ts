import type { ModLockEntry } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { compareVersions, latestPerMod, normalizePublicUrl, type RegisterRequest, registerExternalWorks } from './registerWorks.ts';

const entry = (id: string, version: string) => ({ entry: { id, version } as ModLockEntry });

describe('compareVersions', () => {
    it.each([
        ['1.10.0', '1.9.0', 1],
        ['2.0.0', '10.0.0', -1],
        ['1.0.0', '1.0.0', 0],
        ['1.0.1', '1.0', 1],
    ])('%s と %s', (a, b, sign) => {
        expect(Math.sign(compareVersions(a, b))).toBe(sign);
    });
});

describe('latestPerMod', () => {
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
