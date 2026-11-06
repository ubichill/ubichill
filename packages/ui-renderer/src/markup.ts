/**
 * HTML 風の文字列を VNode にする（`core:ui` の UI データ用）。
 *
 * どのタグ・属性・style を DOM に書くかは、mod の VNode と同じく `renderVNode`（許可リスト・URL と style の検査）が決める。
 * ここでは次を先に済ませる:
 * - `script` / `style` / `template` などは中身ごと捨てる（テキストとしても出さない）
 * - 描かない要素（`b`・`center` など）はタグだけ外して中身を残す（文字が黙って消えないように）
 * - 要素名でない `<`（`x<y` など）は文字として残す
 * - コメント・`<!DOCTYPE>`・`on*` 属性を捨てる（`onUbi*` を名乗ってハンドラーの番号を偽らせない）
 * - `src` / `href` は https だけにし、画像は参照元（部屋の URL）を送らない。mod の UI より狭い
 *   （ワールド作者のサーバーに、訪れた人の部屋の URL・名前を渡さないため）
 *
 * 壊れた入力でも例外を投げない（閉じ忘れは閉じる、対応しない閉じタグは無視する）。
 * 同じ位置を読み直さないので、時間は文字数に比例する（部屋に入るたびに解析するため）。
 * 深さの上限を超えた要素は中身ごと捨て（浅い兄弟は残す）、要素数の上限を超えたら残りを捨てる。
 */
import { FRAGMENT, type VNode, type VNodeChild, type VNodeProps } from '@ubichill/shared';
import { ALLOWED_TAGS, SVG_CAMEL_ATTRS } from './elements';

export const MARKUP_LIMITS = { maxDepth: 32, maxElements: 2000 } as const;

const VOID_TAGS: ReadonlySet<string> = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
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
/** 描かないが中身に害は無いので、タグだけ外して中身を残す標準の要素。ここにも無い名前の `<` は文字として扱う。 */
const UNWRAPPED_TAGS: ReadonlySet<string> = new Set([
    'html',
    'body',
    'b',
    'i',
    'u',
    's',
    'sub',
    'sup',
    'mark',
    'abbr',
    'cite',
    'dfn',
    'kbd',
    'samp',
    'var',
    'q',
    'time',
    'data',
    'big',
    'center',
    'font',
    'tt',
    'strike',
    'ins',
    'del',
    'bdi',
    'bdo',
    'ruby',
    'rt',
    'rp',
    'dl',
    'dt',
    'dd',
    'caption',
    'colgroup',
    'tfoot',
    'address',
    'hgroup',
    'search',
    'menu',
    'dialog',
    'output',
    'optgroup',
    'datalist',
    'picture',
    'audio',
    'video',
    'canvas',
    'map',
    'math',
    'slot',
    'nobr',
    'marquee',
    'blink',
    'foreignObject',
    'image',
    'filter',
    'mask',
    'desc',
    'metadata',
    'switch',
    'textPath',
]);

const byLowerCase = (names: Iterable<string>): ReadonlyMap<string, string> =>
    new Map([...names].map((name) => [name.toLowerCase(), name]));
/** 小文字にした要素名 → 正しい書き方（SVG の `clipPath` などは大文字を含む）。 */
const KNOWN_TAGS = byLowerCase([...ALLOWED_TAGS, ...DROPPED_TAGS, ...UNWRAPPED_TAGS, ...VOID_TAGS]);
/** 小文字にした SVG の属性名 → 正しい書き方（`viewBox` など）。 */
const SVG_ATTRIBUTES = byLowerCase(SVG_CAMEL_ATTRS);

/** 描いても押して何かが起きることは無い要素（core:ui は操作を配送しない）。 */
const INTERACTIVE_TAGS: ReadonlySet<string> = new Set(['button', 'input', 'select', 'textarea', 'form']);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
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

