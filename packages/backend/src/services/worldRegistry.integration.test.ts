import { generateKeyPairSync, sign } from 'node:crypto';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type InitialEntity, signWorld, type WorldDefinition, type WorldSigningKey } from '@ubichill/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 *   - リポジトリのワールド（worlds/）は作者がこのサーバーのアカウントのものだけ、DB と同じ形（<id>.yaml と兄弟）で配る
 *   - 本体への保存は「定義・lock・署名」の組をそのまま保存する（中身を書き換えない）。作者 + metadata.name で同じワールド
 *   - 署名は外部と同じ規則で検証し、通らなければ何も保存しない。署名なしの保存は公開中の版を残して下書きになる
 *   - instance を worldRef(URL) で作成し getInstance が往復解決できる
 */

const RUN = !!process.env.DATABASE_URL;
const SYS = '00000000-0000-0000-0000-000000000000';
/** 保存に使う作者（保存には ID が要る）。 */
const AUTHOR = `it-author-main-${Date.now()}`;
const HANDLE = `it_m${Date.now().toString(36)}`;

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

    // 一時的な worlds/。公式ワールド（作者はほかのサーバーの ubichill@ubichill.com）の写しを置く
    const worldsDir = mkdtempSync(path.join(tmpdir(), 'ubichill-worlds-'));

    beforeAll(async () => {
        // vitest は repo ルートから走る
        for (const file of ['default.yaml', 'default.lock.json', 'default.sig.json']) {
            copyFileSync(path.resolve(process.cwd(), 'worlds', file), path.join(worldsDir, file));
        }
        process.env.WORLDS_DIR = worldsDir;
        // backend の config 検証（config/index.ts）が要求する最小 env を埋める。
        process.env.NODE_ENV ??= 'test';
        process.env.BETTER_AUTH_SECRET ??= 'test-secret';
        ({ worldRegistry } = await import('./worldRegistry'));
        ({ instanceManager } = await import('./instanceManager'));
        await worldRegistry.initialize();
        const { userRepository } = await import('@ubichill/db');
        await userRepository.create({ id: AUTHOR, name: '保存テスト', email: `${AUTHOR}@example.com` });
        await userRepository.setHandleOnce(AUTHOR, HANDLE);
    });

    afterAll(async () => {
        const { userRepository } = await import('@ubichill/db');
        await userRepository.deleteById(AUTHOR);
    });

    it('リポジトリのワールドは作者がこのサーバーのアカウントのものだけ、DB と同じ形で配る（ほかのサーバーの作者の写しは配らない）', async () => {
        const { publishingEnvironmentRepository, userRepository } = await import('@ubichill/db');
        const { selfAccount } = await import('./authorKeys');
        const userId = `it-repo-${Date.now()}`;
        const handle = `it_r${Date.now().toString(36)}`;
        await userRepository.create({ id: userId, name: 'リポジトリ作者', email: `${userId}@example.com` });
        try {
            await userRepository.setHandleOnce(userId, handle);
            const key = newTestSigningKey();
            await publishingEnvironmentRepository.create({
                userId,
                kind: 'ci',
                name: 'テスト',
                publicKey: key.publicKey,
            });
            const name = uniqueName('repo');
            const bundle = { ...bundleOf(worldDef(name, 'リポジトリ')), lock: { lockVersion: 1, mods: {} } };
            writeFileSync(path.join(worldsDir, `${name}.yaml`), yaml.stringify(bundle.definition));
            writeFileSync(path.join(worldsDir, `${name}.lock.json`), JSON.stringify(bundle.lock));
            const sig = await signWorld(bundle, key, nodeWorldCrypto, { author: selfAccount(handle) });
            writeFileSync(path.join(worldsDir, `${name}.sig.json`), JSON.stringify(sig));
            await worldRegistry.reloadWorlds();

            const own = await worldRegistry.getWorld(name);
            expect(own?.url).toMatch(new RegExp(`/api/v1/authors/${handle}/worlds/${name}\\.yaml$`));
            // 共有 URL・作者と名前の参照からもたどれる
            const base = own?.url.replace(/\/api\/v1\/.*$/, '') ?? '';
            expect((await worldRegistry.resolveRefDetailed(`${base}/@${handle}/${name}`)).ok).toBe(true);
            expect((await worldRegistry.resolveRefDetailed(`@${handle}/${name}`)).ok).toBe(true);
            expect(own?.identity).toMatchObject({ status: 'verified', author: selfAccount(handle) });
            expect((await worldRegistry.listWorlds('local')).some((w) => w.id === name)).toBe(true);
            expect(await worldRegistry.worldFile(handle, `${name}.sig.json`)).toMatchObject({
                path: expect.stringMatching(/\.sig\.json$/),
            });

            // 公式ワールドの写し（作者は ubichill@ubichill.com）は配らない。作者のサーバーを連合でフォローして参照する
            expect(await worldRegistry.getWorld('default')).toBeUndefined();
            expect(await worldRegistry.worldFile('ubichill', 'default.yaml')).toBeUndefined();
            expect(await worldRegistry.worldFile(handle, '../package.json')).toBeUndefined();

            // 鍵を取り消すと作者が外れ、配らなくなる（DB のワールドと同じく取り消しが効く）
            const [env] = await publishingEnvironmentRepository.listByUser(userId);
            if (env) await publishingEnvironmentRepository.revoke(userId, env.id, 'compromised');
            worldRegistry.invalidateResolvedWorlds();
            expect(await worldRegistry.getWorld(name)).toBeUndefined();
        } finally {
            await userRepository.deleteById(userId);
        }
    });

    it('組の保存: 中身を書き換えず、同じ metadata.name は同じワールド、署名は外部と同じ規則で検証する', async () => {
        const key = newTestSigningKey();
        const name = uniqueName('bundle');
        const first = await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(name, 'A')));
        if (!first.ok) throw new Error(first.message);
        try {
            expect(first.saved).toBe('unsigned');
            // metadata.name はそのまま（ホストの ID に書き換えない）。URL の ID はサーバーが決める
            const yamlFile = await worldRegistry.worldFile(HANDLE, `${name}.yaml`);
            expect(yamlFile && 'body' in yamlFile ? yaml.parse(yamlFile.body) : undefined).toMatchObject({
                metadata: { name },
            });
            expect(first.world.id).not.toBe(name);
            expect((await worldRegistry.listWorlds('local')).some((w) => w.id === first.world.id)).toBe(false);

            const again = await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(name, 'B')));
            expect(again).toMatchObject({ ok: true, world: { id: first.world.id } });

            // 別の内容への署名を添えると何も保存しない
            const signedB = bundleOf(worldDef(name, 'B'));
            const sigForOther = await signWorld(bundleOf(worldDef(name, 'X')), key, nodeWorldCrypto);
            expect(await worldRegistry.saveBundle(AUTHOR, { ...signedB, signature: sigForOther })).toMatchObject({
                ok: false,
                reason: 'content-mismatch',
            });
            expect(await worldRegistry.worldFile(HANDLE, `${name}.sig.json`)).toBeUndefined();

            const sig = await signWorld(signedB, key, nodeWorldCrypto);
            expect(await worldRegistry.saveBundle(AUTHOR, { ...signedB, signature: sig })).toMatchObject({
                ok: true,
                saved: 'published',
            });
            // DB のワールドもリポジトリと同じ形のファイルで配る（公開中の版）
            expect(first.world.url).toMatch(new RegExp(`/api/v1/authors/${HANDLE}/worlds/${name}\\.yaml$`));
            const sigFile = await worldRegistry.worldFile(HANDLE, `${name}.sig.json`);
            expect(sigFile && 'body' in sigFile ? JSON.parse(sigFile.body) : undefined).toEqual(sig);
            expect(await worldRegistry.worldFile(HANDLE, `${name}.lock.json`)).toBeUndefined();
            expect((await worldRegistry.getWorld(first.world.id))?.identity?.status).toBe('verified');
            // 鍵だけの署名（作者アカウントなし）は公開ルールを満たさないので一覧に出ない（例外なし）
            expect((await worldRegistry.listWorlds('local')).some((w) => w.id === first.world.id)).toBe(false);
        } finally {
            await worldRegistry.deleteWorld(first.world.id);
        }
    });

    it('保存は作者の YAML をそのまま残し、読むときに既定値を補う（省いた項目で画面が落ちない）', async () => {
        const name = uniqueName('raw');
        const raw = {
            apiVersion: 'ubichill.com/v1alpha1',
            kind: 'World',
            metadata: { name, version: '1.0.0' },
            spec: { displayName: '最小' },
        };
        const saved = await worldRegistry.saveBundle(AUTHOR, { definition: raw, lock: null });
        if (!saved.ok) throw new Error(saved.message);
        try {
            const yamlFile = await worldRegistry.worldFile(HANDLE, `${name}.yaml`);
            expect(yamlFile && 'body' in yamlFile ? yaml.parse(yamlFile.body) : undefined).toEqual(raw);
            const editor = await worldRegistry.getEditorDefinition(saved.world.id);
            expect(editor?.definition.spec.capacity).toEqual(expect.objectContaining({ default: expect.any(Number) }));
            expect(editor?.definition.spec.initialEntities).toEqual([]);
            expect(saved.world.capacity.default).toEqual(expect.any(Number));
        } finally {
            await worldRegistry.deleteWorld(saved.world.id);
        }
    });

    it('編集中と違う自分のワールドと metadata.name がぶつかったら上書きせず name-taken', async () => {
        const a = await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(uniqueName('a'), 'A')));
        const b = await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(uniqueName('b'), 'B')));
        if (!a.ok || !b.ok) throw new Error('作成できない');
        try {
            const aName = (await worldRegistry.getEditorDefinition(a.world.id))?.definition.metadata.name ?? '';
            // B を編集していて、名前を A と同じにした
            expect(
                await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(aName, 'B の中身')), {
                    editingId: b.world.id,
                }),
            ).toMatchObject({ ok: false, reason: 'name-taken' });
            expect((await worldRegistry.getWorld(a.world.id))?.displayName).toBe('A');
            // 編集中のワールド自身なら更新できる
            expect(
                await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(aName, 'A2')), { editingId: a.world.id }),
            ).toMatchObject({ ok: true, world: { id: a.world.id } });
        } finally {
            await worldRegistry.deleteWorld(a.world.id);
            await worldRegistry.deleteWorld(b.world.id);
        }
    });

    it('名前の変更は移動: 同じワールドのまま URL が変わり、以前の URL からもたどれる。以前の名前で新しく作れば新しい方が優先', async () => {
        const before = uniqueName('old');
        const after = uniqueName('new');
        const created = await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(before, '名前を変える')));
        if (!created.ok) throw new Error(created.message);
        const oldUrl = created.world.url;
        try {
            const renamed = await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(after, '名前を変える')), {
                editingId: created.world.id,
            });
            expect(renamed).toMatchObject({ ok: true, world: { id: created.world.id } });
            if (!renamed.ok) return;
            expect(renamed.world.url).toMatch(new RegExp(`/worlds/${after}\\.yaml$`));
            // 以前の URL（お気に入り・インスタンス・共有したリンク）からも同じワールドに着く
            expect(await worldRegistry.resolveRefDetailed(oldUrl)).toMatchObject({
                ok: true,
                world: { id: created.world.id, url: renamed.world.url },
            });
            expect(await worldRegistry.worldFile(HANDLE, `${before}.yaml`)).toBeDefined();

            // 以前の名前で新しいワールドを作ると、以前の URL は新しいワールドを指す
            const reused = await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(before, '新しい')));
            if (!reused.ok) throw new Error(reused.message);
            try {
                expect(await worldRegistry.resolveRefDetailed(oldUrl)).toMatchObject({
                    world: { id: reused.world.id },
                });
            } finally {
                await worldRegistry.deleteWorld(reused.world.id);
            }
        } finally {
            await worldRegistry.deleteWorld(created.world.id);
        }
    });

    it('公開中のワールドの下書きで名前を変えても、公開するまで URL は変わらない', async () => {
        const before = uniqueName('live');
        const key = newTestSigningKey();
        const live = bundleOf(worldDef(before, '公開中'));
        const created = await worldRegistry.saveBundle(AUTHOR, {
            ...live,
            signature: await signWorld(live, key, nodeWorldCrypto),
        });
        if (!created.ok) throw new Error(created.message);
        try {
            const draft = await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(uniqueName('draft'), '下書き')), {
                editingId: created.world.id,
            });
            expect(draft).toMatchObject({ ok: true, saved: 'draft', world: { url: created.world.url } });
        } finally {
            await worldRegistry.deleteWorld(created.world.id);
        }
    });

    it('ID の無いアカウントは保存できない（公開の URL が作れない）', async () => {
        const { userRepository } = await import('@ubichill/db');
        const userId = `it-nohandle-${Date.now()}`;
        await userRepository.create({ id: userId, name: 'ID なし', email: `${userId}@example.com` });
        try {
            expect(await worldRegistry.saveBundle(userId, bundleOf(worldDef(uniqueName('nh'), 'x')))).toMatchObject({
                ok: false,
                reason: 'handle-required',
            });
        } finally {
            await userRepository.deleteById(userId);
        }
    });

    it('同じ名前の初回保存が同時に来ても 500 にせず、同じワールドになる', async () => {
        const name = uniqueName('race');
        const results = await Promise.all([
            worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(name, '1'))),
            worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(name, '2'))),
        ]);
        const ids = results.map((r) => (r.ok ? r.world.id : r.reason));
        try {
            expect(results.every((r) => r.ok)).toBe(true);
            expect(ids[0]).toBe(ids[1]);
        } finally {
            if (results[0]?.ok) await worldRegistry.deleteWorld(results[0].world.id);
        }
    });

    it('署名が内容と一致しない DB のワールドは配信せず、「見つからない」ではなく理由を返す', async () => {
        const { worldRepository } = await import('@ubichill/db');
        const name = uniqueName('broken');
        const bundle = bundleOf(worldDef(name, '元'));
        const saved = await worldRegistry.saveBundle(AUTHOR, {
            ...bundle,
            signature: await signWorld(bundle, newTestSigningKey(), nodeWorldCrypto),
        });
        if (!saved.ok) throw new Error(saved.message);
        try {
            const record = await worldRepository.findByName(saved.world.id);
            if (!record) throw new Error('レコードが無い');
            // DB を直接書き換えた（署名の後で中身が変わった）
            await worldRepository.update(record.id, { definition: bundleOf(worldDef(name, '改竄')).definition });
            worldRegistry.invalidateResolvedWorlds();
            expect(await worldRegistry.resolveLocal(saved.world.id)).toMatchObject({ ok: false, reason: 'integrity' });
            expect(await worldRegistry.resolveRefDetailed(saved.world.url)).toMatchObject({
                ok: false,
                reason: 'integrity',
            });
            expect(await worldRegistry.resolveLocal('no-such-world-id')).toMatchObject({ reason: 'not-found' });
        } finally {
            await worldRegistry.deleteWorld(saved.world.id);
        }
    });

    it('下書き: 公開中のワールドに署名なしで送ると公開中の版を残し、署名し直しでは消えず、公開で消える', async () => {
        const key = newTestSigningKey();
        const name = uniqueName('draft');
        const live = bundleOf(worldDef(name, '公開中'));
        const created = await worldRegistry.saveBundle(AUTHOR, {
            ...live,
            signature: await signWorld(live, key, nodeWorldCrypto),
        });
        if (!created.ok) throw new Error(created.message);
        const id = created.world.id;
        try {
            const draft = bundleOf(worldDef(name, '編集中'));
            expect(await worldRegistry.saveBundle(AUTHOR, draft)).toMatchObject({ ok: true, saved: 'draft' });
            expect((await worldRegistry.getWorld(id))?.displayName).toBe('公開中');
            expect((await worldRegistry.getWorld(id))?.identity?.status).toBe('verified');
            expect(await worldRegistry.getEditorDefinition(id)).toMatchObject({
                definition: { spec: { displayName: '編集中' } },
                hasDraft: true,
            });

            // 公開中の版に署名し直しても（鍵の取り消し後など）下書きは残る
            const resign = { ...live, signature: await signWorld(live, newTestSigningKey(), nodeWorldCrypto) };
            expect(await worldRegistry.saveBundle(AUTHOR, resign)).toMatchObject({ ok: true, saved: 'published' });
            expect(await worldRegistry.getEditorDefinition(id)).toMatchObject({ hasDraft: true });

            const published = { ...draft, signature: await signWorld(draft, key, nodeWorldCrypto) };
            expect(await worldRegistry.saveBundle(AUTHOR, published)).toMatchObject({ ok: true, saved: 'published' });
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
        expect(await worldRegistry.saveBundle(AUTHOR, { ...bundle, signature })).toMatchObject({
            ok: false,
            reason: 'lock-incomplete',
        });
        expect((await worldRegistry.listWorlds('local')).some((w) => w.displayName === '固定なし')).toBe(false);
    });

    it('metadata.name が長すぎる組は保存しない', async () => {
        expect(await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef('a'.repeat(51), '長い')))).toMatchObject({
            ok: false,
            reason: 'invalid-definition',
        });
    });

    it('instance を URL 参照で作成し往復解決できる', async () => {
        const saved = await worldRegistry.saveBundle(AUTHOR, bundleOf(worldDef(uniqueName('inst'), 'インスタンス')));
        if (!saved.ok) throw new Error(saved.message);
        try {
            // 共有 URL（/@handle/name）からも作れる
            const shareUrl = saved.world.url.replace(/\/api\/v1\/authors\/([^/]+)\/worlds\/([^/]+)\.yaml$/, '/@$1/$2');
            const created = await instanceManager.createInstance({ worldId: shareUrl }, SYS);
            expect('error' in created).toBe(false);
            if ('error' in created) return;
            const got = await instanceManager.getInstance(created.id);
            expect(got?.world.id).toBe(saved.world.id);
        } finally {
            await worldRegistry.deleteWorld(saved.world.id);
        }
    });
});
