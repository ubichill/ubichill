import { generateSigningKeyPkcs8, importSigningKey, webWorldCrypto } from '@ubichill/loader';
import { verifyWorldSignature, type WorldSigningKey } from '@ubichill/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { createHostedWorld, updateHostedWorld } from './saveHostedWorld';

/**
 * backend の prepare / PUT yaml / POST yaml / sig を模した偽サーバー。
 * 保存時に metadata.name をサーバー側 ID に書き換える（手元の値と配信値が異なる状況を再現）。
 * 署名済みワールドへの未署名更新は allowUnsigned が無ければ 409 にする（本物と同じ規則）。
 */
function fakeServer() {
    const db = new Map<string, { definition: unknown; lock: unknown; signature: unknown }>();
    const normalize = (id: string, text: string) => {
        const def = yaml.parse(text) as { metadata: Record<string, unknown> };
        return { ...def, metadata: { ...def.metadata, name: id } };
    };
    const isSigned = async (id: string) => {
        const row = db.get(id);
        return !!row && (await verifyWorldSignature(row, row.signature, webWorldCrypto)).status === 'verified';
    };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        const id = /worlds\/([^/?]+)/.exec(url)?.[1] ?? '';
        if (url.endsWith('/api/v1/worlds/yaml') && init?.method === 'POST') {
            const newId = `srv${db.size}`;
            db.set(newId, {
                definition: normalize(newId, String(body.yaml)),
                lock: body.lock ?? null,
                signature: null,
            });
            return Response.json({ id: newId });
        }
        if (url.endsWith('/prepare'))
            return Response.json({ definition: normalize(id, String(body.yaml)), lock: body.lock });
        if (url.endsWith('/yaml') && init?.method === 'PUT') {
            const next = { definition: normalize(id, String(body.yaml)), lock: body.lock ?? null };
            if (body.signature !== undefined) {
                const v = await verifyWorldSignature(next, body.signature, webWorldCrypto);
                if (v.status !== 'verified') return Response.json({ error: 'bad' }, { status: 422 });
            } else if (body.allowUnsigned !== true && (await isSigned(id))) {
                return Response.json({ error: 'signature-required' }, { status: 409 });
            }
            db.set(id, { ...next, signature: body.signature ?? null });
            return Response.json({});
        }
        if (url.includes('?format=yaml')) return new Response(yaml.stringify(db.get(id)?.definition));
        if (url.endsWith('/lock')) {
            const lock = db.get(id)?.lock;
            return lock ? Response.json(lock) : new Response('{}', { status: 404 });
        }
        if (url.endsWith('/sig') && init?.method === 'PUT') {
            const row = db.get(id);
            if (!row) return new Response('{}', { status: 404 });
            const v = await verifyWorldSignature(row, body, webWorldCrypto);
            if (v.status !== 'verified') return Response.json({ error: 'bad' }, { status: 422 });
            db.set(id, { ...row, signature: body });
            return Response.json({ identity: v });
        }
        return new Response('{}', { status: 404 });
    }) as typeof fetch;
    return { db, isSigned, deps: { apiBase: '', fetch: fetchImpl } };
}

const worldYaml = (displayName: string) =>
    yaml.stringify({
        apiVersion: 'ubichill.com/v1alpha1',
        kind: 'World',
        metadata: { name: 'local-name', version: '1.0.0' },
        spec: { displayName, capacity: { default: 2, max: 4 }, initialEntities: [] },
    });
const LOCK = { lockVersion: 1 as const, mods: {} };
const signerOf = (key: WorldSigningKey | undefined) => (key ? { key } : null);
const displayNameOf = (definition: unknown): string | undefined =>
    (definition as { spec?: { displayName?: string } } | undefined)?.spec?.displayName;

describe('createHostedWorld / updateHostedWorld', () => {
    const ref: { key?: WorldSigningKey } = {};
    beforeEach(async () => {
        ref.key = await importSigningKey(await generateSigningKeyPkcs8());
    });

    it('作成してすぐ署名され公開可能になる（name はサーバー採番でも一致）', async () => {
        const server = fakeServer();
        const { id, signError } = await createHostedWorld(
            { yaml: worldYaml('A'), lock: LOCK },
            signerOf(ref.key),
            server.deps,
        );
        expect(signError).toBeUndefined();
        expect(await server.isSigned(id)).toBe(true);
    });

    it('更新は内容と署名を一度に送り、署名済みのまま', async () => {
        const server = fakeServer();
        const { id } = await createHostedWorld({ yaml: worldYaml('A'), lock: LOCK }, signerOf(ref.key), server.deps);
        await updateHostedWorld(id, { yaml: worldYaml('B'), lock: LOCK }, signerOf(ref.key), server.deps);
        expect(await server.isSigned(id)).toBe(true);
        expect(displayNameOf(server.db.get(id)?.definition)).toBe('B');
    });

    it('鍵なしの更新は未署名を明示して送る（署名済みでも 409 にならない＝呼び出し側で確認済み前提）', async () => {
        const server = fakeServer();
        const { id } = await createHostedWorld({ yaml: worldYaml('A'), lock: LOCK }, signerOf(ref.key), server.deps);
        await updateHostedWorld(id, { yaml: worldYaml('B'), lock: LOCK }, null, server.deps);
        expect(await server.isSigned(id)).toBe(false);
    });

    it('署名が通らなければ内容も保存されない（黙って未署名にならない）', async () => {
        const server = fakeServer();
        const { id } = await createHostedWorld({ yaml: worldYaml('A'), lock: LOCK }, signerOf(ref.key), server.deps);
        const broken: WorldSigningKey = {
            publicKey: (ref.key as WorldSigningKey).publicKey,
            sign: async () => 'A'.repeat(86),
        };
        await expect(
            updateHostedWorld(id, { yaml: worldYaml('B'), lock: LOCK }, { key: broken }, server.deps),
        ).rejects.toThrow();
        expect(await server.isSigned(id)).toBe(true);
        expect(displayNameOf(server.db.get(id)?.definition)).toBe('A');
    });

    it('作成後の署名に失敗しても未署名＝非公開のまま残り、失敗を返す', async () => {
        const server = fakeServer();
        const broken: WorldSigningKey = {
            publicKey: (ref.key as WorldSigningKey).publicKey,
            sign: async () => 'A'.repeat(86),
        };
        const { id, signError } = await createHostedWorld(
            { yaml: worldYaml('A'), lock: LOCK },
            { key: broken },
            server.deps,
        );
        expect(signError).toBeTruthy();
        expect(await server.isSigned(id)).toBe(false);
    });
});
