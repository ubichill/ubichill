/**
 * ほかの実装から来た HTML を、文字とタグの並びに分ける（表示はテキストとして行うので、タグは名前だけ読む）。
 * 正規表現でタグを探すと、閉じない `<` が続く入力で同じ範囲を何度も読み直す。ここは前から 1 度だけ読む（入力の長さに比例する）。
 */

export type HtmlToken = { kind: 'text'; text: string } | { kind: 'tag'; name: string; closing: boolean; raw: string };

const TAG_NAME = /^<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/;

function tagOf(raw: string): HtmlToken {
    // 名前は先頭の数十文字で決まる（長い属性を正規表現に渡さない）
    const match = TAG_NAME.exec(raw.slice(0, 64));
    return { kind: 'tag', name: match?.[2]?.toLowerCase() ?? '', closing: match?.[1] === '/', raw };
}

/** `<` から次の `>` までをタグにする。閉じない `<` から後ろは文字のまま。実体参照は戻さない。 */
export function tokenizeHtml(html: string): HtmlToken[] {
    const tokens: HtmlToken[] = [];
    const cursor = { at: 0 };
    while (cursor.at < html.length) {
        const open = html.indexOf('<', cursor.at);
        const close = open === -1 ? -1 : html.indexOf('>', open);
        if (close === -1) {
            tokens.push({ kind: 'text', text: html.slice(cursor.at) });
            break;
        }
        if (open > cursor.at) tokens.push({ kind: 'text', text: html.slice(cursor.at, open) });
        tokens.push(tagOf(html.slice(open, close + 1)));
        cursor.at = close + 1;
    }
    return tokens;
}
