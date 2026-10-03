import { generateSigningKeyPkcs8, importSigningKey, webWorldCrypto } from '@ubichill/loader';
import { verifyWorldSignature, type WorldSigningKey } from '@ubichill/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { saveWorldBundle } from './saveHostedWorld';
import { signHostedWorld } from './signHostedWorld';

/**
 * backend の PUT /api/v1/worlds・GET /:id.yaml・/:id.lock.json を模した偽サーバー（本物と同じ規則）。
 * - metadata.name で同じワールドかを決め、中身は書き換えない
 * - 署名があれば送られた値そのものに対して検証し、通らなければ 422
 * - 署名なしで公開中のワールドに送ると、公開中の版は残して下書きにする
 */
function fakeServer() {
    const db = new Map<
        string,
        { id: string; definition: unknown; lock: unknown; signature: unknown; draft?: unknown }
    >();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/v1/worlds') && init?.method === 'PUT') {
            const body = JSON.parse(String(init.body)) as { yaml: string; lock: unknown; signature?: unknown };
            const definition = yaml.parse(body.yaml) as { metadata: { name: string } };
            const existing = db.get(definition.metadata.name);
            const id = existing?.id ?? `srv${db.size}`;
            if (body.signature !== undefined) {
                const v = await verifyWorldSignature({ definition, lock: body.lock }, body.signature, webWorldCrypto);
                if (v.status !== 'verified') return Response.json({ error: 'bad' }, { status: 422 });
                db.set(definition.metadata.name, { id, definition, lock: body.lock, signature: body.signature });
                return Response.json({ id, saved: 'published', identity: v });
            }
            if (existing?.signature) {
                db.set(definition.metadata.name, { ...existing, draft: definition });
                return Response.json({ id, saved: 'draft' });
            }
            db.set(definition.metadata.name, { id, definition, lock: body.lock, signature: null });
            return Response.json({ id, saved: 'unsigned' });
        }
        const row = [...db.values()].find((r) => url.includes(`/worlds/${r.id}.`));
        if (!row) return Response.json({ error: 'World not found' }, { status: 404 });
        if (url.endsWith('.yaml')) return new Response(yaml.stringify(row.definition));
        if (url.endsWith('.lock.json')) return row.lock ? Response.json(row.lock) : new Response('{}', { status: 404 });
        return new Response('{}', { status: 404 });
    }) as typeof fetch;
    return { db, deps: { apiBase: '', fetch: fetchImpl } };
}

const worldYaml = (displayName: string, name = 'my-world') =>
    yaml.stringify({
        apiVersion: 'ubichill.com/v1alpha1',
        kind: 'World',
        metadata: { name, version: '1.0.0' },
        spec: { displayName, capacity: { default: 2, max: 4 }, initialEntities: [] },
    });
const LOCK = { lockVersion: 1 as const, mods: {} };
const displayNameOf = (definition: unknown): string | undefined =>
    (definition as { spec?: { displayName?: string } } | undefined)?.spec?.displayName;

describe('saveWorldBundle', () => {
    const ref: { key?: WorldSigningKey } = {};
    beforeEach(async () => {
        ref.key = await importSigningKey(await generateSigningKeyPkcs8());
    });
    const signer = () => ({ key: ref.key as WorldSigningKey });

    it('手元の値そのものに署名し、サーバーの検証を通る（サーバーが値を書き換えないので prepare は要らない）', async () => {
        const server = fakeServer();
        const saved = await saveWorldBundle({ yaml: worldYaml('A'), lock: LOCK }, signer(), server.deps);
        expect(saved).toMatchObject({ id: 'srv0', saved: 'published', identity: { status: 'verified' } });
    });

    it('同じ metadata.name なら同じワールドの更新になり、違う名前は別のワールドになる', async () => {
        const server = fakeServer();
        const first = await saveWorldBundle({ yaml: worldYaml('A'), lock: LOCK }, signer(), server.deps);
        const again = await saveWorldBundle({ yaml: worldYaml('B'), lock: LOCK }, signer(), server.deps);
        const other = await saveWorldBundle({ yaml: worldYaml('C', 'other'), lock: LOCK }, signer(), server.deps);
        expect(again.id).toBe(first.id);
        expect(other.id).not.toBe(first.id);
        expect(displayNameOf(server.db.get('my-world')?.definition)).toBe('B');
    });

    it('公開中のワールドに署名なしで送ると下書きになり、公開中の版は変わらない', async () => {
        const server = fakeServer();
        await saveWorldBundle({ yaml: worldYaml('A'), lock: LOCK }, signer(), server.deps);
        const draft = await saveWorldBundle({ yaml: worldYaml('B'), lock: LOCK }, null, server.deps);
        expect(draft.saved).toBe('draft');
        expect(displayNameOf(server.db.get('my-world')?.definition)).toBe('A');
        expect(displayNameOf(server.db.get('my-world')?.draft)).toBe('B');
    });

    it('別の鍵を名乗る署名はサーバーが拒否し、throw する（黙って未署名にしない）', async () => {
        const server = fakeServer();
        const liar: WorldSigningKey = { ...(ref.key as WorldSigningKey), publicKey: 'A'.repeat(43) };
        await expect(saveWorldBundle({ yaml: worldYaml('A'), lock: LOCK }, { key: liar }, server.deps)).rejects.toThrow(
            'bad',
        );
        expect(server.db.size).toBe(0);
    });

    it('lock が null のワールドも lock=null として署名する', async () => {
        const server = fakeServer();
        await expect(
            saveWorldBundle({ yaml: worldYaml('A'), lock: null }, signer(), server.deps),
        ).resolves.toMatchObject({ saved: 'published' });
    });

    it('ブラウザの fetch を this なしで呼ぶ（deps.fetch() の形だと Illegal invocation になる）', async () => {
        const server = fakeServer();
        const strictFetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
            if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
            return server.deps.fetch(input, init);
        } as typeof fetch;
        await expect(
            saveWorldBundle({ yaml: worldYaml('A'), lock: LOCK }, null, { apiBase: '', fetch: strictFetch }),
        ).resolves.toMatchObject({ saved: 'unsigned' });
    });
});

describe('signHostedWorld', () => {
    const ref: { key?: WorldSigningKey } = {};
    beforeEach(async () => {
        ref.key = await importSigningKey(await generateSigningKeyPkcs8());
    });

    it('公開中の版を取り出してそのまま署名し直す（内容は変えない）', async () => {
        const server = fakeServer();
        const created = await saveWorldBundle({ yaml: worldYaml('A'), lock: LOCK }, null, server.deps);
        const identity = await signHostedWorld(created.id, { key: ref.key as WorldSigningKey }, server.deps);
        expect(identity).toMatchObject({ status: 'verified', publicKey: ref.key?.publicKey });
        expect(displayNameOf(server.db.get('my-world')?.definition)).toBe('A');
    });

    it('ワールドを取得できなければ何も送らない', async () => {
        const server = fakeServer();
        await expect(signHostedWorld('missing', { key: ref.key as WorldSigningKey }, server.deps)).rejects.toThrow(
            /World not found/,
        );
        expect(server.db.size).toBe(0);
    });
});
