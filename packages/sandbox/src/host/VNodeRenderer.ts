/**
 * VNodeRenderer — Worker から届いた VNode を実 DOM に変換してコンテナへ注入する。
 *
 * React 非依存。Host の Custom Element または React コンポーネントから呼ぶ。
 *
 * セキュリティ:
 * - ALLOWED_TAGS による許可タグのホワイトリスト
 * - onUbi* 以外のイベントリスナーは設定しない
 * - innerHTML は使用しない（すべて createElement / createTextNode）
 *
 * 差分適用:
 * - 同タグなら要素を破棄せず属性・子要素だけを更新する（<input> のフォーカス保持）
 * - イベントハンドラは WeakMap でハンドラ index を追跡し、変化時のみ付け替える
 * - 属性は「前回セットしたキー集合」を WeakMap で管理し、消えたものは removeAttribute
 */

import type { VNode, VNodeChild } from '@ubichill/shared';

const FRAGMENT = 'ubichill:fragment' as const;

// ============================================================
// URL / スタイル サニタイズ
// ============================================================

function sanitizeUrl(url: string): string | null {
    if (url.startsWith('//')) return null;
    // data:image/ は Host が生成した安全な画像データのみ許可
    if (url.startsWith('data:image/')) return url;
    try {
        const { protocol } = new URL(url);
        return protocol === 'https:' || protocol === 'http:' ? url : null;
    } catch {
        return url;
    }
}