// 位置を指定して読む（`y`）。入力の残りを切り出さないので、読む量は文字数に比例する。
const TAG_NAME = /[a-zA-Z][a-zA-Z0-9-]*/y;
const SPACES = /\s+/y;
const ATTRIBUTE_NAME = /[^\s"'<>/=]+/y;
const ATTRIBUTE_VALUE = /\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/y;
const CLOSING_DROPPED = new Map([...DROPPED_TAGS].map((tag) => [tag, new RegExp(`</${tag}\\s*>`, 'gi')]));

function matchAt(pattern: RegExp, source: string, at: number): RegExpExecArray | null {
    pattern.lastIndex = at;
    return pattern.exec(source);
}

/** 開きタグの中身（タグ名の後ろ）を読む。`end` は `>` の次の位置。同じ名前の属性は先のものを使う。 */
function readAttributes(
    source: string,
    from: number,
): { attributes: Array<[string, string]>; selfClosing: boolean; end: number } {
    const attributes: Array<[string, string]> = [];
    const seen = new Set<string>();
    const at = { i: from };
    while (at.i < source.length) {
        at.i += matchAt(SPACES, source, at.i)?.[0].length ?? 0;
        if (source[at.i] === '>') return { attributes, selfClosing: false, end: at.i + 1 };
        if (source.startsWith('/>', at.i)) return { attributes, selfClosing: true, end: at.i + 2 };
        const name = matchAt(ATTRIBUTE_NAME, source, at.i)?.[0];
        if (!name) {
            // 読めない文字は 1 文字飛ばす（`<div "x">` のような壊れた入力でも先へ進む）
            at.i += 1;
            continue;
        }
        at.i += name.length;
        const value = matchAt(ATTRIBUTE_VALUE, source, at.i);
        at.i += value?.[0].length ?? 0;
        const lower = name.toLowerCase();
        if (!seen.has(lower)) {
            seen.add(lower);
            attributes.push([lower, decodeEntities(value?.[1] ?? value?.[2] ?? value?.[3] ?? '')]);
        }
    }
    return { attributes, selfClosing: false, end: source.length };
}

const isHttpsUrl = (value: string): boolean => {
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
};

/**
 * core:ui で残す URL。mod の UI（http・相対 URL も通す）より狭く、https だけにする。
 * 画像は data:image/ も通す（取得を起こさない）。SVG の href は文書内の `#id` だけ（描画側も同じ検査をする）。
 */
function allowedUrl(tag: string, name: 'src' | 'href', value: string, inSvg: boolean): boolean {
    if (name === 'href') return inSvg ? value.startsWith('#') : isHttpsUrl(value);
    return tag === 'img' && (isHttpsUrl(value) || value.startsWith('data:image/'));
}

interface Findings {
    droppedTags: Set<string>;
    unwrappedTags: Set<string>;
    interactiveTags: Set<string>;
    droppedHandlers: boolean;
    droppedUrls: boolean;
    truncated: boolean;
}

function toProps(
    tag: string,
    attributes: ReadonlyArray<readonly [string, string]>,
    inSvg: boolean,
    findings: Findings,
): VNodeProps {
    const kept = attributes.flatMap(([lower, value]): Array<[string, VNodeProps[string]]> => {
        // 作者の referrerpolicy は使わない（unsafe-url で部屋の URL を送らせない）
        if (lower.startsWith('on') || lower === 'referrerpolicy') return [];
        const name = inSvg ? (SVG_ATTRIBUTES.get(lower) ?? lower) : lower;
        if (name === 'style') return [[name, parseStyleAttribute(value)]];
        if ((name === 'src' || name === 'href') && !allowedUrl(tag, name, value, inSvg)) {
            findings.droppedUrls = true;
            return [];
        }
        return [[name, value]];
    });
    // 画像の取得より先に効くよう、src より前に置く
    const referrer: Array<[string, VNodeProps[string]]> = kept.some(([name]) => name === 'src')
        ? [['referrerpolicy', 'no-referrer']]
        : [];
    return Object.fromEntries([...referrer, ...kept]);
}

/**
 * 開いている要素。`sink` は中身の行き先: 描く要素は自分の子、タグを外す要素は親の行き先、
 * 深すぎて捨てる要素は null（中身も捨てる）。タグを外す要素は親の配列へ直接足すので、閉じるときに移し替えない。
 */
interface OpenElement {
    tag: string;
    mode: 'keep' | 'unwrap' | 'discard';
    props: VNodeProps;
    sink: VNodeChild[] | null;
    inSvg: boolean;
}

/** 隣り合う文字は 1 つにまとめる（タグを外した要素の前後の文字がつながる）。 */
function append(sink: VNodeChild[] | null, child: VNodeChild): void {
    if (!sink) return;
    const last = sink[sink.length - 1];
    if (typeof child === 'string' && typeof last === 'string') sink[sink.length - 1] = last + child;
    else if (child !== '') sink.push(child);
}

export interface UiMarkupAnalysis {
    vnode: VNode;
    /** 中身ごと捨てた要素（script・style など）。 */
    droppedTags: ReadonlySet<string>;
    /** 描かないので、タグだけ外して中身を残した要素（b・center など）。 */
    unwrappedTags: ReadonlySet<string>;
    /** on* 属性を捨てたか。 */
    droppedHandlers: boolean;
    /** https 以外の URL（http・相対パス・javascript: など）の src / href を捨てたか。 */
    droppedUrls: boolean;
    /** 深さ・要素数の上限を超えて捨てた要素があるか。 */
    truncated: boolean;
    /** 描くが押しても何も起きない要素（button・input など）。 */
    interactiveTags: ReadonlySet<string>;
}

/** HTML 風の文字列を、Fragment を根にした VNode にする。 */
export function parseUiMarkup(source: string): VNode {
    return analyzeUiMarkup(source).vnode;
}

/** VNode にしつつ、捨てたもの・動かないものを数える（World Editor が作者に知らせる）。 */
export function analyzeUiMarkup(source: string): UiMarkupAnalysis {
    const children: VNodeChild[] = [];
    const root: OpenElement = { tag: FRAGMENT, mode: 'keep', props: {}, sink: children, inSvg: false };
    const stack: OpenElement[] = [root];
    // 閉じタグの照合を速くするため、開いている要素の名前ごとの数を持つ
    const openCount = new Map<string, number>();
    // 読んでいる位置・作った要素の数・開いている「描く要素」と「捨てる要素」の数
    const at = { i: 0, elements: 0, depth: 0, discarding: 0 };
    const findings: Findings = {
        droppedTags: new Set(),
        unwrappedTags: new Set(),
        interactiveTags: new Set(),
        droppedHandlers: false,
        droppedUrls: false,
        truncated: false,
    };

    const current = (): OpenElement => stack[stack.length - 1] as OpenElement;
    const open = (element: OpenElement): void => {
        stack.push(element);
        openCount.set(element.tag, (openCount.get(element.tag) ?? 0) + 1);
        if (element.mode === 'keep') at.depth += 1;
        if (element.mode === 'discard') at.discarding += 1;
    };
    const closeTop = (): void => {
        const done = stack.pop() as OpenElement;
        openCount.set(done.tag, (openCount.get(done.tag) ?? 1) - 1);
        if (done.mode === 'keep') {
            at.depth -= 1;
            append(current().sink, { type: done.tag, props: done.props, children: done.sink ?? [] });
        }
        if (done.mode === 'discard') at.discarding -= 1;
    };

    while (at.i < source.length) {
        const lt = source.indexOf('<', at.i);
        const textEnd = lt === -1 ? source.length : lt;
        if (textEnd > at.i) append(current().sink, decodeEntities(source.slice(at.i, textEnd)));
        if (lt === -1) break;

        if (source.startsWith('<!--', lt)) {
            const end = source.indexOf('-->', lt + 4);
            at.i = end === -1 ? source.length : end + 3;
            continue;
        }
        if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
            const end = source.indexOf('>', lt);
            at.i = end === -1 ? source.length : end + 1;
            continue;
        }
        const closing = source.startsWith('</', lt);
        const nameStart = lt + (closing ? 2 : 1);
        const rawName = matchAt(TAG_NAME, source, nameStart)?.[0];
        const lower = rawName?.toLowerCase();
        const tag = lower === undefined ? undefined : KNOWN_TAGS.get(lower);
        if (rawName === undefined || lower === undefined || tag === undefined) {
            // 要素名でない `<`（`1 < 2`・`x<y`）は文字
            append(current().sink, '<');
            at.i = lt + 1;
            continue;
        }

        if (closing) {
            const end = source.indexOf('>', nameStart);
            at.i = end === -1 ? source.length : end + 1;
            // 対応する開きタグがあれば、その内側で閉じ忘れたものもまとめて閉じる
            if ((openCount.get(tag) ?? 0) > 0) {
                while (current().tag !== tag) closeTop();
                closeTop();
            }
            continue;
        }

        const { attributes, selfClosing, end } = readAttributes(source, nameStart + rawName.length);
        at.i = end;
        if (attributes.some(([name]) => name.startsWith('on'))) findings.droppedHandlers = true;
        const leaf = selfClosing || VOID_TAGS.has(lower);

        if (DROPPED_TAGS.has(lower)) {
            findings.droppedTags.add(lower);
            const closingTag = CLOSING_DROPPED.get(lower);
            if (!leaf && closingTag) {
                closingTag.lastIndex = at.i;
                const found = closingTag.exec(source);
                at.i = found ? found.index + found[0].length : source.length;
            }
            continue;
        }

        const parent = current();
        const inSvg = parent.inSvg || tag === 'svg';
        if (!ALLOWED_TAGS.has(tag)) {
            findings.unwrappedTags.add(tag);
            if (!leaf) open({ tag, mode: 'unwrap', props: {}, sink: parent.sink, inSvg });
            continue;
        }
        if (at.discarding > 0 || at.depth >= MARKUP_LIMITS.maxDepth) {
            findings.truncated = true;
            if (!leaf) open({ tag, mode: 'discard', props: {}, sink: null, inSvg });
            continue;
        }
        at.elements += 1;
        if (at.elements > MARKUP_LIMITS.maxElements) {
            findings.truncated = true;
            break;
        }
        if (INTERACTIVE_TAGS.has(tag)) findings.interactiveTags.add(tag);
        const props = toProps(tag, attributes, inSvg, findings);
        if (leaf) append(parent.sink, { type: tag, props, children: [] });
        else open({ tag, mode: 'keep', props, sink: [], inSvg });
    }
    while (stack.length > 1) closeTop();
    return {
        vnode: { type: FRAGMENT, props: {}, children },
        droppedTags: findings.droppedTags,
        unwrappedTags: findings.unwrappedTags,
        droppedHandlers: findings.droppedHandlers,
        droppedUrls: findings.droppedUrls,
        truncated: findings.truncated,
        interactiveTags: findings.interactiveTags,
    };
}
