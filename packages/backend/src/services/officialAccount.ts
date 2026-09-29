/**
 * 公式アカウント（ID `ubichill`）をサーバー起動時に用意する。公式ワールドの作者とこのサーバーの管理者を兼ねる。
 *
 * パスワードは Secret（env OFFICIAL_ACCOUNT_PASSWORD）が常に正で、起動のたびにその値へ合わせる。
 * 変更は Secret を差し替えて再デプロイするだけで、画面からは変更できない（変えても次の起動で戻るため）。
 * 値が変わったときだけ既存のログインをすべて無効にする。
 *
 * - ログイン用メール: env OFFICIAL_ACCOUNT_EMAIL（既定 ubichill@ubichill.com）
 * - 開発環境で未設定なら公開済みの既定値を使い、「既定のパスワードのまま」と表示して設定を促す。
 *   本番で未設定ならアカウントは作らず、既存のパスワードにも触れない（警告のみ）。
 * - 公開環境: worlds/trusted-authors.json に記録した公式の鍵に合わせる（鍵一覧としてほかのサーバーへ公開される）。
 */
import { displayNameKey, OFFICIAL_HANDLE } from '@ubichill/shared';

export const DEV_DEFAULT_PASSWORD = 'ubichill-dev-password';
const OFFICIAL_DISPLAY_NAME = 'Ubichill';

export interface OfficialAccountConfig {
    email: string;
    /** undefined なら作成もパスワードの同期もしない（本番で Secret 未設定）。 */
    password: string | undefined;
    /** 公開済みの開発用既定値を使っている（設定を促す）。 */
    usingDevDefault: boolean;
}

export function officialAccountConfig(env: NodeJS.ProcessEnv): OfficialAccountConfig {
    const password = env.OFFICIAL_ACCOUNT_PASSWORD?.trim();
    const useDevDefault = !password && env.NODE_ENV !== 'production';
    return {
        email: env.OFFICIAL_ACCOUNT_EMAIL?.trim() || 'ubichill@ubichill.com',
        password: password || (useDevDefault ? DEV_DEFAULT_PASSWORD : undefined),
        usingDevDefault: useDevDefault,
    };
}

interface ExistingUser {
    id: string;
    handle: string | null;
    passwordChangeRequired: boolean;
}

export interface OfficialAccountDeps {
    findByHandle: (handle: string) => Promise<ExistingUser | undefined>;
    findByEmail: (email: string) => Promise<ExistingUser | undefined>;
    /** パスワード付きでアカウントを作り、ID を返す（better-auth のパスワードハッシュを使う）。 */
    signUp: (email: string, password: string, name: string) => Promise<string>;
    /** 保存済みのパスワードと一致するか（パスワードが無ければ false）。 */
    passwordMatches: (userId: string, password: string) => Promise<boolean>;
    /** パスワードを置き換え、既存のログインをすべて無効にする。 */
    replacePassword: (userId: string, password: string) => Promise<void>;
    isDisplayNameTaken: (key: string) => Promise<boolean>;
    initialize: (
        id: string,
        fields: {
            handle?: string;
            name?: string;
            displayNameKey?: string | null;
            emailVerified?: boolean;
            passwordChangeRequired?: boolean;
        },
    ) => Promise<void>;
    /** 公開環境を trusted-authors.json の記録に合わせる。 */
    syncSigningKeys: (userId: string) => Promise<void>;
    log: (message: string) => void;
}

export type OfficialAccountOutcome = 'unchanged' | 'synced' | 'created' | 'attached' | 'skipped';

/** パスワードを Secret の値に合わせる。変わったときだけ置き換えてログインを無効にする。 */
async function syncPassword(
    user: ExistingUser,
    config: OfficialAccountConfig,
    deps: OfficialAccountDeps,
): Promise<boolean> {
    if (!config.password) {
        deps.log('⚠ OFFICIAL_ACCOUNT_PASSWORD が未設定のため、公式アカウントのパスワードを同期しません');
        return false;
    }
    if (await deps.passwordMatches(user.id, config.password)) return false;
    await deps.replacePassword(user.id, config.password);
    deps.log('🔑 公式アカウントのパスワードを Secret の値に合わせました（既存のログインは無効にしました）');
    return true;
}

export async function ensureOfficialAccount(
    config: OfficialAccountConfig,
    deps: OfficialAccountDeps,
): Promise<OfficialAccountOutcome> {
    const existing = await deps.findByHandle(OFFICIAL_HANDLE);
    if (existing) {
        const changed = await syncPassword(existing, config, deps);
        if (existing.passwordChangeRequired !== config.usingDevDefault) {
            await deps.initialize(existing.id, { passwordChangeRequired: config.usingDevDefault });
        }
        await deps.syncSigningKeys(existing.id);
        return changed ? 'synced' : 'unchanged';
    }

    const key = displayNameKey(OFFICIAL_DISPLAY_NAME);
    const nameFields = {
        name: OFFICIAL_DISPLAY_NAME,
        displayNameKey: (await deps.isDisplayNameTaken(key)) ? null : key,
    };

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
            emailVerified: true,
            passwordChangeRequired: config.usingDevDefault,
        });
        await syncPassword(byEmail, config, deps);
        await deps.syncSigningKeys(byEmail.id);
        deps.log(`👑 既存のアカウント ${config.email} を公式アカウント（${OFFICIAL_HANDLE}）にしました`);
        return 'attached';
    }

    if (!config.password) {
        deps.log(
            `⚠ OFFICIAL_ACCOUNT_PASSWORD が未設定のため公式アカウント（${OFFICIAL_HANDLE}）を作成しません。設定して再起動してください`,
        );
        return 'skipped';
    }
    const id = await deps.signUp(config.email, config.password, OFFICIAL_DISPLAY_NAME);
    await deps.initialize(id, {
        handle: OFFICIAL_HANDLE,
        ...nameFields,
        emailVerified: true,
        passwordChangeRequired: config.usingDevDefault,
    });
    await deps.syncSigningKeys(id);
    deps.log(`👑 公式アカウント（${OFFICIAL_HANDLE} / ${config.email}）を作成しました`);
    return 'created';
}
