/**
 * `world.html` が置かれた場所から、入るインスタンスと動かし方を読む純粋な関数。
 * 設定ファイルは持たない: Go と `/mods` は同じオリジンにある前提で、URL のパスだけを見る。
 */

/** `/` なら `default`、`/<id>` ならその ID（末尾のスラッシュ・`world.html` は無視する）。 */
export function instanceIdFromPath(pathname: string): string {
    const segments = pathname.split('/').filter((s) => s.length > 0 && s !== 'world.html');
    const last = segments.at(-1);
    return last ? decodeURIComponent(last) : 'default';
}

/**
 * dev サーバーが配る `world.html` だけが `<meta name="ubichill-dev">` を持つ。
 * URL のクエリでは有効にしない（他人のリンクで、署名の無い mod を動かせる状態にされないため）。
 */
export function readDevMeta(doc: Pick<Document, 'querySelector'>): boolean {
    return doc.querySelector('meta[name="ubichill-dev"]') !== null;
}
