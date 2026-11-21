/**
 * 二段階認証（認証アプリとバックアップコード）の、画面と backend が共有する形。
 * 有効にすると、パスワードでもフェディバースでも、ログインのたびに認証アプリのコードを求める。
 */

/** 設定の「二段階認証」に出す状態。 */
export interface TwoFactorStatus {
    enabled: boolean;
    /** 残っているバックアップコードの数（有効でなければ 0） */
    backupCodesLeft: number;
}

/** 設定を始めたときに返す、認証アプリに登録する鍵。 */
export interface TwoFactorSetup {
    /** 手で入れるときの鍵（base32） */
    secret: string;
    /** QR コードにする otpauth:// の URI */
    uri: string;
}

/** 作ったバックアップコード（平文はこの 1 回だけ返す）。 */
export interface TwoFactorBackupCodes {
    backupCodes: string[];
}

/** ログインの二段階目を求めるときの応答（`/sign-in/email` などの代わりに返す）。 */
export interface TwoFactorRequired {
    twoFactorRequired: true;
}

/** ログインの二段階目を通ったときの応答。 */
export interface TwoFactorSignedIn {
    /** 戻る先（フェディバースのログインで覚えていたもの。無ければ null） */
    returnTo: string | null;
}

/** ログインの二段階目の失敗の種類。`challenge-expired` は最初からログインし直す。 */
export type TwoFactorSignInError = 'challenge-expired' | 'invalid-code' | 'locked';

/** ログインの途中に二段階目を求められたか（`/sign-in/email` の応答など）。 */
export function isTwoFactorRequired(value: unknown): value is TwoFactorRequired {
    return typeof value === 'object' && value !== null && (value as TwoFactorRequired).twoFactorRequired === true;
}
