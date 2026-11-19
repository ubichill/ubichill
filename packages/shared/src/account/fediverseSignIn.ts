/**
 * フェディバース（Mastodon・Misskey）のアカウントでのログインの純粋な知識。流れは docs/design/fediverse-sign-in.md。
 *
 * - 外部アカウントは「認証サーバーの origin と、そのサーバー内のユーザー ID」で識別する。ソフトウェアの種類は
 *   キーに含めない（判定の揺れや乗り換えで別人にしないため）。
 * - メールなしで登録したユーザーの users.email には、配送されない予約ドメインの内部値を入れる。
 *   連絡先として使ってよいかは必ず {@link contactEmailOf} で判定する。
 */
import { DISPLAY_NAME_MAX_LENGTH, DisplayNameSchema, HandleSchema, isServerDomain } from './handle';

export const FEDIVERSE_SOFTWARE = ['mastodon', 'misskey'] as const;
export type FediverseSoftware = (typeof FEDIVERSE_SOFTWARE)[number];

/** accounts.providerId の前置き。後ろは認証サーバーの origin（`https://host`）。 */
const PROVIDER_PREFIX = 'fediverse:';

interface ParsedUrl {
    host: string;
    pathname: string;
    search: string;
    hash: string;
    username: string;
    password: string;
}
// shared は環境の型を持たないので、実行環境の URL（Node・ブラウザとも持つ）を最小の形で取り出す
const parseUrl = (input: string): ParsedUrl | null =>
    (globalThis as unknown as { URL: { parse(url: string): ParsedUrl | null } }).URL.parse(input);

export function fediverseProviderId(origin: string): string {
    return `${PROVIDER_PREFIX}${origin}`;
}

/** accounts.providerId がフェディバースのものなら、認証サーバーのホストを返す。 */
export function fediverseHostOf(providerId: string): string | null {
    if (!providerId.startsWith(PROVIDER_PREFIX)) return null;
    return parseUrl(providerId.slice(PROVIDER_PREFIX.length))?.host || null;
}

/** メールなしユーザーの内部値の予約ドメイン（RFC 2606 の .invalid は配送されない）。 */
export const PLACEHOLDER_EMAIL_DOMAIN = 'sso.invalid';

export function placeholderEmail(token: string): string {
    return `${token.toLowerCase()}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string): boolean {
    return email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/** 登録・変更で受け付けないアドレス（予約ドメインは内部値と紛れるので、.invalid 全体を拒否する）。 */
export function isReservedEmail(email: string): boolean {
    return /\.invalid$/i.test(email.trim());
}

/** 通知や復旧に使ってよい連絡先。確認済みの実アドレスだけ。 */
export function contactEmailOf(user: { email: string; emailVerified: boolean }): string | null {
    return user.emailVerified && !isPlaceholderEmail(user.email) ? user.email : null;
}

/**
 * ログインに使うサーバーの入力（`example.com`・`https://example.com/`・`@user@example.com`・`user@example.com`）から
 * ホストを取り出す。小文字化し、IDN は punycode にする。
 */
export function parseFediverseServer(input: string): { ok: true; host: string } | { ok: false; error: string } {
    const raw = input.trim().replace(/^@/, '');
    if (!raw) return { ok: false, error: 'サーバーのドメインを入力してください' };
    const hasScheme = /^https?:\/\//i.test(raw);
    // スキームの無い `user@host` だけハンドルとして読む（URL の資格情報 `user:pass@host` と混同しない）
    const withScheme = hasScheme ? raw : `https://${raw.slice(raw.lastIndexOf('@') + 1)}`;
    const url = parseUrl(withScheme);
    const pathless = url && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
    if (!url || !pathless || !isServerDomain(url.host)) {
        return { ok: false, error: 'サーバーのドメインの形式が正しくありません（例: mastodon.social）' };
    }
    return { ok: true, host: url.host };
}

/** 外部のユーザー名から Ubichill の ID の候補を作る。作れなければ空文字（画面で入力してもらう）。 */
export function handleCandidateOf(username: string): string {
    const candidate = username
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 30);
    return HandleSchema.safeParse(candidate).success ? candidate : '';
}

