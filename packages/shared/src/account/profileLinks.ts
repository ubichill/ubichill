/**
 * プロフィールのリンク（外部サービスへのリンク）の純粋な知識。画面と API で同じ規則を使う。
 *
 * - https だけ。資格情報入り・IP アドレス・ポート指定・ドメインでないホストは受け付けない。
 * - 保存するのは URL の正規形（`new URL().href`。国際化ドメインは punycode）。見た目の似た別ドメインは正規形で区別できる。
 * - 種類（アイコン）はホスト名から決める。保存せず表示のたびに決めるので、判定を直せば既存のリンクにも効く。
 */
import { z } from 'zod';

export const PROFILE_LINK_KINDS = [
    'github',
    'x',
    'youtube',
    'bluesky',
    'twitch',
    'pixiv',
    'booth',
    'vrchat',
    'website',
] as const;
export type ProfileLinkKind = (typeof PROFILE_LINK_KINDS)[number];

export const PROFILE_LINK_LABELS: Readonly<Record<ProfileLinkKind, string>> = {
    github: 'GitHub',
    x: 'X',
    youtube: 'YouTube',
    bluesky: 'Bluesky',
    twitch: 'Twitch',
    pixiv: 'pixiv',
    booth: 'BOOTH',
    vrchat: 'VRChat',
    website: 'Web サイト',
};

export const MAX_PROFILE_LINKS = 5;
export const PROFILE_LINK_MAX_LENGTH = 200;

export interface ProfileLink {
    /** 正規形の URL（https） */
    url: string;
    kind: ProfileLinkKind;
}

/** サブドメインも同じサービスとして扱う（booth のショップ・youtube の m. など）。 */
const SERVICE_DOMAINS: ReadonlyArray<{ kind: Exclude<ProfileLinkKind, 'website'>; domains: readonly string[] }> = [
    { kind: 'github', domains: ['github.com'] },
    { kind: 'x', domains: ['x.com', 'twitter.com'] },
    { kind: 'youtube', domains: ['youtube.com', 'youtu.be'] },
    { kind: 'bluesky', domains: ['bsky.app'] },
    { kind: 'twitch', domains: ['twitch.tv'] },
    { kind: 'pixiv', domains: ['pixiv.net', 'pixiv.me'] },
    { kind: 'booth', domains: ['booth.pm'] },
    { kind: 'vrchat', domains: ['vrchat.com', 'vrc.group'] },
];

interface ParsedUrl {
    href: string;
    protocol: string;
    username: string;
    password: string;
    hostname: string;
    port: string;
}
// shared は環境の型を持たないので、実行環境の URL（Node・ブラウザとも持つ）を最小の形で取り出す
const parseUrl = (input: string): ParsedUrl | null =>
    (globalThis as unknown as { URL: { parse(url: string): ParsedUrl | null } }).URL.parse(input);

const matchesDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** 正規形の URL のホスト名から種類を決める。読めない URL は website。 */
export function profileLinkKindOf(url: string): ProfileLinkKind {
    const host = parseUrl(url)?.hostname ?? '';
    return SERVICE_DOMAINS.find((s) => s.domains.some((d) => matchesDomain(host, d)))?.kind ?? 'website';
}

export type ProfileLinkParseResult = { ok: true; url: string; kind: ProfileLinkKind } | { ok: false; error: string };

/** 見えない書式文字（ゼロ幅・双方向の制御）。リンクの見た目と行き先をずらせるので断る。 */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2060, 0x2069],
    [0xfeff, 0xfeff],
];

const isForbiddenChar = (ch: string): boolean => {
    const code = ch.codePointAt(0) ?? 0;
    return (
        code <= 0x20 ||
        (code >= 0x7f && code <= 0x9f) ||
        /\s/u.test(ch) ||
        INVISIBLE_RANGES.some(([from, to]) => code >= from && code <= to)
    );
};

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;
const DOMAIN_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function hostProblem(hostname: string): string | null {
    if (hostname.startsWith('[') || IPV4_HOST.test(hostname)) return 'IP アドレスの URL は使えません';
    const labels = hostname.split('.');
    if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label)))
        return 'ドメイン名の URL にしてください';
    return null;
}

/**
 * 入力をリンクとして解釈する。`example.com/me` のようにスキームを省いたものは https として扱う。
 * 断る理由は画面にそのまま出せる文にする。
 */
export function parseProfileLink(input: string): ProfileLinkParseResult {
    const trimmed = input.trim();
    if (!trimmed) return { ok: false, error: 'URL を入力してください' };
    if (trimmed.length > PROFILE_LINK_MAX_LENGTH) {
        return { ok: false, error: `URL は ${PROFILE_LINK_MAX_LENGTH} 文字以内にしてください` };
    }
    // URL の解析は途中の改行・タブを黙って捨てる（`java\nscript:` が `javascript:` になる）ので、解析の前に断る
    if (Array.from(trimmed).some(isForbiddenChar)) return { ok: false, error: 'URL に空白や制御文字は使えません' };
    const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
    const url = parseUrl(candidate);
    if (!url) return { ok: false, error: 'URL の形式が正しくありません' };
    if (url.protocol !== 'https:') return { ok: false, error: 'https の URL だけ使えます' };
    if (url.username || url.password) return { ok: false, error: 'ユーザー名やパスワードを含む URL は使えません' };
    if (url.port) return { ok: false, error: 'ポート番号を含む URL は使えません' };
    const problem = hostProblem(url.hostname);
    if (problem) return { ok: false, error: problem };
    // 国際化ドメインは punycode になって長くなり得るので、保存する形でもう一度数える
    if (url.href.length > PROFILE_LINK_MAX_LENGTH) {
        return { ok: false, error: `URL は ${PROFILE_LINK_MAX_LENGTH} 文字以内にしてください` };
    }
    return { ok: true, url: url.href, kind: profileLinkKindOf(url.href) };
}

/** リンクの一覧（最大 {@link MAX_PROFILE_LINKS} 件・同じ URL は 1 回）。正規形の URL の配列にする。 */
export const ProfileLinksSchema = z
    .array(z.string())
    .max(MAX_PROFILE_LINKS, `リンクは ${MAX_PROFILE_LINKS} 件までです`)
    .transform((links, ctx) => {
        const parsed = links.map(parseProfileLink);
        parsed.forEach((p, i) => {
            if (!p.ok) ctx.addIssue({ code: 'custom', message: p.error, path: [i] });
            else if (parsed.slice(0, i).some((q) => q.ok && q.url === p.url)) {
                ctx.addIssue({ code: 'custom', message: '同じリンクが 2 回あります', path: [i] });
            }
        });
        return parsed.flatMap((p) => (p.ok ? [p.url] : []));
    });

/** 保存してあるリンク（jsonb）を表示用にする。今の規則で通らないものは出さない（規則を厳しくしたときの古いデータ）。 */
export function profileLinksView(stored: unknown): ProfileLink[] {
    if (!Array.isArray(stored)) return [];
    return stored
        .filter((v): v is string => typeof v === 'string')
        .map(parseProfileLink)
        .flatMap((p) => (p.ok ? [{ url: p.url, kind: p.kind }] : []))
        .slice(0, MAX_PROFILE_LINKS);
}
