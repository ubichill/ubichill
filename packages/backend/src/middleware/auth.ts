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

type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

function attachSession(req: Request, session: NonNullable<SessionResult>): void {
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

function authRequired(options: { fresh: boolean }) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const session = await auth.api.getSession({
                headers: toWebHeaders(req),
                ...(options.fresh ? { query: { disableCookieCache: true } } : {}),
            });
            if (!session) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            attachSession(req, session);
            next();
        } catch (error) {
            console.error('Auth middleware error:', error);
            res.status(401).json({ error: 'Unauthorized' });
        }
    };
}

/**
 * 認証必須ミドルウェア。セッションがない場合は 401。
 * セッションはクッキーキャッシュ（最大 5 分）で確かめるので、ログアウトさせたセッションも最大 5 分は通る。
 */
export const requireAuth = authRequired({ fresh: false });

/**
 * 認証必須ミドルウェア（DB のセッションを確かめる）。公開に関わる操作（公開環境の登録・取り消し、署名つきの保存、
 * ワールドの作成）に使う。乗っ取りに気付いてほかの端末をログアウトさせた直後から、攻撃者に鍵の登録や公開をさせない。
 */
export const requireFreshAuth = authRequired({ fresh: true });

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