/** 外部の表示名から表示名の候補を作る（使えなければユーザー名）。カスタム絵文字の `:name:` は外す。 */
export function displayNameCandidateOf(displayName: string | null, username: string): string {
    const cleaned = (displayName ?? '')
        .replace(/:[a-zA-Z0-9_]+:/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const candidate = Array.from(cleaned || username)
        .slice(0, DISPLAY_NAME_MAX_LENGTH)
        .join('');
    return DisplayNameSchema.safeParse(candidate).success
        ? candidate.trim()
        : username.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

/** ログイン後の戻り先。Ubichill 内の相対 URL だけ許し、ほかは `/`。 */
export function safeReturnTo(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length > 2000) return '/';
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
    if (Array.from(raw).some((ch) => (ch.codePointAt(0) ?? 0) < 0x20)) return '/';
    return raw;
}

/** ログインの開始で選ぶ操作。link はログイン中のユーザーに外部アカウントを追加する。 */
export type FediverseSignInIntent = 'sign-in' | 'link';

/** 認証から戻ったときに画面へ渡すエラーの種類（クエリの `fediverse_error`）。 */
export const FEDIVERSE_SIGN_IN_ERRORS = {
    disabled: 'フェディバースでのログインは無効になっています',
    'invalid-server': 'サーバーのドメインの形式が正しくありません（例: misskey.io）',
    'server-not-allowed': 'このサーバーのアカウントではログインできません',
    'unsupported-server': 'このサーバーには対応していません（Mastodon 4.3 以降・Misskey 系）',
    'server-unreachable': 'そのサーバーに接続できませんでした。ドメインを確かめて、時間をおいてもう一度お試しください',
    denied: 'ログインが取り消されました',
    expired: 'ログインの期限が切れました。もう一度お試しください',
    mismatch: 'ログインの応答を確かめられませんでした。もう一度お試しください',
    'linked-to-other': 'このアカウントは別のユーザーに追加されています',
    'session-changed': 'ログインの状態が変わったため追加できませんでした。もう一度お試しください',
    'reauth-required': 'ログイン方法を変えるには、もう一度本人確認が必要です',
    'not-allowed-for-account': 'このアカウントはフェディバースでのログインに使えません',
    'server-error': 'サーバーでの確認がうまくいきませんでした（混み合っていることがあります）。もう一度お試しください',
    'too-many-sign-ups': 'このサーバーからの新規登録が多すぎます。しばらくしてからお試しください',
    failed: 'ログインに失敗しました。もう一度お試しください',
} as const;
export type FediverseSignInError = keyof typeof FEDIVERSE_SIGN_IN_ERRORS;

/** 理由のコードが shared で知っているものか（知らないコードを「ログインに失敗」と言い換えず、そのまま扱うため）。 */
export function isFediverseSignInError(code: string | null): code is FediverseSignInError {
    return code !== null && Object.hasOwn(FEDIVERSE_SIGN_IN_ERRORS, code);
}

export function fediverseSignInErrorMessage(code: string | null): string | null {
    if (!code) return null;
    return code in FEDIVERSE_SIGN_IN_ERRORS
        ? FEDIVERSE_SIGN_IN_ERRORS[code as FediverseSignInError]
        : FEDIVERSE_SIGN_IN_ERRORS.failed;
}

/** 初回登録の画面に出す候補（外部アカウントの情報）。 */
export interface FediverseSignUpCandidate {
    server: string;
    username: string;
    handle: string;
    displayName: string;
    /** ログインを押したが、まだ登録していなかった */
    notRegistered: boolean;
    registrationOpen: boolean;
}

/** ログインの前に、選んだサーバーを見た目で確かめるための情報（公開されているものだけ）。 */
export interface FediverseServerInfo {
    host: string;
    software: FediverseSoftware;
    name: string | null;
    iconUrl: string | null;
}

/**
 * ログイン画面に並べるサーバー（ログインの判定に通ることを 2026-11 に確かめたもの）。
 * 運営が FEDIVERSE_SIGN_IN_SERVERS で使えるサーバーを限っているときは、そちらを並べる。
 */
export const FEATURED_FEDIVERSE_SERVERS: readonly string[] = [
    'misskey.io',
    'mstdn.jp',
    'mastodon.social',
    'misskey.niri.la',
];

/** 設定の「ログイン方法」。 */
export interface LoginMethods {
    password: boolean;
    /** 直近にログインか再認証をした（ログイン方法の追加・解除ができる） */
    recentlyAuthenticated: boolean;
    fediverse: Array<{
        id: string;
        server: string;
        username: string | null;
        software: FediverseSoftware | null;
        linkedAt: string;
        /** 今の設定（無効化・許可するサーバー・block）でログインに使えるか */
        usable: boolean;
    }>;
}
