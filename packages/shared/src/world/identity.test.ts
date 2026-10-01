import { describe, expect, it } from 'vitest';
import type { WorldIdentity } from '../schemas/worldIdentity.schema';
import {
    AUTHOR_CHECK_STALE_MS,
    type AuthorKeyCheck,
    authorWorldIdOf,
    canonicalJson,
    isAuthorCheckStale,
    isPublishable,
    isStrictLockWorld,
    KEY_REGISTRATION_MAX_SKEW_MS,
    keyRegistrationMessage,
    signWorld,
    unpinnedModsOf,
    verifyKeyRegistration,
    verifyWorldSignature,
    type WorldCrypto,
    type WorldDocument,
    type WorldSigningKey,
    worldContentHash,
    worldIdOf,
    worldSignaturePayload,
} from './identity';

// shared は Node/DOM 非依存なので、判定ロジックは決定的な偽暗号で検証する。
// 本物の ed25519/sha256 を通した検証は backend の worldResolver.test.ts が担う。
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64URL = `${B64.slice(0, 62)}-_`;

const fnv = (text: string, seed: number): number =>
    Array.from(text).reduce((h, ch) => Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619) >>> 0, seed >>> 0);

const fakeDigest = (text: string, length: number, alphabet: string): string =>
    Array.from({ length }, (_, i) => alphabet[fnv(text, 2166136261 + i * 7919) % 64]).join('');

const fakeSignature = (publicKey: string, message: string): string =>
    fakeDigest(`${publicKey}\0${message}`, 86, B64URL);

const fakeCrypto: WorldCrypto = {
    sha256Base64: async (text) => `${fakeDigest(text, 43, B64)}=`,
    verifyEd25519: async (publicKey, message, signature) => signature === fakeSignature(publicKey, message),
};

const keySeq = { n: 0 };
function newKey(): WorldSigningKey {
    keySeq.n += 1;
    const publicKey = fakeDigest(`key-${keySeq.n}`, 43, B64URL);
    return { publicKey, sign: async (message) => fakeSignature(publicKey, message) };
}

const INTEGRITY = `sha256-${'A'.repeat(43)}=`;
const lockEntry = (id: string) => ({ id, version: '1.0.0', manifestIntegrity: INTEGRITY, components: {} });

const baseDoc = (): WorldDocument => ({
    definition: {
        apiVersion: 'ubichill.com/v1alpha1',
        kind: 'World',
        metadata: { name: 'my-world', version: '1.0.0', author: { name: 'alice' } },
        spec: {
            displayName: 'ワールド',
            capacity: { default: 2, max: 4 },
            initialEntities: [{ id: 'p', transform: { x: 1.5, y: -0 }, components: [{ type: 'pen:pen', data: {} }] }],
        },
    },
    lock: { lockVersion: 1, mods: { pen: lockEntry('pen') } },
});

describe('canonicalJson', () => {
    it('キー順に依存しない', () => {
        expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
        expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    });

    it('キーは UTF-16 コード単位順（localeCompare ではない）', () => {
        expect(canonicalJson({ b: 1, B: 2, あ: 3, a: 4 })).toBe('{"B":2,"a":4,"b":1,"あ":3}');
    });

    it('JSON.stringify と同じく object の undefined は落とし、配列の undefined は null', () => {
        expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
    });

    it('-0 は 0 に正規化される', () => {
        expect(canonicalJson(-0)).toBe('0');
    });

    it('非有限数・非プレーン object・bigint は曖昧なので throw', () => {
        expect(() => canonicalJson(Number.NaN)).toThrow();
        expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow();
        expect(() => canonicalJson({ at: new Date(0) })).toThrow();
        expect(() => canonicalJson(new Map())).toThrow();
        expect(() => canonicalJson(1n)).toThrow();
        expect(() => canonicalJson(undefined)).toThrow();
    });

    it('文字列のエスケープが JSON 互換', () => {
        expect(canonicalJson('a"\n\\')).toBe(JSON.stringify('a"\n\\'));
    });
});

