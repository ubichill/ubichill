/**
 * 公式アカウント（ID `ubichill`）をサーバー起動時に用意する。公式ワールドの作者とこのサーバーの管理者を兼ねる。
 *
 * - ログイン用メール: env OFFICIAL_ACCOUNT_EMAIL（既定 ubichill@ubichill.com）
 * - 初期パスワード: env OFFICIAL_ACCOUNT_INITIAL_PASSWORD。開発環境では既定値を使う。
 *   本番で未設定ならログインできるアカウントは作らず警告だけ出す（推測できるパスワードで作らない）。
 *   作成時は「初期パスワードのまま」にし、ログイン後に変更を促す。
 * - 署名公開鍵: worlds/trusted-authors.json に記録した公式の鍵を最初から登録する（WebFinger で公開される）。
 */
import { displayNameKey, OFFICIAL_HANDLE } from '@ubichill/shared';

export const DEV_INITIAL_PASSWORD = 'ubichill-dev-password';
const OFFICIAL_DISPLAY_NAME = 'Ubichill';

export interface OfficialAccountConfig {
    email: string;
    /** undefined ならアカウントを新規作成しない（本番で初期パスワード未設定）。 */
    initialPassword: string | undefined;
}

export function officialAccountConfig(env: NodeJS.ProcessEnv): OfficialAccountConfig {
    const password = env.OFFICIAL_ACCOUNT_INITIAL_PASSWORD?.trim();
    return {
        email: env.OFFICIAL_ACCOUNT_EMAIL?.trim() || 'ubichill@ubichill.com',
        initialPassword: password || (env.NODE_ENV === 'production' ? undefined : DEV_INITIAL_PASSWORD),
    };
}

interface ExistingUser {
    id: string;
    handle: string | null;
    signingPublicKey: string | null;
}

export interface OfficialAccountDeps {
    findByHandle: (handle: string) => Promise<ExistingUser | undefined>;
    findByEmail: (email: string) => Promise<ExistingUser | undefined>;
    /** パスワード付きでアカウントを作り、ID を返す（better-auth のパスワードハッシュを使う）。 */
    signUp: (email: string, password: string, name: string) => Promise<string>;
    isDisplayNameTaken: (key: string) => Promise<boolean>;
    initialize: (
        id: string,
        fields: {
            handle?: string;
            name?: string;
            displayNameKey?: string | null;
            signingPublicKey?: string;
            emailVerified?: boolean;
            passwordChangeRequired?: boolean;
        },
    ) => Promise<void>;
    /** 公式ワールドの鍵（trusted-authors.json）。無ければ登録しない。 */
    officialPublicKey: string | undefined;
    log: (message: string) => void;
}

export type OfficialAccountOutcome = 'exists' | 'created' | 'attached' | 'skipped';

export async function ensureOfficialAccount(
    config: OfficialAccountConfig,
    deps: OfficialAccountDeps,
): Promise<OfficialAccountOutcome> {
    const existing = await deps.findByHandle(OFFICIAL_HANDLE);
    if (existing) {
        // 鍵が未登録なら公式の鍵を入れる（別の鍵が登録済みなら利用者の操作を尊重して触らない）
        if (!existing.signingPublicKey && deps.officialPublicKey) {
            await deps.initialize(existing.id, { signingPublicKey: deps.officialPublicKey });
        }
        return 'exists';
    }

    const key = displayNameKey(OFFICIAL_DISPLAY_NAME);
    const nameFields = (await deps.isDisplayNameTaken(key))
        ? { name: OFFICIAL_DISPLAY_NAME, displayNameKey: null }
        : { name: OFFICIAL_DISPLAY_NAME, displayNameKey: key };
    const keyFields = deps.officialPublicKey ? { signingPublicKey: deps.officialPublicKey } : {};

    // 同じメールのアカウントが既にあれば（手動で作った等）、それを公式アカウントにする
    const byEmail = await deps.findByEmail(config.email);
    if (byEmail) {
        if (byEmail.handle) {
            deps.log(`⚠ ${config.email} は別の ID（${byEmail.handle}）で登録済みのため公式アカウントにできません`);
            return 'skipped';
        }
        await deps.initialize(byEmail.id, {
            handle: OFFICIAL_HANDLE,
            ...nameFields,
            ...keyFields,
            emailVerified: true,
        });
        deps.log(`👑 既存のアカウント ${config.email} を公式アカウント（${OFFICIAL_HANDLE}）にしました`);
        return 'attached';
    }

    if (!config.initialPassword) {
        deps.log(
            `⚠ OFFICIAL_ACCOUNT_INITIAL_PASSWORD が未設定のため公式アカウント（${OFFICIAL_HANDLE}）を作成しません。設定して再起動してください`,
        );
        return 'skipped';
    }
    const id = await deps.signUp(config.email, config.initialPassword, OFFICIAL_DISPLAY_NAME);
    await deps.initialize(id, {
        handle: OFFICIAL_HANDLE,
        ...nameFields,
        ...keyFields,
        emailVerified: true,
        passwordChangeRequired: true,
    });
    deps.log(
        `👑 公式アカウント（${OFFICIAL_HANDLE} / ${config.email}）を作成しました。ログインして初期パスワードを変更してください`,
    );
    return 'created';
}
