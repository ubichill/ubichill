// @vitest-environment jsdom
import { FRAGMENT, type VNode } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import { analyzeUiMarkup, decodeEntities, MARKUP_LIMITS, parseStyleAttribute, parseUiMarkup } from './markup';
import { renderVNode } from './VNodeRenderer';

const el = (type: string, props: VNode['props'] = {}, children: VNode['children'] = []): VNode => ({
    type,
    props,
    children,
});

/** 文字列を解析して DOM に描き、innerHTML を返す（安全の判定は描画側までを通して見る）。 */
function render(markup: string): HTMLElement {
    const container = document.createElement('div');
    renderVNode(parseUiMarkup(markup), container, vi.fn());
    return container;
}

describe('parseUiMarkup: 形', () => {
    it('入れ子・テキスト・属性を VNode にする（根は Fragment）', () => {
        expect(parseUiMarkup('<div class="sign"><h2>ようこそ</h2>本文</div>')).toEqual(
            el(FRAGMENT, {}, [el('div', { class: 'sign' }, [el('h2', {}, ['ようこそ']), '本文'])]),
        );
    });

    it('HTML のタグ名・属性名は小文字にし、引用符なし・単一引用符・値なしの属性を読む', () => {
        expect(parseUiMarkup(`<A HREF=https://example.com title='x y' download>リンク</A>`).children).toEqual([
            el('a', { href: 'https://example.com', title: 'x y', download: '' }, ['リンク']),
        ]);
    });

    it('SVG の大文字を含む名前（viewBox・linearGradient・clipPath）は正しい書き方に戻す', () => {
        expect(
            parseUiMarkup(
                '<SVG VIEWBOX="0 0 10 10"><defs><lineargradient id="g" gradientunits="userSpaceOnUse"></lineargradient>' +
                    '<CLIPPATH id="c"></CLIPPATH></defs></SVG>',
            ).children,
        ).toEqual([
            el('svg', { viewBox: '0 0 10 10' }, [
                el('defs', {}, [
                    el('linearGradient', { id: 'g', gradientUnits: 'userSpaceOnUse' }),
                    el('clipPath', { id: 'c' }),
                ]),
            ]),
        ]);
    });

    it('SVG の外では viewBox などを大文字に戻さない（HTML の属性は小文字）', () => {
        expect(parseUiMarkup('<div viewBox="x"></div>').children).toEqual([el('div', { viewbox: 'x' })]);
    });

    it('空要素と自己終了は子を持たない', () => {
        expect(parseUiMarkup('a<br>b<hr/><span/>c').children).toEqual(['a', el('br'), 'b', el('hr'), el('span'), 'c']);
    });

    it('文字参照を戻す。知らない名前・範囲外の番号はそのまま', () => {
        expect(decodeEntities('&lt;b&gt; &amp; &#x41;&#66; &copy; &#0; &#xD800;')).toBe(
            '<b> & AB &copy; &#0; &#xD800;',
        );
        expect(parseUiMarkup('<p title="&quot;q&quot;">&lt;script&gt;</p>').children).toEqual([
            el('p', { title: '"q"' }, ['<script>']),
        ]);
    });

    it('style 属性を宣言のオブジェクトにする（値の中の : は値として残す）', () => {
        expect(parseStyleAttribute('Color: red; background:url(http://x/a.png) ; ;broken; :x')).toEqual({
            color: 'red',
            background: 'url(http://x/a.png)',
        });
    });
});

describe('parseUiMarkup: 壊れた入力', () => {
    it('閉じ忘れは最後に閉じ、対応しない閉じタグは無視する', () => {
        expect(parseUiMarkup('<div><p>a</span>b').children).toEqual([el('div', {}, [el('p', {}, ['ab'])])]);
    });

    it('外側の閉じタグで、内側の閉じ忘れもまとめて閉じる', () => {
        expect(parseUiMarkup('<ul><li>1<li>2</ul>後').children).toEqual([
            el('ul', {}, [el('li', {}, ['1', el('li', {}, ['2'])])]),
            '後',
        ]);
    });

    it('タグにならない < はテキストとして残し、閉じない開きタグ・コメントで止まらない', () => {
        expect(parseUiMarkup('1 < 2 <3').children).toEqual(['1 < 2 <3']);
        expect(parseUiMarkup('<div class="x').children).toMatchObject([{ type: 'div', children: [] }]);
        expect(parseUiMarkup('a<!-- 閉じない').children).toEqual(['a']);
    });

    it('要素名でない < は文字として残す（x<y が残りを飲み込まない）', () => {
        expect(parseUiMarkup('<p>x<y と z</p><p>次</p>').children).toEqual([
            el('p', {}, ['x<y と z']),
            el('p', {}, ['次']),
        ]);
        expect(parseUiMarkup('a</y>b').children).toEqual(['a</y>b']);
    });

    it('深さの上限を超えた部分だけを中身ごと捨て、浅い兄弟とその後ろは残す', () => {
        const tooDeep = `${'<div>'.repeat(MARKUP_LIMITS.maxDepth + 10)}深すぎる${'</div>'.repeat(MARKUP_LIMITS.maxDepth + 10)}`;
        const result = analyzeUiMarkup(`<section>${tooDeep}<p>浅い兄弟</p></section><p>後</p>`);
        const depthOf = (node: VNode): number =>
            1 +
            Math.max(
                0,
                ...node.children
                    .filter((c): c is VNode => typeof c === 'object' && c !== null && !Array.isArray(c))
                    .map(depthOf),
            );
        expect(depthOf(result.vnode)).toBe(MARKUP_LIMITS.maxDepth + 1);
        expect(JSON.stringify(result.vnode)).not.toContain('深すぎる');
        const [section, after] = result.vnode.children as VNode[];
        expect(section?.children.at(-1)).toEqual(el('p', {}, ['浅い兄弟']));
        expect(after).toEqual(el('p', {}, ['後']));
        expect(result.truncated).toBe(true);
    });

    it('要素数の上限を超えたら残りを捨てる', () => {
        const result = analyzeUiMarkup('<span>x</span>'.repeat(MARKUP_LIMITS.maxElements + 50));
        expect(result.vnode.children).toHaveLength(MARKUP_LIMITS.maxElements);
        expect(result.truncated).toBe(true);
    });
});

