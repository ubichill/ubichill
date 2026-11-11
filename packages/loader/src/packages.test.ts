import { createModLock, lockedMods, MOD_CATALOG_REL, signMod } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { buildWorldLock, createDependencyAwareLockEntryGetter } from './buildWorldLock';
import { sriOf } from './integrity';
import { resolvePackage } from './packages';
import { generateSigningKeyPkcs8, importSigningKey, webWorldCrypto } from './worldCrypto';

const encoder = new TextEncoder();
const author = 'alice@example.com';
async function fixture() {
    const key = await importSigningKey(await generateSigningKeyPkcs8());
    const manifest = encoder.encode(
        JSON.stringify({
            id: 'demo',
            version: '1.0.0',
            components: {},
            prefabs: {
                welcome: {
                    name: 'Hello',
                    entities: [
                        {
                            id: 'hi',
                            transform: { x: 0, y: 0 },
                            components: [{ type: 'core:ui', data: { markup: '<div>Hello</div>' } }],
                        },
                    ],
                },
            },
        }),
    );
    const entry = { id: 'demo', version: '1.0.0', manifestIntegrity: await sriOf(manifest.buffer), components: {} };
    const signature = await signMod(entry, key, webWorldCrypto, { author });
    const files: Record<string, unknown> = {
        [`https://example.com/.well-known/webfinger?resource=${encodeURIComponent(`acct:${author}`)}`]: {
            subject: `acct:${author}`,
            links: [{ rel: MOD_CATALOG_REL, href: 'https://example.com/catalog' }],
        },
        'https://example.com/catalog/demo': {
            author,
            id: 'demo',
            version: '1.0.0',
            baseUrl: 'https://cdn.example/mods',
        },
        'https://cdn.example/mods/demo/v1.0.0/lock.json': entry,
        'https://cdn.example/mods/demo/v1.0.0/lock.sig.json': signature,
    };
    const fetchBytes = async (url: string) => {
        if (url.endsWith('/manifest.json')) return manifest;
        if (!(url in files)) throw new Error(`unexpected fetch: ${url}`);
        return encoder.encode(JSON.stringify(files[url]));
    };
    return { files, entry, fetchBytes, key };
}
describe('distributed package resolution', () => {
    it('カタログは取得先だけを返し、配布先の署名・hash・プレハブを確認する', async () => {
        const f = await fixture();
        const resolved = await resolvePackage(
            { author, id: 'demo' },
            {
                fetchBytes: f.fetchBytes,
                verify: async (entry, signature) => {
                    const { verifyModSignature } = await import('@ubichill/shared');
                    return verifyModSignature(entry, signature, webWorldCrypto, async (account, key) =>
                        account === author && key === f.key.publicKey
                            ? { status: 'confirmed' }
                            : { status: 'unconfirmed' },
                    );
                },
            },
        );
        expect(resolved.entry.author).toBe(author);
        expect(resolved.manifest.prefabs?.welcome.entities[0].components[0].type).toBe('core:ui');
    });
    it('同じ内容を別作者が署名しても指定した作者としては受け入れない', async () => {
        const f = await fixture();
        await expect(
            resolvePackage(
                { author, id: 'demo' },
                {
                    fetchBytes: f.fetchBytes,
                    verify: async () => ({
                        status: 'verified',
                        author: 'mallory@example.com',
                        publicKey: 'x',
                        contentHash: 'x',
                    }),
                },
            ),
        ).rejects.toThrow('作者');
    });
    it('配布元が変わっていない通常保存では latest を再解決しない', async () => {
        const f = await fixture();
        const entry = { ...f.entry, baseUrl: 'https://cdn.example/mods', author };
        const getter = createDependencyAwareLockEntryGetter(
            [{ name: 'demo', source: { url: entry.baseUrl, version: 'latest', author } }],
            async () => {
                throw new Error('should not fetch');
            },
            undefined,
            createModLock({ demo: entry }),
        );
        expect(lockedMods(await buildWorldLock(['demo'], getter)).demo).toEqual(entry);
    });
    it('別サーバーのカタログへの WebFinger リンクを信用しない', async () => {
        const f = await fixture();
        f.files[Object.keys(f.files)[0]] = {
            subject: `acct:${author}`,
            links: [{ rel: MOD_CATALOG_REL, href: 'https://evil.example/catalog' }],
        };
        await expect(resolvePackage({ author, id: 'demo' }, { fetchBytes: f.fetchBytes })).rejects.toThrow(
            '同じサーバー',
        );
    });
});