describe('worldContentHash', () => {
    it('lock 未指定と null は同じ', async () => {
        const { definition } = baseDoc();
        expect(await worldContentHash({ definition }, fakeCrypto)).toBe(
            await worldContentHash({ definition, lock: null }, fakeCrypto),
        );
    });

    it('シリアライズして読み戻しても一致する（配信経路の再シリアライズに耐える）', async () => {
        const doc = baseDoc();
        const roundTripped = JSON.parse(JSON.stringify(doc)) as WorldDocument;
        expect(await worldContentHash(roundTripped, fakeCrypto)).toBe(await worldContentHash(doc, fakeCrypto));
    });

    it('lock だけの変更でも変わる', async () => {
        const doc = baseDoc();
        const changed = { ...doc, lock: { lockVersion: 1, mods: { pen: { ...lockEntry('pen'), version: '2.0.0' } } } };
        expect(await worldContentHash(changed, fakeCrypto)).not.toBe(await worldContentHash(doc, fakeCrypto));
    });
});

describe('signWorld / verifyWorldSignature', () => {
    it('署名したものは verified になり worldId は 公開鍵 + name', async () => {
        const key = newKey();
        const doc = baseDoc();
        const sig = await signWorld(doc, key, fakeCrypto);
        const verdict = await verifyWorldSignature(doc, sig, fakeCrypto);
        expect(verdict).toEqual({
            status: 'verified',
            worldId: worldIdOf(key.publicKey, 'my-world'),
            publicKey: key.publicKey,
            contentHash: sig.contentHash,
        });
    });

    it('URL が変わっても（＝同じデータを別経路で受け取っても）同じ worldId', async () => {
        const key = newKey();
        const doc = baseDoc();
        const sig = await signWorld(doc, key, fakeCrypto);
        const mirrored = JSON.parse(JSON.stringify(doc)) as WorldDocument;
        const a = await verifyWorldSignature(doc, sig, fakeCrypto);
        const b = await verifyWorldSignature(mirrored, JSON.parse(JSON.stringify(sig)), fakeCrypto);
        expect(b).toEqual(a);
    });

    it('署名が無ければ unsigned（contentHash は付く）', async () => {
        const doc = baseDoc();
        expect(await verifyWorldSignature(doc, undefined, fakeCrypto)).toEqual({
            status: 'unsigned',
            contentHash: await worldContentHash(doc, fakeCrypto),
        });
    });

    it('definition を 1 文字でも改竄すると content-mismatch', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        const tampered = JSON.parse(JSON.stringify(doc)) as { definition: { spec: { displayName: string } } };
        tampered.definition.spec.displayName = 'ワールト';
        expect(await verifyWorldSignature(tampered, sig, fakeCrypto)).toEqual({
            status: 'invalid',
            reason: 'content-mismatch',
        });
    });

    it('lock を差し替え・削除すると content-mismatch（配信元乗っ取りで lock ごと偽装できない）', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        expect(await verifyWorldSignature({ definition: doc.definition }, sig, fakeCrypto)).toMatchObject({
            reason: 'content-mismatch',
        });
        const swapped = {
            definition: doc.definition,
            lock: { lockVersion: 1, mods: { pen: { ...lockEntry('pen'), version: '6.6.6' } } },
        };
        expect(await verifyWorldSignature(swapped, sig, fakeCrypto)).toMatchObject({ reason: 'content-mismatch' });
    });

    it('攻撃者が改竄後に contentHash だけ書き換えても bad-signature', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        const tampered = { definition: doc.definition, lock: null };
        const forged = { ...sig, contentHash: await worldContentHash(tampered, fakeCrypto) };
        expect(await verifyWorldSignature(tampered, forged, fakeCrypto)).toEqual({
            status: 'invalid',
            reason: 'bad-signature',
        });
    });

    it('他人の公開鍵に差し替える（作者のなりすまし）と bad-signature', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        const impersonated = { ...sig, publicKey: newKey().publicKey };
        expect(await verifyWorldSignature(doc, impersonated, fakeCrypto)).toMatchObject({ reason: 'bad-signature' });
    });

    it('攻撃者が自分の鍵で署名し直すと verified だが worldId が別物になる', async () => {
        const doc = baseDoc();
        const original = await verifyWorldSignature(doc, await signWorld(doc, newKey(), fakeCrypto), fakeCrypto);
        const resigned = await verifyWorldSignature(doc, await signWorld(doc, newKey(), fakeCrypto), fakeCrypto);
        expect(resigned.status).toBe('verified');
        expect(original.status === 'verified' && resigned.status === 'verified' && resigned.worldId).not.toBe(
            original.status === 'verified' && original.worldId,
        );
    });

    it('別ワールドの署名を流用すると name-mismatch', async () => {
        const doc = baseDoc();
        const other = JSON.parse(JSON.stringify(doc)) as { definition: { metadata: { name: string } } };
        other.definition.metadata.name = 'other-world';
        const sigForOther = await signWorld(other, newKey(), fakeCrypto);
        expect(await verifyWorldSignature(doc, sigForOther, fakeCrypto)).toMatchObject({ reason: 'name-mismatch' });
    });

    it('署名ファイルの形式が不正なら malformed（未署名への格下げはしない）', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        for (const bad of [{}, 'x', { ...sig, alg: 'rsa' }, { ...sig, version: 2 }, { ...sig, signature: 'AAAA' }]) {
            expect(await verifyWorldSignature(doc, bad, fakeCrypto)).toEqual({
                status: 'invalid',
                reason: 'malformed',
            });
        }
    });

    it('crypto 実装が throw しても bad-signature に倒す', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        const throwing: WorldCrypto = {
            ...fakeCrypto,
            verifyEd25519: () => Promise.reject(new Error('boom')),
        };
        expect(await verifyWorldSignature(doc, sig, throwing)).toMatchObject({ reason: 'bad-signature' });
    });

    it('metadata.name の無いワールドには署名できない', async () => {
        await expect(signWorld({ definition: { metadata: {} } }, newKey(), fakeCrypto)).rejects.toThrow();
    });
});

