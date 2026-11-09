/**
 * プロフィールの項目（リンク・話せる言語・ひとこと）を actor の文書に載せる・読む。
 * ほかの実装（Mastodon・Misskey）は `attachment` の PropertyValue を項目の表として出す。
 * ubichill どうしは拡張の語（`statusMessage`・`spokenLanguages`）で元の形に戻す。
 */
import { z } from 'zod';
import { PROFILE_STATUS_MAX_LENGTH, type ProfileField } from '../user/profile';
import { type ProfileLanguageCode, profileLanguageLabel, profileLanguagesView } from '../user/profileLanguages';
import { MAX_PROFILE_LINKS, PROFILE_LINK_LABELS, type ProfileLink, parseProfileLink } from '../user/profileLinks';
import { displayText, escapeHtml } from './text';
import { parseFederationUrl } from './urls';

export interface LocalProfileFields {
    status: string | null;
    links: readonly ProfileLink[];
    languages: readonly string[];
}

export interface PropertyValue {
    type: 'PropertyValue';
    name: string;
    value: string;
}

export const PROFILE_FIELD_NAMES = { languages: '話せる言語', status: 'ひとこと' } as const;

const linkName = (link: ProfileLink): string =>
    link.kind === 'website' ? (parseFederationUrl(link.url)?.hostname ?? link.url) : PROFILE_LINK_LABELS[link.kind];

/** 表に出す URL（スキームと末尾の / を落とす）。 */
const shortUrl = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** ほかの実装が出す項目の表（リンク → 話せる言語 → ひとこと）。リンクは rel="me"（Mastodon の確認済みリンク）。 */
export function profileAttachment(fields: LocalProfileFields): PropertyValue[] {
    const field = (name: string, value: string): PropertyValue => ({ type: 'PropertyValue', name, value });
    return [
        ...fields.links.map((link) =>
            field(
                linkName(link),
                `<a href="${escapeHtml(link.url)}" rel="me nofollow noopener" target="_blank">${escapeHtml(shortUrl(link.url))}</a>`,
            ),
        ),
        ...(fields.languages.length > 0
            ? [field(PROFILE_FIELD_NAMES.languages, escapeHtml(fields.languages.map(profileLanguageLabel).join(' / ')))]
            : []),
        ...(fields.status ? [field(PROFILE_FIELD_NAMES.status, escapeHtml(fields.status))] : []),
    ];
}

/** ほかのサーバーの人の項目。href は値の中の最初のリンク（https のもの）。 */
export interface RemoteProfileField {
    name: string;
    value: string;
    href: string | null;
}

/** 読む項目の数（Misskey は 16 まで書ける）。 */
export const MAX_REMOTE_PROFILE_FIELDS = 16;
/** 項目の名前と値の長さ（取り込むときと、保存したものを読み出すときの両方で切る）。 */
export const REMOTE_PROFILE_FIELD_NAME_MAX = 50;
export const REMOTE_PROFILE_FIELD_VALUE_MAX = 200;

const PropertyValueSchema = z.object({ type: z.literal('PropertyValue'), name: z.string(), value: z.string() });

const HREF = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

const decodeAttribute = (value: string): string =>
    value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

function hrefOf(html: string): string | null {
    const match = HREF.exec(html);
    const raw = match ? decodeAttribute(match[1] ?? match[2] ?? '') : null;
    return raw ? (parseFederationUrl(raw)?.href ?? null) : null;
}

/** `attachment` の PropertyValue を読む（形の違うもの・空のものは飛ばす）。 */
export function readProfileAttachment(attachment: unknown): RemoteProfileField[] {
    const items = Array.isArray(attachment) ? attachment : attachment === undefined ? [] : [attachment];
    return items
        .flatMap((item): RemoteProfileField[] => {
            const parsed = PropertyValueSchema.safeParse(item);
            if (!parsed.success) return [];
            const name = displayText(parsed.data.name, REMOTE_PROFILE_FIELD_NAME_MAX);
            const value = displayText(parsed.data.value, REMOTE_PROFILE_FIELD_VALUE_MAX);
            return name && value ? [{ name, value, href: hrefOf(parsed.data.value) }] : [];
        })
        .slice(0, MAX_REMOTE_PROFILE_FIELDS);
}

