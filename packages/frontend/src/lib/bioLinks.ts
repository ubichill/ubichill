export type BioSegment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

// 空白・全角の句読点やかっこで URL は終わる（日本語の文に続けて書かれても巻き込まない）
const URL_PATTERN = /https?:\/\/[^\s<>"'`、。，．「」『』（）【】＜＞]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?'"*_~]+$/;

/** 末尾の句読点と、対応する "(" のない ")" は URL に含めない（「(https://example.com)」など）。 */
function trimUrl(raw: string): string {
    const withoutPunctuation = raw.replace(TRAILING_PUNCTUATION, '');
    const opens = (withoutPunctuation.match(/\(/g) ?? []).length;
    const closes = (withoutPunctuation.match(/\)/g) ?? []).length;
    if (withoutPunctuation.endsWith(')') && closes > opens) return trimUrl(withoutPunctuation.slice(0, -1));
    return withoutPunctuation;
}

function safeHref(text: string): string | null {
    try {
        const url = new URL(text);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

/** 自己紹介を文字とリンクに分ける。リンクにするのは http(s) の URL だけ。 */
export function bioSegments(bio: string): BioSegment[] {
    const matches = [...bio.matchAll(URL_PATTERN)].flatMap((m) => {
        const text = trimUrl(m[0]);
        const href = safeHref(text);
        return href ? [{ start: m.index, end: m.index + text.length, text, href }] : [];
    });
    const pieces = matches.flatMap((m, i) => {
        const prevEnd = i === 0 ? 0 : matches[i - 1].end;
        const before = bio.slice(prevEnd, m.start);
        const link: BioSegment = { kind: 'link', text: m.text, href: m.href };
        return before ? [{ kind: 'text' as const, text: before }, link] : [link];
    });
    const rest = bio.slice(matches.at(-1)?.end ?? 0);
    return rest ? [...pieces, { kind: 'text', text: rest }] : pieces;
}
