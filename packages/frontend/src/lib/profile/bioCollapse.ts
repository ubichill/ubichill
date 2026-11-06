/** 自己紹介を折りたたむ目安。隠れる分がわずか（minHiddenChars 以下）なら、ボタンを出すより全部見せる。 */
export const BIO_COLLAPSE = { maxLines: 4, maxChars: 140, minHiddenChars: 20 } as const;

/**
 * 自己紹介を最初は折りたたむか（行数・文字数のどちらかが目安を超えたら「続きを読む」にする）。
 * 折りたたまないものは画面でも切り詰めない（ボタンなしで文が隠れることが無いように）。
 */
export function shouldCollapseBio(
    bio: string,
    limits: { maxLines: number; maxChars: number; minHiddenChars: number } = BIO_COLLAPSE,
): boolean {
    const text = bio.replace(/\r\n?/g, '\n').trim();
    if (text === '') return false;
    const lines = text.split('\n').length;
    const chars = Array.from(text.replace(/\n/g, '')).length;
    return lines > limits.maxLines || chars > limits.maxChars + limits.minHiddenChars;
}