function camelToHyphen(prop: string): string {
    return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

// React と同様の unitless プロパティ集合 — 数値でも 'px' を付けない
const UNITLESS_STYLE_PROPS = new Set([
    'animationIterationCount',
    'aspectRatio',
    'borderImageOutset',
    'borderImageSlice',
    'borderImageWidth',
    'boxFlex',
    'boxFlexGroup',
    'boxOrdinalGroup',
    'columnCount',
    'columns',
    'flex',
    'flexGrow',
    'flexShrink',
    'flexOrder',
    'fontWeight',
    'gridArea',
    'gridRow',
    'gridRowEnd',
    'gridRowSpan',
    'gridRowStart',
    'gridColumn',
    'gridColumnEnd',
    'gridColumnSpan',
    'gridColumnStart',
    'lineClamp',
    'lineHeight',
    'opacity',
    'order',
    'orphans',
    'scale',
    'tabSize',
    'widows',
    'zIndex',
    'zoom',
]);

function styleValue(camelProp: string, val: string | number): string {
    if (typeof val === 'number' && !UNITLESS_STYLE_PROPS.has(camelProp)) {
        return val === 0 ? '0' : `${val}px`;
    }
    return String(val);
}

// ============================================================
// SVG タグ・属性の定義
// ============================================================

const SVG_TAGS = new Set([
    'svg',
    'path',
    'circle',
    'ellipse',
    'rect',
    'line',
    'polyline',
    'polygon',
    'g',
    'text',
    'tspan',
    'defs',
    'use',
    'clipPath',
    'linearGradient',
    'radialGradient',
    'stop',
    'pattern',
    'symbol',
    'marker',
]);
const SVG_NS = 'http://www.w3.org/2000/svg';

const SVG_CAMEL_ATTRS = new Set([
    'viewBox',
    'preserveAspectRatio',
    'gradientTransform',
    'gradientUnits',
    'patternTransform',
    'patternUnits',
    'clipPathUnits',
    'markerWidth',
    'markerHeight',
    'refX',
    'refY',
    'stdDeviation',
    'baseFrequency',
]);

// ============================================================
// 許可タグ・属性のホワイトリスト
// ============================================================

const ALLOWED_TAGS = new Set([
    'div',
    'span',
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'button',
    'input',
    'label',
    'select',
    'option',
    'textarea',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'strong',
    'em',
    'small',
    'br',
    'hr',
    'section',
    'article',
    'header',
    'footer',
    'nav',
    'aside',
    'main',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'form',
    'fieldset',
    'legend',
    'pre',
    'code',
    'blockquote',
    'figure',
    'figcaption',
    'details',
    'summary',
    'progress',
    'meter',
    // SVG
    'svg',
    'path',
    'circle',
    'ellipse',
    'rect',
    'line',
    'polyline',
    'polygon',
    'g',
    'text',
    'tspan',
    'defs',
    'use',
    'clipPath',
    'linearGradient',
    'radialGradient',
    'stop',
    'pattern',
    'symbol',
    'marker',
]);

function isAllowedAttr(key: string): boolean {
    switch (key) {
        case 'id':
        case 'class':
        case 'title':
        case 'placeholder':
        case 'disabled':
        case 'type':
        case 'value':
        case 'checked':
        case 'selected':
        case 'href':
        case 'src':
        case 'alt':
        case 'colspan':
        case 'rowspan':
        case 'for':
        case 'name':
        case 'role':
        case 'tabindex':
        case 'min':
        case 'max':
        case 'step':
        case 'rows':
        case 'cols':
        case 'readonly':
        case 'maxlength':
        case 'fill':
        case 'stroke':
        case 'd':
        case 'cx':
        case 'cy':
        case 'r':
        case 'rx':
        case 'ry':
        case 'x1':
        case 'y1':
        case 'x2':
        case 'y2':
        case 'points':
        case 'transform':
        case 'viewBox':
        case 'preserveAspectRatio':
        case 'offset':
        case 'xmlns':
            return true;
        default:
            return key.startsWith('data-') || key.startsWith('aria-');
    }
}

// ============================================================
// 差分追跡 (WeakMap — 要素が GC されると自動解放)
// ============================================================

/** 前回セットした属性キー集合（style は除く） */
const _prevAttrs = new WeakMap<Element, Set<string>>();

/** バインド済みイベントハンドラ {eventType → {handlerIdx, listener}} */
const _prevHandlers = new WeakMap<Element, Map<string, { idx: number; fn: EventListener }>>();

type SendAction = (handlerIndex: number, eventType: string, detail?: unknown) => void;

function _makeListener(idx: number, eventType: string, sendAction: SendAction): EventListener {
    return (e: Event) => {
        e.stopPropagation();
        let detail: unknown = null;
        const t = e.target;
        if (t instanceof HTMLInputElement) {
            detail = t.type === 'checkbox' || t.type === 'radio' ? t.checked : t.value;
        } else if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
            detail = t.value;
        } else {
            detail = (e as CustomEvent).detail ?? null;
        }
        sendAction(idx, eventType, detail);
    };
}

// ============================================================
// プロパティのパッチ適用
// ============================================================

