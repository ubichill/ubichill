/**
 * YouTube の URL / 動画ID を扱う純関数群。
 * controls / playlist の両 worker から使う。
 */

/**
 * 入力が YouTube の URL でも生の動画 ID でも、動画 ID を取り出す。
 * 対応: watch?v=、youtu.be/、/live/・/embed/・/shorts/。それ以外はそのまま返す。
 */
export function extractVideoId(input: string): string {
    const s = (input ?? '').trim();
    const m =
        /[?&]v=([\w-]{6,20})/.exec(s) ??
        /youtu\.be\/([\w-]{6,20})/.exec(s) ??
        /youtube\.com\/(?:live|embed|shorts)\/([\w-]{6,20})/.exec(s);
    return m ? m[1] : s;
}

/**
 * 動画ID / URL からサムネイル URL を導出する。
 * 検索由来のトラックは thumbnail を持つが、エディタで URL/ID 直書きしたトラックは
 * 持たないので、これで補完する。空入力なら空文字。
 */
export function thumbnailUrl(idOrUrl: string): string {
    const id = extractVideoId(idOrUrl);
    return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '';
}
