/**
 * ボット対策（新規登録とパスワードでのログインで、ボットでないことを外部のサービスで確かめる）の、画面と backend が共有する形。
 * 管理者がコントロールパネルで、使うサービスとその鍵を決める。
 */

export const BOT_PROTECTION_PROVIDERS = ['turnstile', 'hcaptcha'] as const;

export type BotProtectionProvider = (typeof BOT_PROTECTION_PROVIDERS)[number];

export const BOT_PROTECTION_PROVIDER_LABELS: Readonly<Record<BotProtectionProvider, string>> = {
    turnstile: 'Cloudflare Turnstile',
    hcaptcha: 'hCaptcha',
};

export const isBotProtectionProvider = (value: unknown): value is BotProtectionProvider =>
    typeof value === 'string' && (BOT_PROTECTION_PROVIDERS as readonly string[]).includes(value);

/** 画面に渡す設定（サイトキーは公開の値）。ボット対策を使わないなら null。 */
export interface BotProtectionConfig {
    provider: BotProtectionProvider;
    siteKey: string;
}

/** コントロールパネルに出す今の設定。シークレットキーそのものは返さない。 */
export interface BotProtectionSettings {
    config: BotProtectionConfig | null;
    /** 保存したシークレットキーをサーバーの秘密で開けるか（秘密を入れ替えて古いものを外すと false） */
    secretReadable: boolean;
    updatedAt: string | null;
}

/** コントロールパネルから送る設定。`secret` を省くと保存済みのもの（同じサービスのときだけ）を使う。 */
export type BotProtectionUpdate =
    | { provider: null }
    | { provider: BotProtectionProvider; siteKey: string; secret?: string; token: string };

/** 確かめた結果（トークン）を送るヘッダー。 */
export const BOT_CHECK_HEADER = 'x-bot-check';

/**
 * 何のために確かめたか。Turnstile はトークンに入れて返すので、別の画面で取ったトークンを使い回させない。
 * 英数字・`-`・`_` で 32 文字まで（Turnstile の制約）。
 */
export const BOT_CHECK_ACTIONS = {
    /** パスワードでのログイン */
    signIn: 'sign-in',
    signUp: 'sign-up',
    fediverseSignUp: 'fediverse-sign-up',
    /** コントロールパネルで、鍵の組が使えるかを確かめる */
    settings: 'bot-protection-settings',
} as const;

export type BotCheckAction = (typeof BOT_CHECK_ACTIONS)[keyof typeof BOT_CHECK_ACTIONS];

export const BOT_CHECK_ERRORS = {
    'bot-check-required': 'ボットでないことの確認を済ませてください',
    'bot-check-failed': 'ボットでないことを確かめられませんでした。もう一度お試しください',
    'bot-check-unavailable': 'ボット対策のサービスに接続できませんでした。しばらくしてからもう一度お試しください',
    'bot-check-misconfigured': 'ボット対策の設定に問題があり、続けられません。管理者に連絡してください',
} as const;

export type BotCheckError = keyof typeof BOT_CHECK_ERRORS;

export const isBotCheckError = (code: unknown): code is BotCheckError =>
    typeof code === 'string' && Object.hasOwn(BOT_CHECK_ERRORS, code);
