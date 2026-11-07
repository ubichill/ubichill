/** ほかのサーバーから来た文字列を表示に使う形にする（タグと制御文字を除き、前後の空白を落とし、max 文字に切る）。 */
export function displayText(text: string | null | undefined, max: number): string | null {
    const withoutTags = text?.replace(/<[^>]*>/g, '');
    const clean = Array.from(withoutTags ?? '')
        .filter((c) => {
            const code = c.charCodeAt(0);
            return code >= 0x20 && code !== 0x7f;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    return clean ? Array.from(clean).slice(0, max).join('') : null;
}
