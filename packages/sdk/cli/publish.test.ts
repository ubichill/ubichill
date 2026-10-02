import type { WorldSigningKey } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { type PublishDeps, publish, publishRecordPathFor } from './publish.ts';

const key: WorldSigningKey = { publicKey: 'K'.repeat(43), sign: async () => 'S'.repeat(86) };
const crypto = { sha256Base64: async () => 'h'.repeat(43) + '=', verifyEd25519: async () => true };
const credential = {
    server: 'https://ubichill.com',
    account: 'youkan@ubichill.com',
    token: 'ubi_t',
    key: 'PKCS8',
    environmentId: 'env-1',
};
const worldYaml = `apiVersion: ubichill.com/v1alpha1
kind: World
metadata:
  name: my-world
  version: 1.0.0
spec:
  displayName: テスト
  capacity: { default: 2, max: 4 }
  initialEntities: []
`;

function fakeDeps(files: Record<string, string>, handler: (method: string, path: string, body: unknown) => { status: number; body: Record<string, unknown> }) {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const deps: PublishDeps = {
        fs: {
            readText: (p) => files[p],
            writeText: (p, t) => {
                files[p] = t;
            },
            mkdir: () => undefined,
        },
        request: async (method, path, body) => {
            requests.push({ method, path, body });
            return handler(method, path, body);
        },
        key,
        crypto,
        parseYaml: (t) => yaml.parse(t) as unknown,
        log: () => undefined,
    };
    return { deps, requests, files };
}

const prepared = (id: string) => ({
    status: 200,
    body: { definition: { ...(yaml.parse(worldYaml) as object), metadata: { name: id, version: '1.0.0' } }, lock: null },
});

describe('publish（本体へ）', () => {
    it('初回は作成して対応を記録し、サーバーが保存する値に作者付きで署名して内容と一緒に送る', async () => {
        const { deps, requests, files } = fakeDeps({ 'w.yaml': worldYaml }, (method, path) => {
            if (method === 'POST' && path === '/api/v1/worlds/yaml') return { status: 201, body: { id: 'srv-id' } };
            if (path.endsWith('/prepare')) return prepared('srv-id');
            return { status: 200, body: {} };
        });
        const url = await publish(deps, { worldPath: 'w.yaml', credential });
        expect(url).toBe('https://ubichill.com/world/srv-id');
        expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
            'POST /api/v1/worlds/yaml',
            'POST /api/v1/worlds/srv-id/prepare',
            'PUT /api/v1/worlds/srv-id/yaml',
        ]);
        const signature = (requests[2]?.body as { signature: { author: string; name: string } }).signature;
        expect(signature).toMatchObject({ author: 'youkan@ubichill.com', name: 'srv-id' });
        expect(JSON.parse(files[publishRecordPathFor('w.yaml')] ?? '{}')).toEqual({
            servers: { 'https://ubichill.com': { worldId: 'srv-id' } },
        });
    });

    it('記録があれば同じワールドを更新し、作り直さない', async () => {
        const record = JSON.stringify({ servers: { 'https://ubichill.com': { worldId: 'known' } } });
        const { deps, requests } = fakeDeps({ 'w.yaml': worldYaml, 'w.ubichill.json': record }, (_m, path) =>
            path.endsWith('/prepare') ? prepared('known') : { status: 200, body: {} },
        );
        await publish(deps, { worldPath: 'w.yaml', credential });
        expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
            'POST /api/v1/worlds/known/prepare',
            'PUT /api/v1/worlds/known/yaml',
        ]);
    });

    it('記録したワールドが消されていたら作り直して記録を更新する', async () => {
        const record = JSON.stringify({ servers: { 'https://ubichill.com': { worldId: 'gone' } } });
        const { deps, files } = fakeDeps({ 'w.yaml': worldYaml, 'w.ubichill.json': record }, (method, path) => {
            if (path === '/api/v1/worlds/gone/prepare') return { status: 404, body: { error: 'World not found' } };
            if (method === 'POST' && path === '/api/v1/worlds/yaml') return { status: 201, body: { id: 'new-id' } };
            if (path.endsWith('/prepare')) return prepared('new-id');
            return { status: 200, body: {} };
        });
        expect(await publish(deps, { worldPath: 'w.yaml', credential })).toBe('https://ubichill.com/world/new-id');
        expect(files['w.ubichill.json']).toContain('new-id');
    });

    it('lock に固定されていない mod があれば、サーバーに送る前に止める', async () => {
        const withMod = worldYaml.replace(
            'initialEntities: []',
            [
                'initialEntities:',
                '    - id: tray',
                '      transform: { x: 0, y: 0, z: 0, w: 10, h: 10, scale: 1, rotation: 0 }',
                '      components:',
                '        - type: pen:tray',
                '          data: {}',
            ].join('\n'),
        );
        const { deps, requests } = fakeDeps({ 'w.yaml': withMod }, () => ({ status: 200, body: {} }));
        await expect(publish(deps, { worldPath: 'w.yaml', credential })).rejects.toThrow(/固定されていない/);
        expect(requests).toEqual([]);
    });

    it('サーバーが断ったら、その理由で失敗する（取り消し済みの鍵など）', async () => {
        const { deps } = fakeDeps({ 'w.yaml': worldYaml, 'w.ubichill.json': JSON.stringify({ servers: { 'https://ubichill.com': { worldId: 'k' } } }) }, (_m, path) =>
            path.endsWith('/prepare') ? prepared('k') : { status: 422, body: { error: 'この署名の鍵はあなたの有効な公開環境ではありません' } },
        );
        await expect(publish(deps, { worldPath: 'w.yaml', credential })).rejects.toThrow('この署名の鍵はあなたの有効な公開環境ではありません');
    });
});

describe('publish（外部ホスト向け --out）', () => {
    it('world.yaml と署名を書き出し、署名にはログインしたアカウントの作者を載せる（サーバーには送らない）', async () => {
        const { deps, requests, files } = fakeDeps({ 'worlds/w.yaml': worldYaml }, () => ({ status: 500, body: {} }));
        await publish(deps, { worldPath: 'worlds/w.yaml', credential, outDir: 'dist' });
        expect(requests).toEqual([]);
        expect(files['dist/w.yaml']).toBe(worldYaml);
        expect(JSON.parse(files['dist/w.sig.json'] ?? '{}')).toMatchObject({ author: 'youkan@ubichill.com', name: 'my-world' });
    });
});
