import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type InitialEntity, signWorld, type WorldDefinition, type WorldSigningKey } from '@ubichill/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { nodeWorldCrypto } from './worldCrypto';

function newTestSigningKey(): WorldSigningKey {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return {
        publicKey: publicKey.export({ format: 'jwk' }).x as string,
        sign: async (message) => sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64url'),
    };
}

/**
 * worldRegistry + instanceManager の DB 統合テスト。
 *
 * DATABASE_URL がある時だけ走る（CI で PG が無い環境では skip）。ローカル実行例:
 *   cd packages/db && docker compose up -d
 *   DATABASE_URL=postgresql://ubichill:password@127.0.0.1:5433/ubichill pnpm --filter @ubichill/db migrate:dev
 *   DATABASE_URL=postgresql://ubichill:password@127.0.0.1:5433/ubichill pnpm test
 *
 * 検証すること:
 *   - リポジトリのワールド（worlds/）は静的ファイルの URL で、外部と同じ規則で検証される（DB 非依存）
 *   - 本体への保存は「定義・lock・署名」の組をそのまま保存する（中身を書き換えない）。作者 + metadata.name で同じワールド
 *   - 署名は外部と同じ規則で検証し、通らなければ何も保存しない。署名なしの保存は公開中の版を残して下書きになる
 *   - instance を worldRef(URL) で作成し getInstance が往復解決できる
 */

const RUN = !!process.env.DATABASE_URL;
const SYS = '00000000-0000-0000-0000-000000000000';

const worldDef = (name: string, displayName: string, initialEntities: InitialEntity[] = []): WorldDefinition => ({
    apiVersion: 'ubichill.com/v1alpha1',
    kind: 'World',
    metadata: { name, version: '1.0.0' },
    spec: { displayName, capacity: { default: 2, max: 4 }, initialEntities },
});
/** 送る組（YAML を往復した値＝ルートが受け取る値と同じ）。 */
const bundleOf = (def: WorldDefinition) => ({ definition: yaml.parse(yaml.stringify(def)) as unknown, lock: null });
const uniqueName = (label: string) => `it-${label}-${Date.now().toString(36)}`;