/** ubichill の拡張の語（ほかの ubichill がひとことと話せる言語を元の形に戻す）。 */
export function profileExtensions(fields: Pick<LocalProfileFields, 'status' | 'languages'>): Record<string, unknown> {
    return {
        ...(fields.status ? { statusMessage: fields.status } : {}),
        ...(fields.languages.length > 0 ? { spokenLanguages: [...fields.languages] } : {}),
    };
}

/** 拡張の語を読む（知らない言語は捨てる）。 */
export function readProfileExtensions(doc: Record<string, unknown>): {
    statusMessage: string | null;
    spokenLanguages: string[];
} {
    return {
        statusMessage:
            typeof doc.statusMessage === 'string' ? displayText(doc.statusMessage, PROFILE_STATUS_MAX_LENGTH) : null,
        spokenLanguages: profileLanguagesView(doc.spokenLanguages),
    };
}

const StoredProfileSchema = z
    .object({
        fields: z.array(z.object({ name: z.string(), value: z.string(), href: z.string().nullable() })).catch([]),
        status: z.string().nullable().catch(null),
        languages: z.unknown(),
    })
    .partial();

type StoredProfile = z.infer<typeof StoredProfileSchema>;

const storedProfileOf = (stored: unknown): StoredProfile => {
    const parsed = StoredProfileSchema.safeParse(stored);
    return parsed.success ? parsed.data : {};
};

const statusOf = (profile: StoredProfile): string | null => displayText(profile.status, PROFILE_STATUS_MAX_LENGTH);

/** 保存した項目（remote_actors.profile）から、ひとことだけを確かめて取り出す（一覧のカードに出す）。 */
export const remoteStatusOf = (stored: unknown): string | null => statusOf(storedProfileOf(stored));

const clip = (text: string, max: number): string => Array.from(text).slice(0, max).join('').trim();

/**
 * 保存した項目を、取り込むときと同じ数と長さに切り直す（古い・壊れた行でもプロフィールを開けるように）。
 * 保存してあるのは取り込むときに整えた文字なので、タグを除く処理はもう一度かけない（文字の「<」を消してしまう）。
 */
function storedFieldsOf(fields: Array<{ name: string; value: string; href: string | null }> | undefined) {
    return (fields ?? []).slice(0, MAX_REMOTE_PROFILE_FIELDS).flatMap((field) => {
        const name = clip(field.name, REMOTE_PROFILE_FIELD_NAME_MAX);
        const value = clip(field.value, REMOTE_PROFILE_FIELD_VALUE_MAX);
        return name && value ? [{ name, value, href: field.href }] : [];
    });
}

/** ほかのサーバーの人のプロフィール（リンクにできない項目は表で出す）。 */
export interface RemoteProfileView {
    status: string | null;
    links: ProfileLink[];
    languages: ProfileLanguageCode[];
    fields: ProfileField[];
}

/**
 * 保存した項目（remote_actors.profile）を表示の形にする。保存した形は信用せず確かめ直す。
 * リンクの項目はプロフィールのリンク（5 件まで）にし、ubichill が載せたひとこと・話せる言語の項目は拡張の語と重なるので出さない。
 */
export function remoteProfileView(stored: unknown): RemoteProfileView {
    const profile = storedProfileOf(stored);
    const status = statusOf(profile);
    const languages = profileLanguagesView(profile.languages);
    const withLinks = storedFieldsOf(profile.fields).map((field) => {
        const parsedLink = field.href ? parseProfileLink(field.href) : null;
        return { field, link: parsedLink?.ok ? { url: parsedLink.url, kind: parsedLink.kind } : null };
    });
    const links = withLinks
        .flatMap(({ link }) => (link ? [link] : []))
        .filter((link, i, all) => all.findIndex((l) => l.url === link.url) === i)
        .slice(0, MAX_PROFILE_LINKS);
    const shown = new Set(links.map((l) => l.url));
    const duplicated = (name: string) =>
        (name === PROFILE_FIELD_NAMES.status && status !== null) ||
        (name === PROFILE_FIELD_NAMES.languages && languages.length > 0);
    return {
        status,
        links,
        languages,
        fields: withLinks
            .filter(({ field, link }) => !(link && shown.has(link.url)) && !duplicated(field.name))
            .map(({ field }) => ({ name: field.name, value: field.value }))
            .filter((f, i, all) => all.findIndex((g) => g.name === f.name && g.value === f.value) === i),
    };
}
