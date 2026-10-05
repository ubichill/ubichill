import type { WorldSigningKey } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { confirmEnvironment, type PublishDeps, publish } from './publish.ts';

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

describe('publish（本体へ）', () => {
    it('手元の組（yaml・lock・作者付きの署名）をそのまま 1 回の PUT で送る（手元に対応を記録しない）', async () => {
        const { deps, requests, files } = fakeDeps({ 'w.yaml': worldYaml }, () => ({ status: 200, body: { id: 'srv-id', url: 'https://ubichill.com/api/v1/authors/youkan/worlds/my-world.yaml' } }));
        const url = await publish(deps, { worldPath: 'w.yaml', credential });
        // 共有 URL は /@ID/metadata.name
        expect(url).toBe('https://ubichill.com/@youkan/my-world');
        expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(['PUT /api/v1/worlds']);
        const body = requests[0]?.body as { yaml: string; lock: unknown; signature: { author: string; name: string } };
        expect(body.yaml).toBe(worldYaml);
        expect(body.lock).toBeNull();
        expect(body.signature).toMatchObject({ author: 'youkan@ubichill.com', name: 'my-world' });
        expect(Object.keys(files)).toEqual(['w.yaml']);
    });

    it('本体へ送る署名と外部ホスト向けに書き出す署名は同じ（どこに置いても同じ規則で確かめられる）', async () => {
        const server = fakeDeps({ 'w.yaml': worldYaml }, () => ({ status: 200, body: { id: 'srv-id', url: 'https://ubichill.com/api/v1/authors/youkan/worlds/my-world.yaml' } }));
        await publish(server.deps, { worldPath: 'w.yaml', credential });
        const out = fakeDeps({ 'w.yaml': worldYaml }, () => ({ status: 500, body: {} }));
        await publish(out.deps, { worldPath: 'w.yaml', credential, outDir: 'dist' });
        expect((server.requests[0]?.body as { signature: unknown }).signature).toEqual(
            JSON.parse(out.files['dist/w.sig.json'] ?? '{}'),
        );
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
        const { deps } = fakeDeps({ 'w.yaml': worldYaml }, () => ({
            status: 422,
            body: { error: 'この署名の鍵はあなたの有効な公開環境ではありません' },
        }));
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

describe('confirmEnvironment（--out の前にサーバーで確かめる）', () => {
    const run = (res: { status: number; body: Record<string, unknown> } | Error) =>
        confirmEnvironment(
            { request: async () => (res instanceof Error ? Promise.reject(res) : res) },
            { account: 'youkan@ubichill.com', server: 'https://ubichill.com' },
        );

    it('アカウントが一致すれば確認できた（サーバーに最終利用が残る）', async () => {
        await expect(run({ status: 200, body: { author: 'youkan@ubichill.com' } })).resolves.toBe('confirmed');
    });

    it('公開環境が取り消されている（401）なら止める', async () => {
        await expect(run({ status: 401, body: { code: 'invalid-token' } })).rejects.toThrow(/取り消されている/);
    });

    it('サーバーのアカウントが認証情報と違えば止める', async () => {
        await expect(run({ status: 200, body: { author: 'other@ubichill.com' } })).rejects.toThrow(/一致しません/);
    });

    it('サーバーに届かない・止まっているときは unreachable（呼び出し側は警告して続ける）', async () => {
        await expect(run(new Error('ECONNREFUSED'))).resolves.toBe('unreachable');
        await expect(run({ status: 503, body: {} })).resolves.toBe('unreachable');
    });
});
