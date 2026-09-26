import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { signWorld, type WorldDefinition, type WorldDocument, type WorldSigningKey } from '@ubichill/shared';
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
 *   - official ワールド（バンドル worlds/）は DB 非在のまま listWorlds に出る（URL ネイティブ／DB 非依存）
 *   - getHostedDocument が official をファイルの生の値で返す（URL 配信の実体＝作者署名の対象）
 *   - 作者署名は現在の内容に対して有効なものだけ保存・配信され、内容更新で外れる
 *   - instance を worldRef(URL) で作成し getInstance が往復解決できる
 */

const RUN = !!process.env.DATABASE_URL;
const SYS = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!RUN)('worldRegistry + instanceManager (DB統合)', () => {
    // 型のみ import（値の import は env 設定後に動的に行う）
    let worldRegistry: typeof import('./worldRegistry').worldRegistry;
    let prepareWorldUpdate: typeof import('./worldRegistry').prepareWorldUpdate;
    let instanceManager: typeof import('./instanceManager').instanceManager;

    beforeAll(async () => {
        // vitest は repo ルートから走るため、WORLDS_DIR をリポジトリの worlds/ に固定する。
        process.env.WORLDS_DIR = path.resolve(process.cwd(), 'worlds');
        // backend の config 検証（config/index.ts）が要求する最小 env を埋める。
        process.env.NODE_ENV ??= 'test';
        process.env.BETTER_AUTH_SECRET ??= 'test-secret';
        ({ worldRegistry, prepareWorldUpdate } = await import('./worldRegistry'));
        ({ instanceManager } = await import('./instanceManager'));
        await worldRegistry.initialize();
    });

    it('official は DB 非在だが listWorlds に出る', async () => {
        const list = await worldRegistry.listWorlds();
        const official = list.find((w) => w.id === 'default');
        expect(official).toBeTruthy();
        expect(official?.source.kind).toBe('local');
        // official はメモリ索引のみ（DB レコードは無い）
        expect(await worldRegistry.getWorldRecord('default')).toBeUndefined();
    });

    it('getHostedDocument が official をファイルの生の値で返す', async () => {
        const hosted = await worldRegistry.getHostedDocument('default');
        // スキーマ既定値を補った値ではなく、ファイルそのもの（作者署名の対象）であること
        const file = yaml.parse(readFileSync(path.resolve(process.cwd(), 'worlds/default.yaml'), 'utf-8')) as unknown;
        expect(hosted?.definition).toEqual(file);
    });

    it('作者署名: 有効なものだけ保存・配信し、内容更新で外れる', async () => {
        const key = newTestSigningKey();
        const world = await worldRegistry.createFromInput(SYS, 'sys', {
            displayName: '署名テスト',
            capacity: { default: 2, max: 4 },
            initialEntities: [],
        });
        try {
            const hosted = await worldRegistry.getHostedDocument(world.id);
            if (!hosted) throw new Error('hosted が無い');
            // 配信経路（YAML 往復）を通した値に署名する＝ブラウザの署名フローと同じ
            const served = { definition: yaml.parse(yaml.stringify(hosted.definition)) as unknown, lock: hosted.lock };
            const sig = await signWorld(served, key, nodeWorldCrypto);

            const forged = { ...sig, contentHash: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
            expect(await worldRegistry.setWorldSignature(world.id, forged)).toMatchObject({ ok: false });
            expect(await worldRegistry.getWorldSignature(world.id)).toBeUndefined();

            expect(await worldRegistry.setWorldSignature(world.id, sig)).toMatchObject({ ok: true });
            expect(await worldRegistry.getWorldSignature(world.id)).toEqual(sig);
            expect((await worldRegistry.getWorld(world.id))?.identity?.status).toBe('verified');
            expect((await worldRegistry.listWorlds('local')).some((w) => w.id === world.id)).toBe(true);

            const def = hosted.definition as WorldDefinition;
            const changed = { ...def, spec: { ...def.spec, displayName: '変更後' } };

            // 署名済みワールドを黙って未署名にする更新は拒否され、内容も変わらない
            expect(await worldRegistry.updateWorld(world.id, changed)).toMatchObject({
                ok: false,
                reason: 'signature-required',
            });
            expect((await worldRegistry.getWorld(world.id))?.displayName).toBe('署名テスト');

            // 新しい内容への署名を添えると内容と署名が一緒に保存される
            const prepared = prepareWorldUpdate(world.id, changed, null);
            const nextSig = await signWorld(
                JSON.parse(JSON.stringify(prepared)) as unknown as WorldDocument,
                key,
                nodeWorldCrypto,
            );
            expect(await worldRegistry.updateWorld(world.id, changed, null, { signature: nextSig })).toMatchObject({
                ok: true,
            });
            expect((await worldRegistry.getWorld(world.id))?.identity?.status).toBe('verified');

            // 古い署名（前の内容向け）を添えた更新は何も保存しない
            const again = { ...changed, spec: { ...changed.spec, displayName: '再変更' } };
            expect(await worldRegistry.updateWorld(world.id, again, null, { signature: nextSig })).toMatchObject({
                ok: false,
                reason: 'content-mismatch',
            });

            // 未署名化を明示すれば保存でき、一覧から消える
            expect(await worldRegistry.updateWorld(world.id, again, null, { allowUnsigned: true })).toMatchObject({
                ok: true,
            });
            expect(await worldRegistry.getWorldSignature(world.id)).toBeUndefined();
            expect((await worldRegistry.getWorld(world.id))?.identity?.status).toBe('unsigned');
            expect((await worldRegistry.listWorlds('local')).some((w) => w.id === world.id)).toBe(false);
        } finally {
            await worldRegistry.deleteWorld(world.id);
        }
    });

    it('instance を URL 参照で作成し往復解決できる', async () => {
        const created = await instanceManager.createInstance({ worldId: 'default' }, SYS);
        expect('error' in created).toBe(false);
        if ('error' in created) return;
        const got = await instanceManager.getInstance(created.id);
        expect(got?.world.id).toBe('default');
    });
});
