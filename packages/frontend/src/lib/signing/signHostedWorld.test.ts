import { generateSigningKeyPkcs8, importSigningKey, webWorldCrypto } from '@ubichill/loader';
import { verifyWorldSignature, type WorldSigningKey } from '@ubichill/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { signHostedWorld } from './signHostedWorld';

/** backend の /worlds/:id（YAML）・/lock・PUT /sig を模した偽サーバー。PUT は本物と同じく検証してから受け付ける。 */
function fakeServer(stored: { definition: unknown; lock: unknown }) {
    const state = { saved: undefined as unknown, putCount: 0 };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('?format=yaml')) return new Response(yaml.stringify(stored.definition));
        if (url.endsWith('/lock')) {
            return stored.lock === null ? new Response('{}', { status: 404 }) : Response.json(stored.lock);
        }
        if (url.endsWith('/sig') && init?.method === 'PUT') {
            state.putCount += 1;
            const verdict = await verifyWorldSignature(stored, JSON.parse(String(init.body)), webWorldCrypto);
            if (verdict.status !== 'verified') return Response.json({ error: verdict.status }, { status: 422 });
            state.saved = JSON.parse(String(init.body));
            return Response.json({ identity: verdict });
        }
        return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return { state, fetch: fetchImpl };
}

const serverDefinition = {
    apiVersion: 'ubichill.com/v1alpha1',
    kind: 'World',
    // サーバーが採番した name（手元の編集内容とは異なる）
    metadata: { name: 'x7k2server', version: '1.0.0', author: { name: 'alice' } },
    spec: { displayName: '保存後', capacity: { default: 10, max: 20 }, initialEntities: [] },
};

describe('signHostedWorld', () => {
    const keyRef: { key?: WorldSigningKey } = {};
    beforeEach(async () => {
        keyRef.key = await importSigningKey(await generateSigningKeyPkcs8());
    });

    it('サーバーの配信物に署名し、サーバー側の検証を通る', async () => {
        const server = fakeServer({ definition: serverDefinition, lock: { lockVersion: 1, mods: {} } });
        const identity = await signHostedWorld('w', keyRef.key as WorldSigningKey, {
            apiBase: '',
            fetch: server.fetch,
        });
        expect(identity).toMatchObject({ status: 'verified', publicKey: keyRef.key?.publicKey });
        expect(server.state.saved).toMatchObject({ name: 'x7k2server' });
    });

    it('lock が無い（404）ワールドは lock=null として署名する', async () => {
        const server = fakeServer({ definition: serverDefinition, lock: null });
        await expect(
            signHostedWorld('w', keyRef.key as WorldSigningKey, { apiBase: '', fetch: server.fetch }),
        ).resolves.toMatchObject({ status: 'verified' });
    });

    it('サーバーが拒否したら throw する（黙って未署名にしない）', async () => {
        const server = fakeServer({ definition: serverDefinition, lock: null });
        const liar: WorldSigningKey = { ...(keyRef.key as WorldSigningKey), publicKey: 'A'.repeat(43) };
        await expect(signHostedWorld('w', liar, { apiBase: '', fetch: server.fetch })).rejects.toThrow(/署名を保存/);
    });

    it('ワールドを取得できなければ署名を送らない', async () => {
        const server = fakeServer({ definition: serverDefinition, lock: null });
        const failing = (async (input: RequestInfo | URL, init?: RequestInit) =>
            String(input).endsWith('?format=yaml')
                ? Response.json({ error: 'World not found' }, { status: 404 })
                : server.fetch(input, init)) as typeof fetch;
        await expect(
            signHostedWorld('w', keyRef.key as WorldSigningKey, { apiBase: '', fetch: failing }),
        ).rejects.toThrow(/World not found/);
        expect(server.state.putCount).toBe(0);
    });
});