describe.skipIf(!RUN)('worldRegistry + instanceManager (DB統合)', () => {
    // 型のみ import（値の import は env 設定後に動的に行う）
    let worldRegistry: typeof import('./worldRegistry').worldRegistry;
    let instanceManager: typeof import('./instanceManager').instanceManager;

    beforeAll(async () => {
        // vitest は repo ルートから走るため、WORLDS_DIR をリポジトリの worlds/ に固定する。
        process.env.WORLDS_DIR = path.resolve(process.cwd(), 'worlds');
        // backend の config 検証（config/index.ts）が要求する最小 env を埋める。
        process.env.NODE_ENV ??= 'test';
        process.env.BETTER_AUTH_SECRET ??= 'test-secret';
        ({ worldRegistry } = await import('./worldRegistry'));
        ({ instanceManager } = await import('./instanceManager'));
        await worldRegistry.initialize();
    });

    it('リポジトリのワールドは静的ファイルの URL で配られ、外部と同じ規則で署名が確かめられる', async () => {
        const official = await worldRegistry.getWorld('default');
        expect(official?.source.kind).toBe('local');
        expect(official?.url).toMatch(/\/api\/v1\/repository\/worlds\/default\.yaml$/);
        // 署名そのものは有効。作者はほかの作者と同じく WebFinger で確かめる（リポジトリの記録で特別に信用しない）
        expect(official?.identity?.status).toBe('verified');
        expect(await worldRegistry.getWorldRecord('default')).toBeUndefined();
        expect(worldRegistry.repositoryFile('default.sig.json')?.contentType).toMatch(/json/);
        expect(worldRegistry.repositoryFile('../package.json')).toBeUndefined();
        expect(worldRegistry.repositoryFile('trusted-authors.json')).toBeUndefined();
    });

    it('getHostedDocument がリポジトリのワールドをファイルの生の値で返す', async () => {
        const hosted = await worldRegistry.getHostedDocument('default');
        const file = yaml.parse(readFileSync(path.resolve(process.cwd(), 'worlds/default.yaml'), 'utf-8')) as unknown;
        expect(hosted?.definition).toEqual(file);
    });

    it('組の保存: 中身を書き換えず、同じ metadata.name は同じワールド、署名は外部と同じ規則で検証する', async () => {
        const key = newTestSigningKey();
        const name = uniqueName('bundle');
        const first = await worldRegistry.saveBundle(SYS, bundleOf(worldDef(name, 'A')));
        if (!first.ok) throw new Error(first.message);
        try {
            expect(first.saved).toBe('unsigned');
            // metadata.name はそのまま（ホストの ID に書き換えない）。URL の ID はサーバーが決める
            expect((await worldRegistry.getHostedDocument(first.world.id))?.definition).toMatchObject({
                metadata: { name },
            });
            expect(first.world.id).not.toBe(name);
            expect((await worldRegistry.listWorlds('local')).some((w) => w.id === first.world.id)).toBe(false);

            const again = await worldRegistry.saveBundle(SYS, bundleOf(worldDef(name, 'B')));
            expect(again).toMatchObject({ ok: true, world: { id: first.world.id } });

            // 別の内容への署名を添えると何も保存しない
            const signedB = bundleOf(worldDef(name, 'B'));
            const sigForOther = await signWorld(bundleOf(worldDef(name, 'X')), key, nodeWorldCrypto);
            expect(await worldRegistry.saveBundle(SYS, { ...signedB, signature: sigForOther })).toMatchObject({
                ok: false,
                reason: 'content-mismatch',
            });
            expect(await worldRegistry.getWorldSignature(first.world.id)).toBeUndefined();

            const sig = await signWorld(signedB, key, nodeWorldCrypto);
            expect(await worldRegistry.saveBundle(SYS, { ...signedB, signature: sig })).toMatchObject({
                ok: true,
                saved: 'published',
            });
            expect(await worldRegistry.getWorldSignature(first.world.id)).toEqual(sig);
            expect((await worldRegistry.getWorld(first.world.id))?.identity?.status).toBe('verified');
            // 鍵だけの署名（作者アカウントなし）は公開ルールを満たさないので一覧に出ない（例外なし）
            expect((await worldRegistry.listWorlds('local')).some((w) => w.id === first.world.id)).toBe(false);
        } finally {
            await worldRegistry.deleteWorld(first.world.id);
        }
    });

    it('下書き: 公開中のワールドに署名なしで送ると公開中の版を残し、署名し直しでは消えず、公開で消える', async () => {
        const key = newTestSigningKey();
        const name = uniqueName('draft');
        const live = bundleOf(worldDef(name, '公開中'));
        const created = await worldRegistry.saveBundle(SYS, {
            ...live,
            signature: await signWorld(live, key, nodeWorldCrypto),
        });
        if (!created.ok) throw new Error(created.message);
        const id = created.world.id;
        try {
            const draft = bundleOf(worldDef(name, '編集中'));
            expect(await worldRegistry.saveBundle(SYS, draft)).toMatchObject({ ok: true, saved: 'draft' });
            expect((await worldRegistry.getWorld(id))?.displayName).toBe('公開中');
            expect((await worldRegistry.getWorld(id))?.identity?.status).toBe('verified');
            expect(await worldRegistry.getEditorDefinition(id)).toMatchObject({
                definition: { spec: { displayName: '編集中' } },
                hasDraft: true,
            });

            // 公開中の版に署名し直しても（鍵の取り消し後など）下書きは残る
            const resign = { ...live, signature: await signWorld(live, newTestSigningKey(), nodeWorldCrypto) };
            expect(await worldRegistry.saveBundle(SYS, resign)).toMatchObject({ ok: true, saved: 'published' });
            expect(await worldRegistry.getEditorDefinition(id)).toMatchObject({ hasDraft: true });

            const published = { ...draft, signature: await signWorld(draft, key, nodeWorldCrypto) };
            expect(await worldRegistry.saveBundle(SYS, published)).toMatchObject({ ok: true, saved: 'published' });
            expect(await worldRegistry.getEditorDefinition(id)).toMatchObject({
                definition: { spec: { displayName: '編集中' } },
                hasDraft: false,
            });
            expect((await worldRegistry.getWorld(id))?.displayName).toBe('編集中');
        } finally {
            await worldRegistry.deleteWorld(id);
        }
    });

    it('作者アカウント: 公開環境の鍵で author 付き署名すると作者が付き、別の環境を足しても保たれ、取り消すと外れる', async () => {
        const { publishingEnvironmentRepository, userRepository } = await import('@ubichill/db');
        const { selfAccount } = await import('./authorKeys');
        const userId = `it-author-${Date.now()}`;
        const handle = `it_${Date.now().toString(36)}`;
        await userRepository.create({ id: userId, name: 'テスト作者', email: `${userId}@example.com` });
        try {
            await userRepository.setHandleOnce(userId, handle);
            expect(await userRepository.setHandleOnce(userId, 'other_handle')).toBeUndefined(); // 変更不可
            const key = newTestSigningKey();
            const env = await publishingEnvironmentRepository.create({
                userId,
                kind: 'browser',
                name: 'テスト',
                publicKey: key.publicKey,
            });
            worldRegistry.invalidateResolvedWorlds();

            const author = selfAccount(handle);
            const bundle = bundleOf(worldDef('author-test', '作者テスト'));
            const saved = await worldRegistry.saveBundle(userId, {
                ...bundle,
                signature: await signWorld(bundle, key, nodeWorldCrypto, { author }),
            });
            if (!saved.ok) throw new Error(saved.message);
            const world = saved.world;
            // ワールドの識別は作者 + metadata.name（ホストの URL の ID ではない）
            expect(world.identity).toMatchObject({ author, worldId: `acct:${author}/author-test` });
            expect((await worldRegistry.listWorlds('local')).some((w) => w.id === world.id)).toBe(true);

            // 作者名は metadata ではなくアカウントの表示名。表示名を変えても署名はそのまま有効で、名前だけ変わる
            expect(world.authorName).toBe('テスト作者');
            await userRepository.setDisplayName(userId, 'テスト作者（改名）', `it-renamed-${Date.now()}`);
            worldRegistry.invalidateResolvedWorlds();
            const renamed = await worldRegistry.getWorld(world.id);
            expect(renamed?.authorName).toBe('テスト作者（改名）');
            expect(renamed?.identity).toMatchObject({ status: 'verified', author });

            // 別の公開環境を足しても、既存の環境の署名はそのまま有効
            await publishingEnvironmentRepository.create({
                userId,
                kind: 'cli',
                name: 'テスト CLI',
                publicKey: newTestSigningKey().publicKey,
            });
            worldRegistry.invalidateResolvedWorlds();
            expect((await worldRegistry.getWorld(world.id))?.identity).toMatchObject({ author });

            // 取り消すと、その鍵の署名は取り消し前のものでも作者が外れ、一覧から消える
            await publishingEnvironmentRepository.revoke(userId, env.id, 'lost');
            worldRegistry.invalidateResolvedWorlds();
            const after = (await worldRegistry.getWorld(world.id))?.identity;
            expect(after).toMatchObject({ status: 'verified', worldId: `ed25519:${key.publicKey}/author-test` });
            expect(after).not.toHaveProperty('author');
            expect((await worldRegistry.listWorlds('local')).some((w) => w.id === world.id)).toBe(false);
        } finally {
            await userRepository.deleteById(userId);
        }
    });

    it('mod を lock に固定していないワールドへの署名は保存を拒否し、何も保存しない', async () => {
        const name = uniqueName('unpinned');
        const bundle = bundleOf(
            worldDef(name, '固定なし', [
                {
                    id: 'p',
                    transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
                    components: [{ type: 'pen:pen', data: {} }],
                    tags: [],
                    children: [],
                },
            ]),
        );
        const signature = await signWorld(bundle, newTestSigningKey(), nodeWorldCrypto);
        expect(await worldRegistry.saveBundle(SYS, { ...bundle, signature })).toMatchObject({
            ok: false,
            reason: 'lock-incomplete',
        });
        expect((await worldRegistry.listWorlds('local')).some((w) => w.displayName === '固定なし')).toBe(false);
    });

    it('metadata.name が長すぎる組は保存しない', async () => {
        expect(await worldRegistry.saveBundle(SYS, bundleOf(worldDef('a'.repeat(51), '長い')))).toMatchObject({
            ok: false,
            reason: 'invalid-definition',
        });
    });

    it('instance を URL 参照で作成し往復解決できる', async () => {
        const created = await instanceManager.createInstance({ worldId: 'default' }, SYS);
        expect('error' in created).toBe(false);
        if ('error' in created) return;
        const got = await instanceManager.getInstance(created.id);
        expect(got?.world.id).toBe('default');
    });
});
