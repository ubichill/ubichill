/**
 * ボット対策（Turnstile・hCaptcha）のウィジェット。サービスのスクリプトは使うときに初めて読み込む
 * （ボット対策を使わないサーバーでは外部のスクリプトを読まない）。
 */
import {
    BOT_CHECK_HEADER,
    type BotCheckAction,
    type BotProtectionConfig,
    type BotProtectionProvider,
    isBotCheckError,
} from '@ubichill/shared';
import { API_BASE } from '@/lib/api';

/** 登録の画面に出すボット対策（使わないなら null）。 */
export async function fetchBotProtection(): Promise<BotProtectionConfig | null> {
    const res = await fetch(`${API_BASE}/api/v1/users/bot-protection`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`ボット対策の設定を読めませんでした（HTTP ${res.status}）`);
    const body = (await res.json()) as { config: BotProtectionConfig | null };
    return body.config;
}

/**
 * ボット対策で断られたか。断られたら設定を読み直す（画面を開いた後に管理者が変えた・最初に読めなかったときに、
 * 古いサイトキーのウィジェットのまま行き詰まらないように）。
 */
export const rejectedByBotCheck = (code: unknown): boolean => isBotCheckError(code);

/** 確かめた結果を送るヘッダー（トークンが無ければ付けない）。 */
export const botCheckHeaders = (token: string | null): Record<string, string> =>
    token ? { [BOT_CHECK_HEADER]: token } : {};

/** Turnstile と hCaptcha のスクリプトが置く口（使う分だけ）。 */
export interface BotWidgetApi {
    render(container: HTMLElement, options: Record<string, unknown>): string;
    reset(widgetId: string): void;
    remove(widgetId: string): void;
}

const SCRIPTS: Readonly<Record<BotProtectionProvider, { src: string; global: string }>> = {
    turnstile: { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', global: 'turnstile' },
    hcaptcha: { src: 'https://js.hcaptcha.com/1/api.js?render=explicit&recaptchacompat=off', global: 'hcaptcha' },
};

export interface BotWidgetHandlers {
    /** 確かめ終わった（トークン）・期限が切れた・失敗した（null） */
    onToken(token: string | null): void;
    onError(): void;
}

/** ウィジェットに渡す設定。サービスごとに名前が少し違う。 */
export function botWidgetOptions(
    config: BotProtectionConfig,
    action: BotCheckAction,
    handlers: BotWidgetHandlers,
): Record<string, unknown> {
    const common = {
        sitekey: config.siteKey,
        theme: 'light',
        callback: (token: unknown) => handlers.onToken(typeof token === 'string' && token ? token : null),
        'expired-callback': () => handlers.onToken(null),
        'error-callback': () => {
            handlers.onToken(null);
            handlers.onError();
        },
    };
    switch (config.provider) {
        case 'turnstile':
            return {
                ...common,
                action,
                size: 'flexible',
                language: 'auto',
                'timeout-callback': () => handlers.onToken(null),
            };
        case 'hcaptcha':
            return { ...common, 'chalexpired-callback': () => handlers.onToken(null) };
    }
}

const loading = new Map<BotProtectionProvider, Promise<BotWidgetApi>>();

/** サービスのスクリプトを 1 回だけ読み込む。失敗したら次に呼んだときに読み直す。 */
export function loadBotWidget(provider: BotProtectionProvider): Promise<BotWidgetApi> {
    const cached = loading.get(provider);
    if (cached) return cached;
    const { src, global } = SCRIPTS[provider];
    const api = () => (window as unknown as Record<string, BotWidgetApi | undefined>)[global];
    const promise = new Promise<BotWidgetApi>((resolve, reject) => {
        const ready = api();
        if (ready) return resolve(ready);
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            const loaded = api();
            if (loaded) resolve(loaded);
            else reject(new Error('ボット対策のスクリプトが読み込めませんでした'));
        };
        script.onerror = () => {
            script.remove();
            reject(new Error('ボット対策のスクリプトが読み込めませんでした'));
        };
        document.head.append(script);
    });
    promise.catch(() => loading.delete(provider));
    loading.set(provider, promise);
    return promise;
}