describe('parseUiMarkup: 先に落とすもの', () => {
    it('script・style・template などは中身ごと捨てる（テキストとしても出さない）', () => {
        expect(
            parseUiMarkup(
                'a<script>alert(1)</script>b<STYLE>*{}</STYLE>c<template><b>x</b></template>d<iframe src=x></iframe>e',
            ).children,
        ).toEqual(['abcde']);
    });

    it('閉じない script は残りをすべて捨てる', () => {
        expect(parseUiMarkup('a<script>alert(1)<b>x</b>').children).toEqual(['a']);
    });

    it('on* 属性は捨てる（onUbiClick でハンドラーの番号を名乗らせない）', () => {
        expect(parseUiMarkup('<button onclick="x()" onUbiClick="__h0" type="button">押す</button>').children).toEqual([
            el('button', { type: 'button' }, ['押す']),
        ]);
    });

    it('コメントと DOCTYPE は捨てる', () => {
        expect(parseUiMarkup('<!DOCTYPE html><!-- メモ --><p>x</p>').children).toEqual([el('p', {}, ['x'])]);
    });
});

describe('parseUiMarkup: 描かない要素はタグだけ外す', () => {
    it('描かない要素（b など）の中身の文字を残す', () => {
        const result = analyzeUiMarkup('<p>これは<b>大事</b>です</p><center><span>中</span></center>');
        expect(result.vnode.children).toEqual([el('p', {}, ['これは大事です']), el('span', {}, ['中'])]);
        expect([...result.unwrappedTags]).toEqual(['b', 'center']);
    });

    it('タグを外した要素の閉じタグも対応を取る（外側を閉じ忘れない）', () => {
        expect(parseUiMarkup('<div><font color=red>赤</font>後</div>').children).toEqual([el('div', {}, ['赤後'])]);
    });

    it('中身ごと捨てる要素は、タグを外しても中身を出さない', () => {
        expect(parseUiMarkup('<b><script>x</script>見える</b>').children).toEqual(['見える']);
    });

    it('空要素の embed は閉じタグを探して残りを飲み込まない', () => {
        expect(parseUiMarkup('<embed src="https://e.x/a.swf">後').children).toEqual(['後']);
    });
});

describe('parseUiMarkup: URL（mod の UI より狭く、https だけ）', () => {
    it('画像は https と data:image/ だけ。参照元を送らず、作者の referrerpolicy は使わない', () => {
        const result = analyzeUiMarkup(
            '<img src="http://e.x/a.png"><img src="/a.png"><img src="//e.x/a.png">' +
                '<img src="https://e.x/a.png" referrerpolicy="unsafe-url"><img src="data:image/png;base64,AAAA">',
        );
        expect(result.vnode.children).toEqual([
            el('img'),
            el('img'),
            el('img'),
            el('img', { referrerpolicy: 'no-referrer', src: 'https://e.x/a.png' }),
            el('img', { referrerpolicy: 'no-referrer', src: 'data:image/png;base64,AAAA' }),
        ]);
        expect(result.droppedUrls).toBe(true);
    });

    it('リンクは https だけ（相対はページのオリジン、http は平文になる）', () => {
        expect(
            parseUiMarkup('<a href="http://e.x">a</a><a href="/instance/x">b</a><a href="https://e.x">c</a>').children,
        ).toEqual([el('a', {}, ['a']), el('a', {}, ['b']), el('a', { href: 'https://e.x' }, ['c'])]);
    });

    it('img 以外の src（input type=image など）は取得を起こすので捨てる', () => {
        expect(parseUiMarkup('<input type="image" src="https://e.x/a.png">').children).toEqual([
            el('input', { type: 'image' }),
        ]);
    });

    it('SVG の href は文書内の #id だけ', () => {
        expect(
            parseUiMarkup('<svg><use href="#icon"></use><use href="https://e.x/s.svg#i"></use></svg>').children,
        ).toEqual([el('svg', {}, [el('use', { href: '#icon' }), el('use')])]);
    });
});

