import { createAuthClient } from 'better-auth/react';
import { botCheckHeaders } from '@/lib/account/botProtection';
import { getApiBase } from '@/lib/api';

const API_BASE = getApiBase();

export { API_BASE };

export const authClient = createAuthClient({
    baseURL: API_BASE,
});

export const { signIn, signOut, useSession } = authClient;

// カスタム登録フロー: 仮登録（OTP送信）
export const registerWithOTP = async (
    email: string,
    password: string,
    displayName: string,
    handle: string,
    /** ボット対策を確かめたトークン（使わないサーバーでは null） */
    botToken: string | null,
): Promise<{
    success: boolean;
    error?: string;
    /** 失敗の種類（ボット対策の失敗なら shared の BOT_CHECK_ERRORS のキー） */
    code?: string;
    skipVerification?: boolean;
    /** そのままログインした（メール確認を飛ばしたとき） */
    signedIn?: boolean;
    message?: string;
    /** 確認と再送信に使う。仮登録はメールアドレスではなくこの ID で引く。 */
    registrationId?: string;
}> => {
    try {
        const res = await fetch(`${API_BASE}/api/v1/users/register`, {
            method: 'POST',
            // メール確認を飛ばすサーバーでは、そのままログインする（セッションのクッキーを受け取る）
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...botCheckHeaders(botToken) },
            body: JSON.stringify({ email, password, displayName, handle }),
        });
        const data = await res.json();
        if (!res.ok) {
            return { success: false, error: data.error || '登録に失敗しました', code: data.code };
        }
        return {
            success: true,
            skipVerification: data.skipVerification,
            signedIn: data.signedIn === true,
            message: data.message,
            registrationId: data.registrationId,
        };
    } catch {
        return { success: false, error: '通信エラーが発生しました' };
    }
};

// カスタム登録フロー: OTP検証して本登録し、そのままログインする
export const verifyOTPAndRegister = async (
    registrationId: string,
    otp: string,
): Promise<{ success: boolean; error?: string; signedIn?: boolean }> => {
    try {
        const res = await fetch(`${API_BASE}/api/v1/users/verify`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registrationId, otp }),
        });
        const data = await res.json();
        if (!res.ok) {
            return { success: false, error: data.error || '認証に失敗しました' };
        }
        return { success: true, signedIn: data.signedIn === true };
    } catch {
        return { success: false, error: '通信エラーが発生しました' };
    }
};

// OTP再送信
export const resendOTP = async (registrationId: string): Promise<{ success: boolean; error?: string }> => {
    try {
        const res = await fetch(`${API_BASE}/api/v1/users/resend-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registrationId }),
        });
        const data = await res.json();
        if (!res.ok) {
            return { success: false, error: data.error || '再送信に失敗しました' };
        }
        return { success: true };
    } catch {
        return { success: false, error: '通信エラーが発生しました' };
    }
};
