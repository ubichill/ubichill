// @vitest-environment jsdom
import { FRAGMENT, type VNode } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import { decodeEntities, MARKUP_LIMITS, parseStyleAttribute, parseUiMarkup } from './markup';
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

    it('タグ名・属性名は小文字にし、引用符なし・単一引用符・値なしの属性を読む', () => {
        expect(parseUiMarkup(`<A HREF=https://example.com title='x y' download>リンク</A>`).children).toEqual([
            el('a', { href: 'https://example.com', title: 'x y', download: '' }, ['リンク']),
        ]);
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
        expect(parseUiMarkup('<div><p>a</span>b').children).toEqual([el('div', {}, [el('p', {}, ['a', 'b'])])]);
    });

    it('外側の閉じタグで、内側の閉じ忘れもまとめて閉じる', () => {
        expect(parseUiMarkup('<ul><li>1<li>2</ul>後').children).toEqual([
            el('ul', {}, [el('li', {}, ['1', el('li', {}, ['2'])])]),
            '後',
        ]);
    });

    it('タグにならない < はテキストとして残し、閉じない開きタグ・コメントで止まらない', () => {
        expect(parseUiMarkup('1 < 2 <3').children).toEqual(['1 ', '<', ' 2 ', '<', '3']);
        expect(parseUiMarkup('<div class="x').children).toMatchObject([{ type: 'div', children: [] }]);
        expect(parseUiMarkup('a<!-- 閉じない').children).toEqual(['a']);
    });

    it('深さと要素数の上限を超えた分は捨てる', () => {
        const deep = '<div>'.repeat(MARKUP_LIMITS.maxDepth + 10);
        const depthOf = (node: VNode): number =>
            1 +
            Math.max(
                0,
                ...node.children
                    .filter((c): c is VNode => typeof c === 'object' && c !== null && !Array.isArray(c))
                    .map(depthOf),
            );
        expect(depthOf(parseUiMarkup(deep))).toBeLessThanOrEqual(MARKUP_LIMITS.maxDepth + 1);
        const many = '<b>x</b>'.repeat(MARKUP_LIMITS.maxElements + 50);
        expect(parseUiMarkup(many).children).toHaveLength(MARKUP_LIMITS.maxElements);
    });
});

describe('parseUiMarkup: 先に落とすもの', () => {
    it('script・style・template などは中身ごと捨てる（テキストとしても出さない）', () => {
        expect(
            parseUiMarkup(
                'a<script>alert(1)</script>b<STYLE>*{}</STYLE>c<template><b>x</b></template>d<iframe src=x></iframe>e',
            ).children,
        ).toEqual(['a', 'b', 'c', 'd', 'e']);
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

    it('入力欄にパスワードを描かせない', () => {
        expect(render('<input type="password">').querySelector('input')?.getAttribute('type')).toBeNull();
    });
});