function _patchProps(el: Element, newProps: Record<string, unknown>, sendAction: SendAction, inSvg: boolean): void {
    const prevAttrs = _prevAttrs.get(el) ?? new Set<string>();
    const nextAttrs = new Set<string>();

    let prevHandlers = _prevHandlers.get(el);
    if (!prevHandlers) {
        prevHandlers = new Map();
        _prevHandlers.set(el, prevHandlers);
    }
    const nextHandlerTypes = new Set<string>();

    // style は毎回リセットして再適用（削除されたプロパティを確実に消す）
    (el as HTMLElement).style.cssText = '';

    for (const key of Object.keys(newProps)) {
        const val = newProps[key];
        if (val === null || val === undefined) continue;

        // style オブジェクト
        if (key === 'style' && typeof val === 'object') {
            for (const [prop, sv] of Object.entries(val as Record<string, string | number>)) {
                (el as HTMLElement).style.setProperty(camelToHyphen(prop), styleValue(prop, sv));
            }
            continue;
        }

        // onUbi* → イベントハンドラ（変化時のみ付け替え）
        if (key.startsWith('onUbi') && typeof val === 'string') {
            const match = /^__h(\d+)$/.exec(val);
            if (!match) continue;
            const newIdx = Number(match[1]);
            const eventType = key.slice(5).toLowerCase();
            nextHandlerTypes.add(eventType);
            const existing = prevHandlers.get(eventType);
            if (!existing || existing.idx !== newIdx) {
                if (existing) el.removeEventListener(eventType, existing.fn);
                const fn = _makeListener(newIdx, eventType, sendAction);
                el.addEventListener(eventType, fn);
                prevHandlers.set(eventType, { idx: newIdx, fn });
            }
            continue;
        }

        // 通常属性
        if (inSvg) {
            const attrKey = SVG_CAMEL_ATTRS.has(key) ? key : camelToHyphen(key);
            el.setAttribute(attrKey, String(val));
            nextAttrs.add(attrKey);
        } else {
            const attrKey = key === 'class' ? 'class' : key;
            if (isAllowedAttr(key)) {
                if (key === 'href' || key === 'src') {
                    const safe = sanitizeUrl(String(val));
                    if (safe !== null) {
                        el.setAttribute(attrKey, safe);
                        nextAttrs.add(attrKey);
                    }
                } else if (key === 'value' && el instanceof HTMLInputElement) {
                    // フォーカス中の <input> は value 属性を上書きしない（入力中の文字を保護）
                    if (document.activeElement !== el) {
                        el.setAttribute('value', String(val));
                        (el as HTMLInputElement).value = String(val);
                    }
                    nextAttrs.add('value');
                } else if (key === 'checked' && el instanceof HTMLInputElement) {
                    (el as HTMLInputElement).checked = Boolean(val);
                } else if (
                    key === 'disabled' ||
                    key === 'readonly' ||
                    key === 'selected' ||
                    key === 'required' ||
                    key === 'multiple'
                ) {
                    // Boolean 属性: 値に関わらず存在するだけで有効になるため、
                    // truthy の場合のみセットし、falsy の場合はセットしない（prevAttrs の掃除で削除される）
                    if (val) {
                        el.setAttribute(attrKey, '');
                        nextAttrs.add(attrKey);
                    }
                } else {
                    el.setAttribute(attrKey, String(val));
                    nextAttrs.add(attrKey);
                }
            }
        }
    }

    // 前回あって今回ない属性を削除
    for (const attr of prevAttrs) {
        if (!nextAttrs.has(attr)) el.removeAttribute(attr);
    }
    _prevAttrs.set(el, nextAttrs);

    // 前回あって今回ないハンドラを削除
    for (const [eventType, { fn }] of prevHandlers) {
        if (!nextHandlerTypes.has(eventType)) {
            el.removeEventListener(eventType, fn);
            prevHandlers.delete(eventType);
        }
    }
}

// ============================================================
// VNode の平坦化（Fragment / 配列 → リーフの配列）
// ============================================================

type FlatChild = string | VNode;

function _flatten(children: VNodeChild[]): FlatChild[] {
    const out: FlatChild[] = [];
    for (const c of children) {
        if (c === null || c === undefined || c === false || c === true) continue;
        if (typeof c === 'string') {
            out.push(c);
            continue;
        }
        if (typeof c === 'number') {
            out.push(String(c));
            continue;
        }
        if (Array.isArray(c)) {
            out.push(..._flatten(c));
            continue;
        }
        const v = c as VNode;
        if (v.type === FRAGMENT) {
            out.push(..._flatten(v.children));
            continue;
        }
        out.push(v);
    }
    return out;
}

// ============================================================
// DOM ノードの生成 / パッチ適用
// ============================================================

/**
 * `parent` 内の `oldNode` を `newChild` で差分更新する。
 * - 同タグ: 要素を再利用してプロパティと子を更新
 * - 異タグ / 型が違う: 置き換え
 * - newChild が null: oldNode を削除
 * @returns 更新後の DOM ノード（null の場合は削除済み）
 */
