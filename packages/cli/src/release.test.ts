import { createHash } from 'node:crypto';
import type { ModLockEntry } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import { assertReleaseUnchanged, checkPublicRelease, fetchRetryingServerErrors } from './release.ts';

const answer = (status: number) => new Response(null, { status });

describe('fetchRetryingServerErrors', () => {
    it('5xx と通信の失敗はやり直し、待つ時間を倍にしていく', async () => {
        const replies = [
            Promise.reject(new Error('reset')),
            Promise.resolve(answer(503)),
            Promise.resolve(answer(200)),
        ];
        const request = vi.fn(() => replies.shift() ?? Promise.resolve(answer(200)));
        const sleep = vi.fn(async () => {});
        const response = await fetchRetryingServerErrors(request, { delayMs: 10, sleep });
        expect(response.status).toBe(200);
        expect(request).toHaveBeenCalledTimes(3);
        expect(sleep.mock.calls).toEqual([[10], [20]]);
    });

    it('404 などはやり直さずに返す', async () => {
        const request = vi.fn(async () => answer(404));
        const response = await fetchRetryingServerErrors(request, { sleep: async () => {} });
        expect(response.status).toBe(404);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('回数を使い切ったら最後の答え（または失敗）を返す', async () => {
        const sleep = async () => {};
        expect((await fetchRetryingServerErrors(async () => answer(503), { attempts: 2, sleep })).status).toBe(503);
        await expect(
            fetchRetryingServerErrors(() => Promise.reject(new Error('offline')), { attempts: 2, sleep }),
        ).rejects.toThrow('offline');
    });
});

const BASE = 'https://cdn.example/mods';
const ROOT = `${BASE}/pen/v1.0.0/`;
const encoder = new TextEncoder();
const sri = (bytes: Uint8Array) => `sha256-${createHash('sha256').update(bytes).digest('base64')}`;

/** 公開先に置いた 1 つの版（lock・manifest・Worker・アセット）と、それを返す偽の取得。 */
function release(options: { workerUrl?: string; assets?: Record<string, Uint8Array> } = {}) {
    const worker = encoder.encode('export {}');
    const workerUrl = options.workerUrl ?? './main/index.js';
    const assets = options.assets ?? { 'images/a.png': encoder.encode('png') };
    const manifest = encoder.encode(
        JSON.stringify({
            id: 'pen',
            version: '1.0.0',
            components: { 'pen:main': { workerUrl } },
            assets: Object.keys(assets),
            assetIntegrity: Object.fromEntries(Object.entries(assets).map(([path, bytes]) => [path, sri(bytes)])),
        }),
    );
    const entry: ModLockEntry = {
        id: 'pen',
        version: '1.0.0',
        manifestIntegrity: sri(manifest),
        components: { 'pen:main': { workerUrl, integrity: sri(worker), capabilities: ['ui:render'] } },
    };
    // 置き場所の検査が無ければ取得できてしまうように、外を指すパスにも中身を置く
    const files = new Map<string, Uint8Array>([
        [`${ROOT}manifest.json`, manifest],
        [new URL(workerUrl, ROOT).href, worker],
        ...Object.entries(assets).map(([path, bytes]) => [new URL(path, ROOT).href, bytes] as const),
        [`${ROOT}lock.json`, encoder.encode(JSON.stringify(entry))],
    ]);
    const fetched: string[] = [];
    const fetchBytes = async (url: string): Promise<Uint8Array> => {
        fetched.push(url);
        const bytes = files.get(url);
        if (!bytes) throw new Error(`404 ${url}`);
        return bytes;
    };
    return { entry, files, fetched, fetchBytes };
}

describe('checkPublicRelease（配置後に、公開先から同じバイト列を取得できるか）', () => {
    it('公開先の中身が lock と一致すれば通り、lock.json まで取得する', async () => {
        const { entry, fetched, fetchBytes } = release();
        await checkPublicRelease(entry, BASE, fetchBytes);
        expect(fetched).toEqual([
            `${ROOT}manifest.json`,
            `${ROOT}main/index.js`,
            `${ROOT}images/a.png`,
            `${ROOT}lock.json`,
        ]);
    });

    it.each([
        ['親のディレクトリ', '../other/index.js'],
        ['途中で親へ戻る', 'main/../../other/index.js'],
        ['%2e%2e', '%2e%2e/other/index.js'],
        ['別のサイト', 'https://evil.example/index.js'],
        ['package の中を指す絶対パス', '/mods/pen/v1.0.0/main/index.js'],
        ['package の中を指すスキーム省略の URL', '//cdn.example/mods/pen/v1.0.0/main/index.js'],
        ['Windows の区切り', 'main\\index.js'],
    ])('Worker の workerUrl が%s（%s）なら取得せずに止める', async (_label, workerUrl) => {
        const { entry, fetched, fetchBytes } = release({ workerUrl });
        await expect(checkPublicRelease(entry, BASE, fetchBytes)).rejects.toThrow('package の外を指しています');
        expect(fetched).toEqual([`${ROOT}manifest.json`]);
    });

    it('アセットのパスが外を指していても止める', async () => {
        const { entry, fetchBytes } = release({ assets: { '../secret.png': encoder.encode('x') } });
        await expect(checkPublicRelease(entry, BASE, fetchBytes)).rejects.toThrow('package の外を指しています');
    });

    it('取得した合計がちょうど 32 MiB なら通り、1 バイトでも超えれば止める', async () => {
        const half = 16 * 1024 * 1024;
        const workerSize = encoder.encode('export {}').byteLength;
        const fits = release({ assets: { 'a.bin': new Uint8Array(half), 'b.bin': new Uint8Array(half - workerSize) } });
        await checkPublicRelease(fits.entry, BASE, fits.fetchBytes);
        const over = release({
            assets: { 'a.bin': new Uint8Array(half), 'b.bin': new Uint8Array(half - workerSize + 1) },
        });
        await expect(checkPublicRelease(over.entry, BASE, over.fetchBytes)).rejects.toThrow('合計32 MiB');
    });

    it('Worker の中身が lock と違えば止める', async () => {
        const { entry, files, fetchBytes } = release();
        files.set(`${ROOT}main/index.js`, encoder.encode('export { changed }'));
        await expect(checkPublicRelease(entry, BASE, fetchBytes)).rejects.toThrow(
            '配布先の内容が一致しません: ./main/index.js',
        );
    });

    it('アセットの中身が manifest と違えば止める', async () => {
        const { entry, files, fetchBytes } = release();
        files.set(`${ROOT}images/a.png`, encoder.encode('other'));
        await expect(checkPublicRelease(entry, BASE, fetchBytes)).rejects.toThrow(
            '配布先の内容が一致しません: images/a.png',
        );
    });

    it('manifest が lock の manifestIntegrity と違えば止める', async () => {
        const { entry, files, fetchBytes } = release();
        files.set(`${ROOT}manifest.json`, encoder.encode('{"id":"pen","version":"1.0.0"}'));
        await expect(checkPublicRelease(entry, BASE, fetchBytes)).rejects.toThrow('manifest');
    });

    it('公開先の lock.json の内容が違えば止める（capability の天井だけが違っても）', async () => {
        const { entry, files, fetchBytes } = release();
        const main = entry.components['pen:main'];
        const widened = { ...entry, components: { 'pen:main': { ...main, capabilities: ['ui:render', 'net:fetch'] } } };
        files.set(`${ROOT}lock.json`, encoder.encode(JSON.stringify(widened)));
        await expect(checkPublicRelease(entry, BASE, fetchBytes)).rejects.toThrow('配布先の lock が一致しません');
    });
});

describe('assertReleaseUnchanged（配置前に、同じ版を別の内容で上書きしないか）', () => {
    const { entry } = release();

    it('まだ公開していない版（404）なら通る', async () => {
        const read = vi.fn(async () => undefined);
        await assertReleaseUnchanged(entry, BASE, read);
        expect(read).toHaveBeenCalledWith(`${ROOT}lock.json`);
    });

    it('同じ内容なら通る（配布先の baseUrl だけが違っても同じ内容）', async () => {
        await assertReleaseUnchanged(entry, BASE, async () => entry);
        await assertReleaseUnchanged(entry, BASE, async () => ({ ...entry, baseUrl: 'https://old.example/mods' }));
    });

    it('capability の天井だけが違っても、別の内容として止める', async () => {
        const main = entry.components['pen:main'];
        const previous = { ...entry, components: { 'pen:main': { ...main, capabilities: [] } } };
        await expect(assertReleaseUnchanged(entry, BASE, async () => previous)).rejects.toThrow('版を上げて');
    });

    it('公開先にあるものが lock として読めなければ、通さずに止める', async () => {
        await expect(assertReleaseUnchanged(entry, BASE, async () => '<!doctype html>')).rejects.toThrow();
        await expect(assertReleaseUnchanged(entry, BASE, async () => ({}))).rejects.toThrow();
    });
});