describe('作者アカウント（author）', () => {
    const AUTHOR = 'hanako@ubichill.com';
    const resolverFor =
        (keys: Record<string, string | undefined>): AuthorKeyCheck =>
        async (author, publicKey) =>
            keys[author] === publicKey ? { status: 'confirmed' } : { status: 'unconfirmed' };

    it('作者アカウントの鍵と署名鍵が一致すれば author が付き、worldId はアカウント基準', async () => {
        const key = newKey();
        const doc = baseDoc();
        const sig = await signWorld(doc, key, fakeCrypto, { author: AUTHOR });
        const verdict = await verifyWorldSignature(doc, sig, fakeCrypto, resolverFor({ [AUTHOR]: key.publicKey }));
        expect(verdict).toMatchObject({
            status: 'verified',
            author: AUTHOR,
            worldId: authorWorldIdOf(AUTHOR, 'my-world'),
        });
    });

    it('他人のアカウントを名乗っても（鍵が違えば）author は付かず、鍵で識別される', async () => {
        const attacker = newKey();
        const doc = baseDoc();
        const sig = await signWorld(doc, attacker, fakeCrypto, { author: AUTHOR });
        const verdict = await verifyWorldSignature(doc, sig, fakeCrypto, resolverFor({ [AUTHOR]: newKey().publicKey }));
        expect(verdict).toEqual({
            status: 'verified',
            worldId: worldIdOf(attacker.publicKey, 'my-world'),
            publicKey: attacker.publicKey,
            contentHash: sig.contentHash,
        });
    });

    it('resolver が無い・引けない・失敗する場合も author を付けない（主張だけを信用しない）', async () => {
        const key = newKey();
        const doc = baseDoc();
        const sig = await signWorld(doc, key, fakeCrypto, { author: AUTHOR });
        for (const resolver of [undefined, resolverFor({})]) {
            const verdict = await verifyWorldSignature(doc, sig, fakeCrypto, resolver);
            expect(verdict).toMatchObject({ status: 'verified', worldId: worldIdOf(key.publicKey, 'my-world') });
            expect(verdict).not.toHaveProperty('author');
        }
    });

    it('他サーバーの作者は、最後に鍵一覧を確認できた時刻を載せる（古ければ「確認が古い」と表示するため）', async () => {
        const key = newKey();
        const doc = baseDoc();
        const sig = await signWorld(doc, key, fakeCrypto, { author: AUTHOR });
        const checkedAt = '2026-09-01T00:00:00.000Z';
        const verdict = await verifyWorldSignature(doc, sig, fakeCrypto, async () => ({
            status: 'confirmed',
            checkedAt,
        }));
        expect(verdict).toMatchObject({ author: AUTHOR, authorCheckedAt: checkedAt });
        expect(isAuthorCheckStale(verdict as WorldIdentity, Date.parse(checkedAt) + AUTHOR_CHECK_STALE_MS + 1)).toBe(
            true,
        );
        expect(isAuthorCheckStale(verdict as WorldIdentity, Date.parse(checkedAt) + 1000)).toBe(false);
    });

    it('いまは確認できない（pending）・判定器の失敗では作者を付けず、すぐ確認し直す印を付ける', async () => {
        const key = newKey();
        const doc = baseDoc();
        const sig = await signWorld(doc, key, fakeCrypto, { author: AUTHOR });
        for (const check of [
            async () => ({ status: 'pending' }) as const,
            (() => Promise.reject(new Error('down'))) as AuthorKeyCheck,
        ]) {
            const verdict = await verifyWorldSignature(doc, sig, fakeCrypto, check);
            expect(verdict).toMatchObject({ status: 'verified', authorPending: true });
            expect(verdict).not.toHaveProperty('author');
        }
        const unconfirmed = await verifyWorldSignature(doc, sig, fakeCrypto, resolverFor({}));
        expect(unconfirmed).not.toHaveProperty('authorPending');
    });

    it('確認の古さは、作者が付いていて確認時刻があるときだけ判定する（自サーバー・未署名は古くならない）', () => {
        expect(isAuthorCheckStale(undefined, Date.now())).toBe(false);
        expect(
            isAuthorCheckStale(
                {
                    status: 'verified',
                    worldId: 'x',
                    publicKey: 'A'.repeat(43),
                    contentHash: 'sha256-x',
                    author: AUTHOR,
                },
                Date.now(),
            ),
        ).toBe(false);
    });

    it('author を書き換える・消すと bad-signature（署名対象に含まれる）', async () => {
        const key = newKey();
        const doc = baseDoc();
        const sig = await signWorld(doc, key, fakeCrypto, { author: AUTHOR });
        expect(await verifyWorldSignature(doc, { ...sig, author: 'evil@ubichill.com' }, fakeCrypto)).toMatchObject({
            reason: 'bad-signature',
        });
        const { author: _removed, ...withoutAuthor } = sig;
        expect(await verifyWorldSignature(doc, withoutAuthor, fakeCrypto)).toMatchObject({ reason: 'bad-signature' });
    });

    it('author の無い署名は従来と同じ署名対象（既存の署名がそのまま有効）', () => {
        const fields = { version: 1 as const, alg: 'ed25519' as const, publicKey: 'k', name: 'n', contentHash: 'h' };
        expect(worldSignaturePayload(fields)).toBe(
            '{"alg":"ed25519","contentHash":"h","name":"n","publicKey":"k","version":1}',
        );
    });

    it('形式が不正な author は malformed', async () => {
        const doc = baseDoc();
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        expect(await verifyWorldSignature(doc, { ...sig, author: 'not an account' }, fakeCrypto)).toMatchObject({
            reason: 'malformed',
        });
    });
});

