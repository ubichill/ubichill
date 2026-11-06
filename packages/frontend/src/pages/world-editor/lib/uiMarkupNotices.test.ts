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

    it('タグを外した要素・https でない URL・上限を超えた部分を知らせる', () => {
        expect(uiMarkupNotices(`<p><b>大事</b></p><img src="http://e.x/a.png">${'<div>'.repeat(40)}`)).toEqual([
            'b は使えないため、タグを外して中身だけを描きます',
            'https 以外の URL（http・相対パスなど）のリンクと画像は描きません。画像は参照元（部屋の URL）を送らずに読み込みます',
            '入れ子が 32 段を超えた部分と、2000 個を超えた要素は描きません',
        ]);
    });

    it('看板・リンクだけなら何も知らせない（空でも）', () => {
        expect(uiMarkupNotices('<h2>ようこそ</h2><a href="https://example.com">ルール</a>')).toEqual([]);
        expect(uiMarkupNotices('')).toEqual([]);
    });
});
