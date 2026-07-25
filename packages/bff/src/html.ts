/**
 * BFF が SSR で HTML を組み立てる際の共通エスケープユーティリティ。
 * 以前は index.ts と worldShell.ts に別々の esc/escAttr が散在し、
 * 片方がシングルクォート未対応という差異があったため 1 箇所へ集約した。
 */

/**
 * HTML テキスト・属性値の両方で安全なエスケープ。
 * 属性はダブル/シングルどちらのクォートでも壊れないよう `"` `'` の両方を潰す。
 */
export function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * `<script type="application/ld+json">` に埋め込む JSON をエスケープする。
 * JSON.stringify は `/` を素通しするため、値に `</script>` が含まれると
 * スクリプト要素を閉じて任意コードを注入できてしまう（displayName 等は攻撃者制御）。
 * `<` を `<` にすることで `</script>` ブレイクアウトを塞ぐ。
 * U+2028/2029 は JSON では合法だが JS 文字列リテラルでは改行扱いになるため併せて潰す。
 */
export function escJsonForScript(json: string): string {
    return json
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
