import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

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
 *   - getWorldDefinition が official 定義を返す（URL 配信の実体）
 *   - instance を worldRef(URL) で作成し getInstance が往復解決できる
 */

const RUN = !!process.env.DATABASE_URL;
const SYS = '00000000-0000-0000-0000-000000000000';

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

    it('official は DB 非在だが listWorlds に出る', async () => {
        const list = await worldRegistry.listWorlds();
        const official = list.find((w) => w.id === 'default');
        expect(official).toBeTruthy();
        expect(official?.source.kind).toBe('local');
        // official はメモリ索引のみ（DB レコードは無い）
        expect(await worldRegistry.getWorldRecord('default')).toBeUndefined();
    });

    it('getWorldDefinition が official 定義を返す', async () => {
        const def = await worldRegistry.getWorldDefinition('default');
        expect(def?.spec.displayName).toBeTruthy();
    });

    it('instance を URL 参照で作成し往復解決できる', async () => {
        const created = await instanceManager.createInstance({ worldId: 'default' }, SYS);
        expect('error' in created).toBe(false);
        if ('error' in created) return;
        const got = await instanceManager.getInstance(created.id);
        expect(got?.world.id).toBe('default');
    });
});
