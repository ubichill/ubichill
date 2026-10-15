/**
 * mod が送る属性・スタイルの許可判定。VNode は信頼できない Worker から届くので、ここを通らない値は DOM に書かない。
 *
 * HTML と SVG で同じ規則を使う（SVG だけ素通しにすると `onclick` などのイベント属性が Host の window で実行される）。
 * 外部への取得を起こす値（`url()` やリンク先）は、mod の通信をドメイン承認に通すため、描画では許さないか同じ文書内の参照に限る。
 */

/** http(s) と Host が生成した data:image だけを通す。相対 URL はページのオリジンを指すので通す。 */
export function sanitizeUrl(url: string): string | null {
    if (url.startsWith('//')) return null;
    if (url.startsWith('data:image/')) return url;
    try {
        const { protocol } = new URL(url);
        return protocol === 'https:' || protocol === 'http:' ? url : null;
    } catch {
        // 相対 URL。`\` や制御文字でスキームを紛れ込ませる書き方は通さない
        return /^[\w\-./?#=&%~+]*$/.test(url) ? url : null;
    }
}

const HTML_ATTRS: ReadonlySet<string> = new Set([
    'id',
    'class',
    'title',
    'placeholder',
    'disabled',
    'type',
    'value',
    'checked',
    'selected',
    'href',
    'src',
    'alt',
    // 画像の軽量化・レイアウト安定用（modがサムネ等で使う）
    'loading',
    'decoding',
    'width',
    'height',
    'referrerpolicy',
    'colspan',
    'rowspan',
    'for',
    'name',
    'role',
    'tabindex',
    'min',
    'max',
    'step',
    'rows',
    'cols',
    'readonly',
    'maxlength',
    'fill',
    'stroke',
    'd',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'x1',
    'y1',
    'x2',
    'y2',
    'points',
    'transform',
    'viewBox',
    'preserveAspectRatio',
    'offset',
    'xmlns',
]);

const SVG_ATTRS: ReadonlySet<string> = new Set([
    'id',
    'class',
    'role',
    'tabindex',
    'xmlns',
    'transform',
    'viewBox',
    'preserveAspectRatio',
    'width',
    'height',
    'x',
    'y',
    'dx',
    'dy',
    'x1',
    'y1',
    'x2',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'fx',
    'fy',
    'fr',
    'd',
    'points',
    'pathLength',
    'offset',
    'fill',
    'fill-opacity',
    'fill-rule',
    'clip-rule',
    'clip-path',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-opacity',
    'opacity',
    'visibility',
    'display',
    'paint-order',
    'vector-effect',
    'shape-rendering',
    'stop-color',
    'stop-opacity',
    'gradientTransform',
    'gradientUnits',
    'spreadMethod',
    'patternTransform',
    'patternUnits',
    'patternContentUnits',
    'clipPathUnits',
    'markerWidth',
    'markerHeight',
    'markerUnits',
    'refX',
    'refY',
    'orient',
    'marker-start',
    'marker-mid',
    'marker-end',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'letter-spacing',
    'text-anchor',
    'dominant-baseline',
    'alignment-baseline',
    'textLength',
    'lengthAdjust',
    // <use> の参照先。同じ文書内（#id）に限る
    'href',
]);

const isDataOrAria = (key: string): boolean => /^(data|aria)-[a-z0-9-]+$/.test(key);

/** `url(#id)` 以外の url() と、それに化けうるエスケープを含む値か。 */
function referencesOutside(value: string): boolean {
    if (value.includes('\\')) return true;
    const refs = value.match(/url\s*\(/gi) ?? [];
    const localRefs = value.match(/url\(\s*['"]?#[\w-]+['"]?\s*\)/gi) ?? [];
    return refs.length !== localRefs.length;
}

/** HTML 要素の属性。通さないものは null。`tag` は小文字のタグ名。 */
export function sanitizeHtmlAttr(tag: string, key: string, value: string): string | null {
    if (!HTML_ATTRS.has(key) && !isDataOrAria(key)) return null;
    if (key === 'href' || key === 'src') return sanitizeUrl(value);
    // パスワード欄を描かせない（保存済みのパスワードが自動入力され、入力値として mod に渡るため）
    if (key === 'type' && tag === 'input' && value.trim().toLowerCase() === 'password') return null;
    return value;
}

/** SVG 要素の属性（ハイフン区切りに直したあとの名前）。通さないものは null。 */
export function sanitizeSvgAttr(key: string, value: string): string | null {
    if (!SVG_ATTRS.has(key) && !isDataOrAria(key)) return null;
    if (key === 'href') return /^#[\w-]+$/.test(value) ? value : null;
    if (referencesOutside(value)) return null;
    return value;
}

/** 外部の画像・フォントなどの取得を起こしうる CSS の関数。 */
const FETCHING_CSS = /(?:url|image|image-set|-webkit-image-set|cross-fade|element|src)\s*\(/i;

/** インラインスタイルの 1 宣言（ハイフン区切りの名前）。通さないものは null。 */
export function sanitizeStyle(property: string, value: string): string | null {
    if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(property)) return null;
    // `\` は CSS のエスケープ（u\72l( → url( など）に使える。`;` `{` は宣言の外へ出る書き方
    if (/[\\;{}<>]/.test(value)) return null;
    if (FETCHING_CSS.test(value)) return null;
    return value;
}
