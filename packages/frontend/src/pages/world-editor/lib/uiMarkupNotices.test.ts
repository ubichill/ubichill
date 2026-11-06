import { describe, expect, it } from 'vitest';
import { uiMarkupNotices } from './uiMarkupNotices';

describe('uiMarkupNotices', () => {
    it('押しても動かないボタン・捨てる on* と script を知らせる', () => {
        expect(uiMarkupNotices('<button onclick="go()">押す</button><input><script>x</script>')).toEqual([
            'button・input は描きますが、押しても何も起きません（未対応）。core:ui で使えるのは看板・説明・リンクまでです',
            'onclick などの on* 属性は動きません（描くときに捨てます）',
            'script は中身ごと描きません',
        ]);
    });

    it('看板・リンクだけなら何も知らせない（空でも）', () => {
        expect(uiMarkupNotices('<h2>ようこそ</h2><a href="https://example.com">ルール</a>')).toEqual([]);
        expect(uiMarkupNotices('')).toEqual([]);
    });
});