function _patchNode(
    parent: Node,
    oldNode: Node | null,
    newChild: FlatChild | null,
    sendAction: SendAction,
    isSvg: boolean,
): Node | null {
    // ── 削除 ──────────────────────────────────────────────────────
    if (newChild === null) {
        if (oldNode) parent.removeChild(oldNode);
        return null;
    }

    // ── テキストノード ─────────────────────────────────────────────
    if (typeof newChild === 'string') {
        if (oldNode?.nodeType === Node.TEXT_NODE) {
            if (oldNode.textContent !== newChild) oldNode.textContent = newChild;
            return oldNode;
        }
        const textNode = document.createTextNode(newChild);
        if (oldNode) parent.replaceChild(textNode, oldNode);
        else parent.appendChild(textNode);
        return textNode;
    }

    // ── VNode ──────────────────────────────────────────────────────
    const vnode = newChild;
    // Fragment が _flatten をすり抜けた場合（防御的処理）
    if (vnode.type === FRAGMENT) {
        if (oldNode) parent.removeChild(oldNode);
        const flat = _flatten(vnode.children);
        for (const c of flat) _patchNode(parent, null, c, sendAction, isSvg);
        return null;
    }

    if (!ALLOWED_TAGS.has(vnode.type)) {
        console.warn(`[VNodeRenderer] 許可されていないタグ: <${vnode.type}>`);
        if (oldNode) parent.removeChild(oldNode);
        return null;
    }

    const inSvg = isSvg || SVG_TAGS.has(vnode.type);

    // 同タグ要素が既存: パッチ適用
    if (oldNode?.nodeType === Node.ELEMENT_NODE) {
        const oldEl = oldNode as Element;
        if (oldEl.tagName.toLowerCase() === vnode.type) {
            _patchProps(oldEl, vnode.props, sendAction, inSvg);
            _patchChildren(oldEl, vnode.children, sendAction, inSvg);
            return oldEl;
        }
    }

    // 新規作成 / 置き換え
    const newEl: Element = inSvg ? document.createElementNS(SVG_NS, vnode.type) : document.createElement(vnode.type);
    _patchProps(newEl, vnode.props, sendAction, inSvg);
    _patchChildren(newEl, vnode.children, sendAction, inSvg);
    if (oldNode) parent.replaceChild(newEl, oldNode);
    else parent.appendChild(newEl);
    return newEl;
}

/**
 * `parent` の子ノード群を `newChildren` で差分更新する。
 * Fragment / 配列はあらかじめ平坦化してから位置ベースでマッチする。
 */
function _patchChildren(parent: Element, newChildren: VNodeChild[], sendAction: SendAction, inSvg: boolean): void {
    const flat = _flatten(newChildren);
    const oldNodes = Array.from(parent.childNodes) as Node[];

    const len = Math.max(flat.length, oldNodes.length);
    for (let i = 0; i < len; i++) {
        const old = oldNodes[i] ?? null;
        const next = flat[i] ?? null;
        _patchNode(parent, old, next, sendAction, inSvg);
    }
}

// ============================================================
// 公開 API
// ============================================================

/**
 * VNode をリアル DOM に変換してコンテナへ差分適用する。
 *
 * @param vnode      描画する VNode（null の場合はコンテナを空にする）
 * @param container  注入先の DOM 要素
 * @param sendAction onUbi* イベント発火時に呼ぶコールバック
 */
export function renderVNode(vnode: VNode | null, container: HTMLElement, sendAction: SendAction): void {
    if (vnode === null) {
        container.textContent = '';
        return;
    }
    // ルートが Fragment の場合は子を直接コンテナにパッチ
    if (vnode.type === FRAGMENT) {
        _patchChildren(container, vnode.children, sendAction, false);
        return;
    }
    // 通常: コンテナの直下にルート要素 1 つ
    const firstChild = container.firstChild as Node | null;
    _patchNode(container, firstChild, vnode, sendAction, false);
    // ルート以降の余分なノードを削除
    while (container.childNodes.length > 1) {
        const lastChild = container.lastChild;
        if (!lastChild) break;
        container.removeChild(lastChild);
    }
}
