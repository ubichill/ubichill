import type { ModLockEntry } from '@ubichill/shared';
import { recordingLogger } from '@ubichill/terminal';
import { describe, expect, it, vi } from 'vitest';
import {
    compareVersions,
    exitCodeOf,
    latestPerMod,
    listedModIds,
    normalizePublicUrl,
    REGISTRATION_FAILED_EXIT_CODE,
    type RegisterRequest,
    RegistrationError,
    registerDeployedMods,
    registerExternalWorks,
    unregisterExternalMods,
} from './registerWorks.ts';

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
        const latest = latestPerMod([
            entry('pen', '2.9.0'),
            entry('pen', '2.10.0'),
            entry('vp', '3.1.0'),
            entry('pen', '2.0.0'),
        ]);
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
        const { logger, entries } = recordingLogger();
        const answers = [
            { status: 200, body: {} },
            { status: 403, body: { error: '署名の作者がログイン中のアカウントではありません' } },
        ];
        const request: RegisterRequest = async () => {
            const next = answers.shift();
            if (!next) throw new Error('offline');
            return next;
        };
        const registered = await registerExternalWorks(request, [registration, registration, registration], logger);
        expect(registered).toBe(1);
        expect(entries.filter((e) => e.level === 'warn').map((e) => e.message)).toEqual([
            expect.stringContaining('署名の作者がログイン中のアカウントではありません'),
            expect.stringContaining('通信できません'),
        ]);
    });
});

describe('registerExternalWorks（--require-registration）', () => {
    const registration = { kind: 'world' as const, url: 'https://a.example/w.yaml', yaml: '', signature: {} };
    const answering =
        (...statuses: number[]): RegisterRequest =>
        async () => ({ status: statuses.shift() ?? 200, body: { error: '登録は 200 件までです' } });

    it('1 件でも登録できなければ、全部を試して理由を出してから失敗にする（終了コード 2）', async () => {
        const { logger, entries } = recordingLogger();
        const request = vi.fn(answering(200, 409));
        const failure = await registerExternalWorks(request, [registration, registration], logger, {
            required: true,
        }).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(RegistrationError);
        expect(exitCodeOf(failure)).toBe(REGISTRATION_FAILED_EXIT_CODE);
        expect(request).toHaveBeenCalledTimes(2);
        const warning = entries.find((e) => e.level === 'warn')?.message ?? '';
        expect(warning).toContain('登録は 200 件までです');
        expect(warning).not.toContain('続けます');
    });

    it('通信できないのも失敗。全部登録できれば件数を返す', async () => {
        const { logger } = recordingLogger();
        const offline: RegisterRequest = async () => Promise.reject(new Error('offline'));
        await expect(registerExternalWorks(offline, [registration], logger, { required: true })).rejects.toThrow(
            RegistrationError,
        );
        expect(
            await registerExternalWorks(answering(200, 200), [registration, registration], logger, { required: true }),
        ).toBe(2);
    });

    it('ほかの失敗の終了コードは 1 のまま（CI が公開先の反映待ちとして、やり直せる）', () => {
        expect(exitCodeOf(new Error('配布先の lock が一致しません'))).toBe(1);
        expect(exitCodeOf('x')).toBe(1);
    });
});

describe('registerDeployedMods', () => {
    it('配置前の署名だけでは既存カタログのポインタを変えない', async () => {
        const verifyPublic = vi.fn();
        const register = vi.fn(async () => 1);
        const { logger } = recordingLogger();
        expect(
            await registerDeployedMods({
                checked: false,
                signed: [entry('demo', '2.0.0')],
                verifyPublic,
                register,
                unregister: vi.fn(),
                log: logger,
            }),
        ).toBe(0);
        expect(verifyPublic).not.toHaveBeenCalled();
        expect(register).not.toHaveBeenCalled();
    });
    it('配布物の取得失敗では一部も登録しない', async () => {
        const register = vi.fn(async () => 1);
        const { logger } = recordingLogger();
        await expect(
            registerDeployedMods({
                checked: true,
                signed: [entry('demo', '2.0.0')],
                verifyPublic: async () => {
                    throw new Error('not deployed');
                },
                register,
                unregister: vi.fn(),
                log: logger,
            }),
        ).rejects.toThrow('not deployed');
        expect(register).not.toHaveBeenCalled();
    });
    it('配置確認後に各packageの最大の版を登録する', async () => {
        const signed = [entry('demo', '2.0.0'), entry('demo', '1.9.1')];
        const register = vi.fn(async () => 1);
        const { logger } = recordingLogger();
        const unregister = vi.fn(async () => 0);
        await registerDeployedMods({
            checked: true,
            signed,
            verifyPublic: async () => {},
            register,
            unregister,
            log: logger,
        });
        expect(register).toHaveBeenCalledWith([signed[0]]);
        expect(unregister).not.toHaveBeenCalled();
    });
    it('配布先の一覧に載っている mod だけを確かめて登録し、載っていない mod の登録は 1 回ずつ消す', async () => {
        const signed = [entry('pen', '2.3.1'), entry('video-player', '2.1.0'), entry('video-player', '2.0.0')];
        const verifyPublic = vi.fn(async () => {});
        const register = vi.fn(async () => 1);
        const unregister = vi.fn(async () => 1);
        const { logger } = recordingLogger();
        await registerDeployedMods({
            checked: true,
            signed,
            listed: new Set(['pen', 'danmaku']),
            verifyPublic,
            register,
            unregister,
            log: logger,
        });
        expect(verifyPublic.mock.calls).toEqual([[signed[0]]]);
        expect(register).toHaveBeenCalledWith([signed[0]]);
        expect(unregister).toHaveBeenCalledWith(['video-player']);
    });
});

describe('listedModIds', () => {
    it('index.json の id を集める。id の無い項目は飛ばす', () => {
        expect(listedModIds([{ id: 'pen' }, { name: 'x' }, null, { id: 'danmaku' }])).toEqual(
            new Set(['pen', 'danmaku']),
        );
    });

    it('配列でなければ一覧として扱わない（すべて載せる）', () => {
        expect(listedModIds({ id: 'pen' })).toBeUndefined();
        expect(listedModIds(undefined)).toBeUndefined();
    });
});

describe('unregisterExternalMods', () => {
    it('消せた件数を返す。登録が無い（404）ものは黙って飛ばし、断られた・通信できないものは警告する', async () => {
        const { logger, entries } = recordingLogger();
        const bodies: unknown[] = [];
        const answers: Record<string, { status: number; body: Record<string, unknown> } | undefined> = {
            a: { status: 204, body: {} },
            b: { status: 404, body: {} },
            c: { status: 401, body: { error: 'Unauthorized' } },
        };
        const request: RegisterRequest = async (method, _path, body) => {
            expect(method).toBe('DELETE');
            bodies.push(body);
            const answer = answers[(body as { name: string }).name];
            if (!answer) throw new Error('offline');
            return answer;
        };
        const removed = await unregisterExternalMods(request, 'https://a.example/mods', ['a', 'b', 'c', 'd'], logger);
        expect(removed).toBe(1);
        expect(bodies[0]).toEqual({ kind: 'mod', url: 'https://a.example/mods', name: 'a' });
        expect(entries.filter((e) => e.level === 'warn').map((e) => e.message)).toEqual([
            expect.stringContaining('Unauthorized'),
            expect.stringContaining('通信できません'),
        ]);
    });
});
