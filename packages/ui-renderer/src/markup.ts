/**
 * HTML 風の文字列を VNode にする（`core:ui` の UI データ用）。
 *
 * 役割は形を作ることだけ。どのタグ・属性・URL・style を DOM に書くかは、mod の VNode と同じく
 * `renderVNode`（許可リスト・URL と style の検査）が決める。ここでは次だけを先に落とす:
 * - `script` / `style` / `template` などの中身（テキストとしても出さない）
 * - コメント・`<!DOCTYPE>`
 * - `on*` 属性（`onUbi*` を名乗ってハンドラーの番号を偽らせない）
 *
 * 壊れた入力でも例外を投げない（閉じ忘れは閉じる、対応しない閉じタグは無視する）。
 * 深さと要素数に上限を持ち、超えた分は捨てる。
 */
import { FRAGMENT, type VNode, type VNodeChild, type VNodeProps } from '@ubichill/shared';

export const MARKUP_LIMITS = { maxDepth: 32, maxElements: 2000 } as const;

const VOID_TAGS: ReadonlySet<string> = new Set([
    'br',
    'hr',
    'img',
    'input',
    'wbr',
    'col',
    'area',
    'source',
    'meta',
    'link',
]);
/** 中身ごと捨てる要素。 */
const DROPPED_TAGS: ReadonlySet<string> = new Set([
    'script',
    'style',
    'template',
    'iframe',
    'object',
    'embed',
    'noscript',
    'title',
    'head',
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};

/** 文字参照を戻す。知らない名前・範囲外の番号はそのまま残す。 */
export function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
        if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
        const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
    });
}

/** `style` 属性の文字列を宣言のオブジェクトにする（値の検査は描画側）。 */
export function parseStyleAttribute(style: string): Record<string, string> {
    return Object.fromEntries(
        style.split(';').flatMap((declaration) => {
            const colon = declaration.indexOf(':');
            if (colon <= 0) return [];
            const name = declaration.slice(0, colon).trim().toLowerCase();
            const value = declaration.slice(colon + 1).trim();
            return name && value ? [[name, value]] : [];
        }),
    );
}

interface OpenElement {
    tag: string;
    props: VNodeProps;
    children: VNodeChild[];
}

const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9-]*/;
const ATTRIBUTE = /^\s*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/;

function toProps(attributes: ReadonlyArray<readonly [string, string]>): VNodeProps {
    return Object.fromEntries(
        attributes
            .filter(([name]) => !name.startsWith('on'))
            .map(([name, value]) => (name === 'style' ? [name, parseStyleAttribute(value)] : [name, value])),
    );
}

/** 開きタグの中身（タグ名の後ろ）を読む。`end` は `>` の次の位置。 */
function readAttributes(
    source: string,
    from: number,
): { attributes: Array<[string, string]>; selfClosing: boolean; end: number } {
    const attributes: Array<[string, string]> = [];
    const pos = { i: from };
    while (pos.i < source.length) {
        const rest = source.slice(pos.i);
        const close = /^\s*(\/?)>/.exec(rest);
        if (close) return { attributes, selfClosing: close[1] === '/', end: pos.i + close[0].length };
        const attribute = ATTRIBUTE.exec(rest);
        if (!attribute) {
            // 読めない文字は 1 文字飛ばす（`<div "x">` のような壊れた入力でも先へ進む）
            pos.i += 1;
            continue;
        }
        const [whole, name, doubleQuoted, singleQuoted, bare] = attribute;
        const lower = name.toLowerCase();
        if (!attributes.some(([existing]) => existing === lower)) {
            attributes.push([lower, decodeEntities(doubleQuoted ?? singleQuoted ?? bare ?? '')]);
        }
        pos.i += whole.length;
    }
    return { attributes, selfClosing: false, end: source.length };
}

/** HTML 風の文字列を、Fragment を根にした VNode にする。 */
export function parseUiMarkup(source: string): VNode {
    const root: OpenElement = { tag: FRAGMENT, props: {}, children: [] };
    const stack: OpenElement[] = [root];
    // 読んでいる位置と、作った要素の数
    const pos = { i: 0, elements: 0 };

    const current = (): OpenElement => stack[stack.length - 1] as OpenElement;
    const closeTop = (): void => {
        const done = stack.pop() as OpenElement;
        current().children.push({ type: done.tag, props: done.props, children: done.children });
    };

    while (pos.i < source.length) {
        const lt = source.indexOf('<', pos.i);
        const textEnd = lt === -1 ? source.length : lt;
        if (textEnd > pos.i) current().children.push(decodeEntities(source.slice(pos.i, textEnd)));
        if (lt === -1) break;
        pos.i = lt;

        if (source.startsWith('<!--', pos.i)) {
            const end = source.indexOf('-->', pos.i + 4);
            pos.i = end === -1 ? source.length : end + 3;
            continue;
        }
        if (source.startsWith('<!', pos.i) || source.startsWith('<?', pos.i)) {
            const end = source.indexOf('>', pos.i);
            pos.i = end === -1 ? source.length : end + 1;
            continue;
        }
        if (source.startsWith('</', pos.i)) {
            const name = TAG_NAME.exec(source.slice(pos.i + 2))?.[0]?.toLowerCase();
            const end = source.indexOf('>', pos.i);
            pos.i = end === -1 ? source.length : end + 1;
            const at = name ? stack.map((e) => e.tag).lastIndexOf(name) : -1;
            // 対応する開きタグがあれば、その内側で閉じ忘れたものもまとめて閉じる
            if (at > 0) while (stack.length > at) closeTop();
            continue;
        }

        const name = TAG_NAME.exec(source.slice(pos.i + 1))?.[0]?.toLowerCase();
        if (!name) {
            current().children.push('<');
            pos.i += 1;
            continue;
        }
        const { attributes, selfClosing, end } = readAttributes(source, pos.i + 1 + name.length);
        pos.i = end;

        if (DROPPED_TAGS.has(name)) {
            if (selfClosing) continue;
            const closing = new RegExp(`</${name}\\s*>`, 'i').exec(source.slice(pos.i));
            pos.i = closing ? pos.i + closing.index + closing[0].length : source.length;
            continue;
        }
        pos.elements += 1;
        if (pos.elements > MARKUP_LIMITS.maxElements || stack.length > MARKUP_LIMITS.maxDepth) break;

        const element: OpenElement = { tag: name, props: toProps(attributes), children: [] };
        if (VOID_TAGS.has(name) || selfClosing) {
            current().children.push({ type: name, props: element.props, children: [] });
        } else {
            stack.push(element);
        }
    }
    while (stack.length > 1) closeTop();
    return { type: FRAGMENT, props: {}, children: root.children };
}
