/**
 * 自分の cursor 用の SVG 画像群と CSS 適用ヘルパ。
 *
 * **CSS `cursor: url(...)` を使う理由**:
 *  - OS のコンポジタが直接描画するので JS overlay 方式と違ってラグが出ない
 *  - browser が hover (button → pointer) / text (input → text I-beam) を自動判定して
 *    対応する画像に切り替えてくれる (CSS の `cursor: pointer` / `cursor: text` の
 *    プロパティ宣言に画像を割り当てる方式)
 *
 * リモートユーザーの cursor は overlay として CursorBundle で描画 (他人のは
 * OS cursor で出せないので JS で描画するしかない)。
 */

// ── SVG ソース (cursor 画像、24×24 程度のサイズが OS で扱いやすい) ─────────

const SVG_HEADER = 'xmlns="http://www.w3.org/2000/svg"';

const ARROW_SVG = `<svg ${SVG_HEADER} width="24" height="24" viewBox="0 0 24 24">
  <path d="M3 3 L3 19 L7.5 14.5 L10.5 21 L13 19.8 L10 13.5 L17 13 Z"
        fill="white" stroke="rgba(0,0,0,0.85)" stroke-width="1.4"
        stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
/** 矢印の先端 (画像内座標) */
const ARROW_HOTSPOT = { x: 3, y: 3 };

const POINTER_SVG = `<svg ${SVG_HEADER} width="22" height="26" viewBox="0 0 22 26">
  <path d="M9 2 Q9 1 10.5 1 Q12 1 12 2 L12 11 L14 11 Q15 11 15 12 L15 13 L16 13 Q17 13 17 14 L17 15 L18 15 Q19 15 19 16 L19 20 Q19 24 13 24 L9 24 Q4 24 4 19 L4 14 Q4 12 6 12 Q7 12 7 13 L7 14 L9 14 Z"
        fill="white" stroke="rgba(0,0,0,0.85)" stroke-width="1.4"
        stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
/** 人差し指の先端 */
const POINTER_HOTSPOT = { x: 11, y: 1 };

const TEXT_SVG = `<svg ${SVG_HEADER} width="20" height="24" viewBox="0 0 20 24">
  <path d="M6 2 H14 V4 H11 V20 H14 V22 H6 V20 H9 V4 H6 Z"
        fill="white" stroke="rgba(0,0,0,0.85)" stroke-width="1.4"
        stroke-linejoin="round"/>
</svg>`;
/** I-beam の中心 */
const TEXT_HOTSPOT = { x: 10, y: 12 };

// ── ヘルパ ────────────────────────────────────────────────────────────────

function svgToDataUri(svg: string): string {
    // encodeURIComponent: SVG 内の `<` `"` 等を CSS url() で安全な形にする
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** デフォルト矢印の data URI (cursorUrl 未設定時のフォールバック) */
export function defaultArrowDataUri(): string {
    return svgToDataUri(ARROW_SVG);
}

// ── CSS 注入 ─────────────────────────────────────────────────────────────

const STYLE_TAG_ID = 'ubichill-cursor-style';

/**
 * `<head>` に `<style id="ubichill-cursor-style">` を作成/更新する。
 *
 * - `arrowImageUrl`: 矢印用カーソル画像 (user.cursorUrl があればそれ、無ければ default arrow)
 * - pointer / text は固定の SVG (ホバー / テキスト入力カーソルを置換)
 *
 * `body` に基本 cursor を指定し、button / 入力欄に override する CSS を入れる。
 * セレクタが broader な場合 (`button`) はブラウザの cascade で自然に勝つ。
 */
export function applyCursorStyles(arrowImageUrl?: string | null): void {
    const arrowUri = arrowImageUrl ? `url("${arrowImageUrl}")` : svgToDataUri(ARROW_SVG);
    const pointerUri = svgToDataUri(POINTER_SVG);
    const textUri = svgToDataUri(TEXT_SVG);

    let style = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_TAG_ID;
        document.head.appendChild(style);
    }
    // セレクタは「ホバー時に pointer/text を出してほしい代表的な要素」を網羅。
    // ARIA role や input type 別の指定で input[type=button] が text にならないようにする。
    style.textContent = `
        body {
            cursor: ${arrowUri} ${ARROW_HOTSPOT.x} ${ARROW_HOTSPOT.y}, default;
        }
        button:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"]), [role="link"],
        summary, label[for], select:not(:disabled),
        input[type="button"], input[type="submit"], input[type="reset"],
        input[type="checkbox"]:not(:disabled), input[type="radio"]:not(:disabled),
        [data-clickable] {
            cursor: ${pointerUri} ${POINTER_HOTSPOT.x} ${POINTER_HOTSPOT.y}, pointer;
        }
        input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]),
        textarea, [contenteditable="true"] {
            cursor: ${textUri} ${TEXT_HOTSPOT.x} ${TEXT_HOTSPOT.y}, text;
        }
    `;
}

/** 注入したスタイルを除去 (CursorLayer のアンマウント時用、保険) */
export function removeCursorStyles(): void {
    const style = document.getElementById(STYLE_TAG_ID);
    style?.remove();
}
