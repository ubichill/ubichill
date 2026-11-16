import { sriOf } from '@ubichill/loader';
import { describe, expect, it } from 'vitest';
import { modThumbnailSource } from './modThumbnail';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const base = 'https://cdn.example/mods';

async function served(manifest: Record<string, unknown>) {
    const manifestBytes = encode(manifest);
    const lock = {
        id: 'pen',
        version: '2.3.0',
        manifestIntegrity: await sriOf(manifestBytes.slice().buffer),
        components: {},
    };
    const files: Record<string, Uint8Array> = {
        [`${base}/pen/v2.3.0/lock.json`]: encode(lock),
        [`${base}/pen/v2.3.0/manifest.json`]: manifestBytes,
    };
    return {
        lock,
        fetchBytes: async (url: string) => {
            const bytes = files[url];
            if (!bytes) throw new Error(`404 ${url}`);
            return bytes;
        },
    };
}

const manifest = {
    id: 'pen',
    version: '2.3.0',
    components: {},
    thumbnail: 'previews/thumbnail.svg',
    assetIntegrity: { 'previews/thumbnail.svg': 'sha256-thumb' },
};

describe('modThumbnailSource', () => {
    it('その版の lock と manifest を確かめ、サムネイルの取得先と hash を返す', async () => {
        const { fetchBytes } = await served(manifest);
        expect(
            await modThumbnailSource(
                { id: 'pen', version: '2.3.0', baseUrl: base },
                { fallbackBase: base, fetchBytes },
            ),
        ).toEqual({
            url: `${base}/pen/v2.3.0/previews/thumbnail.svg`,
            integrity: 'sha256-thumb',
            type: 'image/svg+xml',
        });
    });

    it('lock と違う manifest が配られていれば失敗する', async () => {
        const { lock } = await served(manifest);
        const fetchBytes = async (url: string) =>
            url.endsWith('lock.json') ? encode(lock) : encode({ ...manifest, thumbnail: 'previews/other.svg' });
        await expect(
            modThumbnailSource({ id: 'pen', version: '2.3.0', baseUrl: base }, { fallbackBase: base, fetchBytes }),
        ).rejects.toThrow('一致しません');
    });

    it('サムネイルの無い mod は undefined', async () => {
        const { fetchBytes } = await served({ id: 'pen', version: '2.3.0', components: {} });
        expect(
            await modThumbnailSource(
                { id: 'pen', version: '2.3.0', baseUrl: base },
                { fallbackBase: base, fetchBytes },
            ),
        ).toBeUndefined();
    });

    it('固定済みの lock があれば lock.json を取りに行かない', async () => {
        const { lock, fetchBytes } = await served(manifest);
        const urls: string[] = [];
        await modThumbnailSource(
            { id: 'pen', version: '2.3.0', baseUrl: base },
            {
                fallbackBase: base,
                locked: { ...lock, baseUrl: base },
                fetchBytes: (url) => {
                    urls.push(url);
                    return fetchBytes(url);
                },
            },
        );
        expect(urls).toEqual([`${base}/pen/v2.3.0/manifest.json`]);
    });

    it('固定済みの lock が別の取得元のものなら使わず、その取得元の lock を取る', async () => {
        const { lock, fetchBytes } = await served(manifest);
        const urls: string[] = [];
        await modThumbnailSource(
            { id: 'pen', version: '2.3.0', baseUrl: base },
            {
                fallbackBase: '/mods',
                locked: { ...lock, baseUrl: 'https://other.example/mods' },
                fetchBytes: (url) => {
                    urls.push(url);
                    return fetchBytes(url);
                },
            },
        );
        expect(urls[0]).toBe(`${base}/pen/v2.3.0/lock.json`);
    });
});