describe('verifyKeyRegistration（鍵の所有証明）', () => {
    const NOW = Date.parse('2026-09-26T12:00:00Z');
    const claimFor = (key: WorldSigningKey, at = new Date(NOW).toISOString()) => ({
        userId: 'user-1',
        publicKey: key.publicKey,
        at,
    });

    it('その鍵で自分の userId 入りの文に署名していれば通る', async () => {
        const key = newKey();
        const claim = claimFor(key);
        expect(
            await verifyKeyRegistration(claim, await key.sign(keyRegistrationMessage(claim)), NOW, fakeCrypto),
        ).toEqual({
            ok: true,
        });
    });

    it('他人の公開鍵を登録しようとしても（秘密鍵が無ければ）拒否', async () => {
        const victim = newKey();
        const attacker = newKey();
        const claim = claimFor(victim);
        expect(
            await verifyKeyRegistration(claim, await attacker.sign(keyRegistrationMessage(claim)), NOW, fakeCrypto),
        ).toEqual({ ok: false, reason: 'bad-signature' });
    });

    it('別アカウント向けの証明を流用できない', async () => {
        const key = newKey();
        const claim = claimFor(key);
        const signature = await key.sign(keyRegistrationMessage(claim));
        expect(await verifyKeyRegistration({ ...claim, userId: 'user-2' }, signature, NOW, fakeCrypto)).toMatchObject({
            reason: 'bad-signature',
        });
    });

    it('古い・未来すぎる証明は拒否', async () => {
        const key = newKey();
        for (const offset of [-(KEY_REGISTRATION_MAX_SKEW_MS + 1), KEY_REGISTRATION_MAX_SKEW_MS + 1]) {
            const claim = claimFor(key, new Date(NOW + offset).toISOString());
            expect(
                await verifyKeyRegistration(claim, await key.sign(keyRegistrationMessage(claim)), NOW, fakeCrypto),
            ).toEqual({ ok: false, reason: 'expired' });
        }
    });

    it('公開鍵・日時の形式が不正なら malformed', async () => {
        const key = newKey();
        expect(await verifyKeyRegistration({ ...claimFor(key), publicKey: 'x' }, 'sig', NOW, fakeCrypto)).toMatchObject(
            {
                reason: 'malformed',
            },
        );
        expect(
            await verifyKeyRegistration({ ...claimFor(key), at: 'yesterday' }, 'sig', NOW, fakeCrypto),
        ).toMatchObject({
            reason: 'malformed',
        });
    });
});

