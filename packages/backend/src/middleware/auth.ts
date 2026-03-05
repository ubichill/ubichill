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
            headers: new Headers(
                Object.entries(req.headers).reduce(
                    (acc, [key, value]) => {
                        if (value) acc[key] = Array.isArray(value) ? value.join(', ') : value;
                        return acc;
                    },
                    {} as Record<string, string>,
                ),
            ),
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
            headers: new Headers(
                Object.entries(req.headers).reduce(
                    (acc, [key, value]) => {
                        if (value) acc[key] = Array.isArray(value) ? value.join(', ') : value;
                        return acc;
                    },
                    {} as Record<string, string>,
                ),
            ),
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