describe('parseUiMarkup: 時間は文字数に比例する（部屋に入るたびに解析する）', () => {
    const LIMIT = 20_000;
    const adversarial: Record<string, string> = {
        閉じない開きタグの後の空白: `<div${' '.repeat(LIMIT)}`,
        '= を待つ空白': `<div a${' '.repeat(LIMIT / 2)}=${' '.repeat(LIMIT / 2)}`,
        閉じない引用符: `<div a="${'x'.repeat(LIMIT)}`,
        属性だらけ: `<p ${'a '.repeat(LIMIT / 2)}>`,
        同じ名前の属性だらけ: `<p ${'a=1 '.repeat(LIMIT / 4)}>`,
        '> の無い閉じタグ': '</a'.repeat(LIMIT / 3),
        '要素名でない <': 'x<y'.repeat(LIMIT / 3),
        深い入れ子: `${'<div>'.repeat(LIMIT / 10)}${'</div>'.repeat(LIMIT / 10)}`,
        タグを外す要素の入れ子: `${'<b>'.repeat(LIMIT / 6)}${'<span></span>'.repeat(LIMIT / 26)}`,
        '閉じない script': `<script>${' '.repeat(LIMIT)}`,
        '閉じない script の閉じタグもどき': `<script>${'</script '.repeat(LIMIT / 9)}`,
        閉じないコメント: `<!--${'-'.repeat(LIMIT)}`,
    };

    for (const [name, source] of Object.entries(adversarial)) {
        it(`${name}（${source.length} 文字）を 50ms 未満で読む`, () => {
            analyzeUiMarkup(source);
            const started = performance.now();
            analyzeUiMarkup(source);
            expect(performance.now() - started).toBeLessThan(50);
        });
    }
});

describe('parseUiMarkup → renderVNode（描画側の検査まで通す）', () => {
    it('リンクは新しいタブで開き、元のページを操作させない', () => {
        const a = render('<a href="https://example.com">公式</a>').querySelector('a');
        expect(a?.getAttribute('href')).toBe('https://example.com');
        expect(a?.getAttribute('target')).toBe('_blank');
        expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('javascript: の URL・許可されない要素・外部取得を起こす style は DOM に書かない', () => {
        const html = render(
            '<a href="javascript:alert(1)">x</a><img src="javascript:alert(1)"><svg onload="x()"><script>1</script></svg>' +
                '<div style="background-image: url(https://tracker.example/p.png); color: red">y</div><object data="x"></object>',
        ).innerHTML;
        expect(html).not.toMatch(/javascript:|onload|tracker\.example|<object|<script/i);
        expect(html).toContain('color: red');
    });

    it('画像は参照元を送らない', () => {
        const img = render('<img src="https://e.x/a.png" referrerpolicy="unsafe-url">').querySelector('img');
        expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
        expect(img?.getAttribute('src')).toBe('https://e.x/a.png');
    });

    it('SVG の viewBox・グラデーション・クリップは描ける形で DOM に入る', () => {
        const container = render(
            '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><circle r="4" fill="url(#g)"/></svg>',
        );
        const svgNs = 'http://www.w3.org/2000/svg';
        expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 10 10');
        expect(container.getElementsByTagNameNS(svgNs, 'linearGradient')).toHaveLength(1);
        expect(container.querySelector('circle')?.getAttribute('fill')).toBe('url(#g)');
    });

    it('入力欄にパスワードを描かせない', () => {
        expect(render('<input type="password">').querySelector('input')?.getAttribute('type')).toBeNull();
    });
});

describe('analyzeUiMarkup（作者に知らせること）', () => {
    it('捨てた要素・on* 属性・押しても動かない要素を挙げる', () => {
        const result = analyzeUiMarkup(
            '<script>x</script><STYLE/><button onclick="go()">押す</button><form><input></form><a href="https://e.x">ok</a>',
        );
        expect([...result.droppedTags]).toEqual(['script', 'style']);
        expect(result.droppedHandlers).toBe(true);
        expect([...result.interactiveTags]).toEqual(['button', 'form', 'input']);
        expect(result.droppedUrls).toBe(false);
        expect(result.truncated).toBe(false);
    });

    it('看板・説明・リンクだけなら何も挙げない', () => {
        const result = analyzeUiMarkup(
            '<div><h2>ようこそ</h2><p><a href="https://e.x">ルール</a></p><img src="https://e.x/a.png"></div>',
        );
        expect(result.droppedTags.size).toBe(0);
        expect(result.droppedHandlers).toBe(false);
        expect(result.interactiveTags.size).toBe(0);
        expect(result.unwrappedTags.size).toBe(0);
        expect(result.droppedUrls).toBe(false);
    });
});
