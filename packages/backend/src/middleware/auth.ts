import { userRepository } from '@ubichill/db';
import { OFFICIAL_HANDLE } from '@ubichill/shared';
import type { NextFunction, Request, Response } from 'express';
import { auth } from '../lib/auth';

// Extend Express Request type with user info
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                email: string;
                name: string;
                emailVerified: boolean;
                image?: string | null;
            };
            session?: {
                id: string;
                userId: string;
                token: string;
                expiresAt: Date;
            };
        }
    }
}

/**
 * 認証必須ミドルウェア
 * セッションがない場合は401を返す
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const session = await auth.api.getSession({
            headers: toWebHeaders(req),
        });

        if (!session) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // リクエストにユーザー情報を追加
        req.user = {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            emailVerified: session.user.emailVerified,
            image: session.user.image,
        };
        req.session = {
            id: session.session.id,
            userId: session.session.userId,
            token: session.session.token,
            expiresAt: session.session.expiresAt,
        };

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(401).json({ error: 'Unauthorized' });
    }
}

/**
 * オプション認証ミドルウェア
 * セッションがあればユーザー情報を追加、なくても通過
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
        const session = await auth.api.getSession({
            headers: toWebHeaders(req),
        });

        if (session) {
            req.user = {
                id: session.user.id,
                email: session.user.email,
                name: session.user.name,
                emailVerified: session.user.emailVerified,
                image: session.user.image,
            };
            req.session = {
                id: session.session.id,
                userId: session.session.userId,
                token: session.session.token,
                expiresAt: session.session.expiresAt,
            };
        }

        next();
    } catch {
        // 認証失敗しても通過
        next();
    }
}

/** Node（Express）のリクエストヘッダを better-auth に渡す Headers に変換する。 */
export function toWebHeaders(req: Request): Headers {
    return new Headers(
        Object.entries(req.headers).reduce(
            (acc, [key, value]) => {
                if (value) acc[key] = Array.isArray(value) ? value.join(', ') : value;
                return acc;
            },
            {} as Record<string, string>,
        ),
    );
}

/** このサーバーの管理者か（公式アカウント `ubichill` が管理者を兼ねる）。 */
export function isAdminHandle(handle: string | null | undefined): boolean {
    return handle === OFFICIAL_HANDLE;
}

/**
 * 公式アカウントのパスワードは Secret（OFFICIAL_ACCOUNT_PASSWORD）が正で、起動のたびに合わせ直す。
 * 画面や better-auth の /change-password から変えても次の起動で戻るだけなので、変更そのものを受け付けない。
 */
export async function blockOfficialPasswordChange(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const session = await auth.api.getSession({ headers: toWebHeaders(req) });
        const user = session ? await userRepository.findById(session.user.id) : undefined;
        if (user?.handle === OFFICIAL_HANDLE) {
            res.status(403).json({
                error: '公式アカウントのパスワードはサーバーの設定（OFFICIAL_ACCOUNT_PASSWORD）で管理されています',
            });
            return;
        }
    } catch {
        // セッションを確かめられなければ本来の処理（better-auth）に任せる
    }
    next();
}

/**
 * 管理者限定ミドルウェア（requireAuth の後に置く）。連合ピアの追加・削除やワールドの再読み込みなど、
 * サーバー全体に影響する操作に使う。
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    // 管理者の操作はクッキーキャッシュ（最大 5 分）を使わずに DB のセッションを確かめる。
    // 公式アカウントのパスワードを Secret で差し替えた直後（漏えい対応など）に古いログインで操作させないため。
    const session = await auth.api
        .getSession({ headers: toWebHeaders(req), query: { disableCookieCache: true } })
        .catch(() => null);
    if (!session) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const user = await userRepository.findById(session.user.id);
    if (!isAdminHandle(user?.handle)) {
        res.status(403).json({ error: 'Forbidden: 管理者のみ実行できます' });
        return;
    }
    next();
}
