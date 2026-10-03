import type { WorldListItem } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { favoriteRefOf, resolveFavoriteWorlds } from './favorites';

const item = (url: string): WorldListItem =>
    ({ url, id: url.split('/').pop() ?? url, displayName: url, version: '1.0.0' }) as WorldListItem;

describe('favoriteRefOf', () => {
    it('外部ワールドの URL をそのまま受け付ける', () => {
        const url = 'https://raw.githubusercontent.com/ieyoukan/ubichill-worlds/main/worlds/chillwa.yaml';
        expect(favoriteRefOf(url)).toEqual({ ok: true, ref: url });
    });

    it('共有 URL・以前の形は一覧と同じ YAML の URL に正規化する（同じワールドを二重に登録しない）', () => {
        for (const input of [' https://ubichill.com/world/danmaku ', 'https://ubichill.com/api/v1/worlds/danmaku']) {
            expect(favoriteRefOf(input)).toEqual({ ok: true, ref: 'https://ubichill.com/api/v1/worlds/danmaku.yaml' });
        }
    });

    it('URL でない・http(s) でない・長すぎる・文字列でないものは拒否する', () => {
        for (const bad of [
            'danmaku',
            'javascript:alert(1)',
            'file:///etc/passwd',
            '',
            `https://a.example/${'x'.repeat(3000)}`,
            42,
            null,
        ]) {
            expect(favoriteRefOf(bad).ok).toBe(false);
        }
    });
});

describe('resolveFavoriteWorlds', () => {
    it('解決できたものは順序を保って返し、できないもの（取得失敗・公開ルール外・例外）は unavailable に分ける', async () => {
        const refs = ['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4'];
        const result = await resolveFavoriteWorlds(refs, async (ref) => {
            if (ref === 'https://a/2') return undefined;
            if (ref === 'https://a/3') throw new Error('down');
            return item(ref);
        });
        expect(result.worlds.map((w) => w.url)).toEqual(['https://a/1', 'https://a/4']);
        expect(result.unavailable).toEqual(['https://a/2', 'https://a/3']);
    });

    it('別の URL が同じワールドに解決されたら 1 つにまとめる', async () => {
        const result = await resolveFavoriteWorlds(['https://a/share', 'https://a/api'], async () =>
            item('https://a/api'),
        );
        expect(result.worlds).toHaveLength(1);
    });

    it('同時に解決する数を絞る（外部取得を集中させない）', async () => {
        const state = { running: 0, max: 0 };
        const refs = Array.from({ length: 20 }, (_, i) => `https://a/${i}`);
        await resolveFavoriteWorlds(
            refs,
            async (ref) => {
                state.running += 1;
                state.max = Math.max(state.max, state.running);
                await new Promise((r) => setTimeout(r, 1));
                state.running -= 1;
                return item(ref);
            },
            4,
        );
        expect(state.max).toBeLessThanOrEqual(4);
    });
});
