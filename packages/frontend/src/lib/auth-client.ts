import { createAuthClient } from 'better-auth/react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const authClient = createAuthClient({
    baseURL: API_BASE,
});

export const { signIn, signOut, useSession } = authClient;

// カスタム登録フロー: 仮登録（OTP送信）
export const registerWithOTP = async (
    email: string,
    password: string,
    username: string,
): Promise<{ success: boolean; error?: string }> => {
    try {
        const res = await fetch(`${API_BASE}/api/v1/users/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, username }),
        });
        const data = await res.json();
        if (!res.ok) {
            return { success: false, error: data.error || '登録に失敗しました' };
        }
        return { success: true };
    } catch {
        return { success: false, error: '通信エラーが発生しました' };
    }
};

// カスタム登録フロー: OTP検証して本登録
export const verifyOTPAndRegister = async (
    email: string,
    otp: string,
): Promise<{ success: boolean; error?: string }> => {
    try {
        const res = await fetch(`${API_BASE}/api/v1/users/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp }),
        });
        const data = await res.json();
        if (!res.ok) {
            return { success: false, error: data.error || '認証に失敗しました' };
        }
        return { success: true };
    } catch {
        return { success: false, error: '通信エラーが発生しました' };
    }
};

// OTP再送信
export const resendOTP = async (email: string): Promise<{ success: boolean; error?: string }> => {
    try {
        const res = await fetch(`${API_BASE}/api/v1/users/resend-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
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
