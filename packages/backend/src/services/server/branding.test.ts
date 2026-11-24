import { DEFAULT_SERVER_BRANDING, type ServerBrandingUpdate, type ServerImageKind } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { JobGateFullError } from '../../utils/jobGate';
import { type BrandingDeps, createBranding } from './branding';
import type { ServerImage, ServerImageResult } from './brandingImages';

const BASE = 'https://ubi.example';
const hashOf = (tag: string) => tag.padEnd(43, 'x');

const imageOf = (variant: ServerImage['variant'], tag: string): ServerImage => ({
    variant,
    hash: hashOf(`${tag}${variant.length}`),
    contentType: variant === 'banner' ? 'image/webp' : 'image/png',
    bytes: Uint8Array.from([1, 2, 3]),
    width: 32,
    height: 32,
});

const ICON: ServerImage['variant'][] = ['favicon', 'apple-touch-icon', 'icon-192', 'icon-512'];

function setup(processImage: BrandingDeps['processImage'] = async (kind) => okImages(kind, 'a')) {
    const store = {
        record: null as ServerBrandingUpdate | null,
        images: new Map<string, ServerImage & { kind: ServerImageKind }>(),
        puts: 0,
    };
    const service = createBranding({
        repository: {
            get: async () => store.record,
            put: async (record) => {
                store.puts += 1;
                store.record = record;
            },
            images: async () => [...store.images.values()].map(({ variant, hash }) => ({ variant, hash })),
            image: async (variant, hash) => {
                const image = store.images.get(variant);
                return image?.hash === hash ? image : undefined;
            },
            replaceImages: async (kind, images) => {
                for (const [variant, image] of store.images) if (image.kind === kind) store.images.delete(variant);
                for (const image of images) store.images.set(image.variant, { ...image, kind });
            },
            removeImages: async (kind) => {
                const before = store.images.size;
                for (const [variant, image] of store.images) if (image.kind === kind) store.images.delete(variant);
                return store.images.size < before;
            },
        },
        processImage,
        publicBaseUrl: `${BASE}/`,
    });
    return { service, store };
}

const okImages = (kind: ServerImageKind, tag: string): ServerImageResult => ({
    ok: true,
    images: kind === 'icon' ? ICON.map((variant) => imageOf(variant, tag)) : [imageOf('banner', tag)],
});

describe('createBranding', () => {
    it('何も決めていなければ既定（すべて null）', async () => {
        const { service } = setup();
        expect(await service.branding()).toEqual(DEFAULT_SERVER_BRANDING);
    });

    it('略称と色を整えて保存し、保存した後のブランディングを返す', async () => {
        const { service } = setup();
        expect(await service.update({ shortName: ' ゆ ', themeColor: '#2F6F4F' })).toEqual({
            ok: true,
            value: { ...DEFAULT_SERVER_BRANDING, shortName: 'ゆ', themeColor: '#2f6f4f' },
        });
    });

    it('ボタンの文字が読めない色・欠けた本文は保存しない', async () => {
        const { service, store } = setup();
        const light = await service.update({ shortName: null, themeColor: '#ffffff' });
        expect(light).toMatchObject({ ok: false, status: 400, code: 'invalid' });
        expect(light.ok ? '' : light.error).toMatch(/明るすぎ/);
        expect(await service.update({ themeColor: '#1b2a44' })).toMatchObject({ ok: false, status: 400 });
        expect(await service.update('#1b2a44')).toMatchObject({ ok: false, status: 400 });
        expect(store.puts).toBe(0);
    });

    it('アイコンを置くと、絶対 URL のアイコンの組が返り、そのハッシュでだけ読める', async () => {
        const { service } = setup();
        const outcome = await service.replaceImage('icon', Uint8Array.from([9]));
        if (!outcome.ok) throw new Error(outcome.error);
        expect(outcome.value.icon?.favicon).toBe(
            `${BASE}/api/v1/server/images/favicon/${imageOf('favicon', 'a').hash}.png`,
        );
        expect(outcome.value.banner).toBeNull();
        expect(await service.image('favicon', imageOf('favicon', 'a').hash)).toBeDefined();
        expect(await service.image('favicon', imageOf('icon-512', 'a').hash)).toBeUndefined();
    });

    it('置き換えると前の URL では読めなくなり、バナーは残る', async () => {
        const uploads = { count: 0 };
        const { service } = setup(async (kind) => {
            uploads.count += 1;
            return okImages(kind, `u${uploads.count}`);
        });
        await service.replaceImage('banner', Uint8Array.from([1]));
        const first = await service.replaceImage('icon', Uint8Array.from([1]));
        const second = await service.replaceImage('icon', Uint8Array.from([2]));
        if (!first.ok || !second.ok) throw new Error('置けなかった');
        expect(second.value.icon?.icon512).not.toBe(first.value.icon?.icon512);
        const oldHash = first.value.icon?.icon512.split('/').at(-1)?.replace('.png', '') ?? '';
        expect(await service.image('icon-512', oldHash)).toBeUndefined();
        expect(second.value.banner).not.toBeNull();
    });

    it('作り直せない画像は、種類に合った状態で断り、前の画像を残す', async () => {
        const results: ServerImageResult[] = [
            { ok: false, code: 'too-large', message: '大きすぎ' },
            { ok: false, code: 'unsupported', message: '形式' },
            { ok: false, code: 'too-many-pixels', message: '画素' },
            { ok: false, code: 'undecodable', message: '読めない' },
            { ok: false, code: 'empty', message: '空' },
        ];
        const { service, store } = setup(async (kind) => results.shift() ?? okImages(kind, 'x'));
        store.images.set('banner', { ...imageOf('banner', 'old'), kind: 'banner' });
        const statuses = [];
        for (const _ of [1, 2, 3, 4, 5]) {
            const outcome = await service.replaceImage('banner', Uint8Array.from([1]));
            statuses.push(outcome.ok ? 200 : outcome.status);
        }
        expect(statuses).toEqual([413, 415, 422, 422, 400]);
        expect(store.images.get('banner')?.hash).toBe(imageOf('banner', 'old').hash);
    });

    it('混み合っていれば 503 で断り、ほかの例外は投げ直す', async () => {
        const busy = setup(async () => {
            throw new JobGateFullError('混み合っています');
        });
        expect(await busy.service.replaceImage('icon', Uint8Array.from([1]))).toMatchObject({
            ok: false,
            status: 503,
            code: 'busy',
        });
        const broken = setup(async () => {
            throw new Error('db down');
        });
        await expect(broken.service.replaceImage('icon', Uint8Array.from([1]))).rejects.toThrow('db down');
    });

    it('外すと既定に戻り、無いものを外しても失敗にしない', async () => {
        const { service } = setup();
        await service.replaceImage('icon', Uint8Array.from([1]));
        expect(await service.removeImage('icon')).toEqual({ ok: true, value: DEFAULT_SERVER_BRANDING });
        expect(await service.removeImage('icon')).toEqual({ ok: true, value: DEFAULT_SERVER_BRANDING });
    });

    it('アイコンの行が欠けていれば（古い版の残りなど）、アイコンは出さない', async () => {
        const { service, store } = setup();
        await service.replaceImage('icon', Uint8Array.from([1]));
        store.images.delete('apple-touch-icon');
        expect((await service.branding()).icon).toBeNull();
    });
});
