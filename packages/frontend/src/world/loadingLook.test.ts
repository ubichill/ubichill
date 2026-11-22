import { describe, expect, it } from 'vitest';
import { loadingLook } from './loadingLook';

describe('loadingLook', () => {
    it('渡されたものを先に使う（部屋を引く前から出せる）', () => {
        expect(
            loadingLook({ displayName: 'ホーム', thumbnail: 'https://a/home.png' }, { thumbnail: 'https://b/x.png' }),
        ).toEqual({ displayName: 'ホーム', thumbnail: 'https://a/home.png' });
    });

    it('渡されていなければ、部屋を引いた結果を使う（共有の URL から直接入ったとき）', () => {
        expect(loadingLook(undefined, { displayName: '弾幕', thumbnail: 'https://b/danmaku.png' })).toEqual({
            displayName: '弾幕',
            thumbnail: 'https://b/danmaku.png',
        });
    });

    it('項目ごとに埋める。空白だけのものは無いものとする', () => {
        expect(loadingLook({ displayName: '  ', thumbnail: 'https://a/x.png' }, { displayName: '弾幕' })).toEqual({
            displayName: '弾幕',
            thumbnail: 'https://a/x.png',
        });
        expect(loadingLook({ thumbnail: '' }, null)).toEqual({ displayName: undefined, thumbnail: undefined });
    });
});