describe('mod 固定の徹底（lock-incomplete）', () => {
    const withSpec = (patch: Record<string, unknown>, lock: unknown): WorldDocument => {
        const doc = baseDoc();
        const def = doc.definition as { spec: Record<string, unknown> };
        return { definition: { ...def, spec: { ...def.spec, ...patch } }, lock };
    };

    it('使う mod が lock に無いワールドの署名は無効（署名自体が正しくても）', async () => {
        const doc = withSpec({}, { lockVersion: 1, mods: {} });
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        expect(await verifyWorldSignature(doc, sig, fakeCrypto)).toEqual({
            status: 'invalid',
            reason: 'lock-incomplete',
        });
    });

    it('lock が無いワールドの署名も無効', async () => {
        const doc = withSpec({}, null);
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        expect(await verifyWorldSignature(doc, sig, fakeCrypto)).toMatchObject({ reason: 'lock-incomplete' });
    });

    it('dependencies だけに書いた mod（実行中に生成され得る）も固定が必要', async () => {
        const doc = withSpec(
            { dependencies: [{ name: 'danmaku', source: { version: 'latest' } }] },
            { lockVersion: 1, mods: { pen: lockEntry('pen') } },
        );
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        expect(await verifyWorldSignature(doc, sig, fakeCrypto)).toMatchObject({ reason: 'lock-incomplete' });
        expect(unpinnedModsOf(doc)).toEqual(['danmaku']);
    });

    it('埋め込み spec.lock でも固定済みなら有効', async () => {
        const doc = withSpec({ lock: { lockVersion: 1, mods: { pen: lockEntry('pen') } } }, null);
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        expect(await verifyWorldSignature(doc, sig, fakeCrypto)).toMatchObject({ status: 'verified' });
    });

    it('定義を解釈できない（固定を確認できない）なら無効', async () => {
        const doc: WorldDocument = { definition: { metadata: { name: 'my-world' } }, lock: null };
        const sig = await signWorld(doc, newKey(), fakeCrypto);
        expect(await verifyWorldSignature(doc, sig, fakeCrypto)).toMatchObject({ reason: 'lock-incomplete' });
    });

    it('未署名ワールドは lock の有無に関係なく unsigned（公開されないだけ）', async () => {
        expect(await verifyWorldSignature(withSpec({}, null), undefined, fakeCrypto)).toMatchObject({
            status: 'unsigned',
        });
    });
});

describe('isStrictLockWorld（mod を厳格に固定するか）', () => {
    const verified = {
        status: 'verified' as const,
        worldId: 'w',
        publicKey: 'A'.repeat(43),
        contentHash: `sha256-${'A'.repeat(43)}=`,
    };
    const unsigned = { status: 'unsigned' as const, contentHash: `sha256-${'A'.repeat(43)}=` };

    it('作者署名ありは配信場所に関係なく厳格（本体の local でも）', () => {
        for (const kind of ['local', 'registry', 'github', 'url', 'remote-instance']) {
            expect(isStrictLockWorld(kind, verified)).toBe(true);
        }
    });

    it('未署名は provenance で決まる（外部は厳格、本体・レジストリは寛容）', () => {
        expect(isStrictLockWorld('local', unsigned)).toBe(false);
        expect(isStrictLockWorld('registry', undefined)).toBe(false);
        expect(isStrictLockWorld('github', unsigned)).toBe(true);
        expect(isStrictLockWorld('unknown-kind', undefined)).toBe(true);
    });
});

describe('isPublishable（公開してよいか）', () => {
    const base = {
        status: 'verified' as const,
        worldId: 'w',
        publicKey: 'A'.repeat(43),
        contentHash: `sha256-${'A'.repeat(43)}=`,
    };

    it('作者アカウントまで確認できた署名だけ公開する', () => {
        expect(isPublishable({ ...base, author: 'hanako@ubichill.com' })).toBe(true);
    });

    it('鍵だけの署名（作者不明）・未署名・識別不明は公開しない（例外なし）', () => {
        expect(isPublishable(base)).toBe(false);
        expect(isPublishable({ status: 'unsigned', contentHash: base.contentHash })).toBe(false);
        expect(isPublishable(undefined)).toBe(false);
    });
});
