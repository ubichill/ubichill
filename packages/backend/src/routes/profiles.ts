import {
    isProfileImageKind,
    PROFILE_IMAGE_CONTENT_TYPE,
    PROFILE_IMAGE_MAX_BYTES,
    profileImageHashOf,
} from '@ubichill/shared';
import express, { type ErrorRequestHandler, type RequestHandler, type Response, Router } from 'express';
import type { ProfileOutcome, ProfileService } from '../services/profiles/profiles';

export interface ProfilesRouterDeps {
    requireAuth: RequestHandler;
    /** プロフィールの更新・画像の削除 */
    writeLimiter: RequestHandler;
    /** 画像のアップロード（作り直しが重いので別に絞る） */
    uploadLimiter: RequestHandler;
    profiles: ProfileService;
    /** プロフィールが変わったあと（ほかのサーバーのフレンドに知らせる） */
    onChanged?: (userId: string) => void;
}

/** 内容のハッシュ入りの URL なので、同じ URL の中身は変わらない */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** 画像の URL を直接開かれても、文書として何も実行させない */
const IMAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const send = (res: Response, outcome: ProfileOutcome, onChanged?: () => void): void => {
    if (outcome.ok) {
        res.set('Cache-Control', 'no-store').json(outcome.profile);
        onChanged?.();
        return;
    }
    res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
};

const readImageBody = express.raw({ type: 'image/*', limit: PROFILE_IMAGE_MAX_BYTES });

const bodyErrors: ErrorRequestHandler = (err: unknown, _req, res, next) => {
    const type = typeof err === 'object' && err !== null && 'type' in err ? err.type : undefined;
    if (type === 'entity.too.large') {
        res.status(413).json({
            error: `画像は ${PROFILE_IMAGE_MAX_BYTES / 1024 / 1024} MB までです`,
            code: 'too-large',
        });
        return;
    }
    if (typeof type === 'string') {
        res.status(400).json({ error: '画像を受け取れませんでした', code: 'invalid' });
        return;
    }
    next(err);
};

/**
 * プロフィールの編集とプロフィール画像の配信（`/api/v1/users` の下）。
 * - `PUT /me/profile`: ひとこと・自己紹介・リンク・言語を置き換える
 * - `PUT /me/images/:kind`: 画像（本文は image/* のバイト列）を作り直して置き換える
 * - `DELETE /me/images/:kind`: 画像を外す
 * - `GET /:userId/images/:kind/:hash.webp`: 配信（ハッシュ入りの URL なので長く cache させる）
 */
export function createProfilesRouter(deps: ProfilesRouterDeps): Router {
    const router = Router();

    router.put('/me/profile', deps.requireAuth, deps.writeLimiter, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const userId = req.user.id;
        send(res, await deps.profiles.update(userId, req.body), () => deps.onChanged?.(userId));
    });

    router.put(
        '/me/images/:kind',
        deps.requireAuth,
        deps.uploadLimiter,
        (req, res, next) => {
            if (!isProfileImageKind(req.params.kind)) {
                return res.status(404).json({ error: '画像の種類は avatar か banner です', code: 'not-found' });
            }
            if (!req.is('image/*')) {
                return res.status(415).json({ error: '画像（image/*）を送ってください', code: 'unsupported' });
            }
            next();
        },
        readImageBody,
        async (req, res) => {
            const kind = req.params.kind;
            if (!req.user || !isProfileImageKind(kind)) return res.status(401).json({ error: 'Unauthorized' });
            const body: unknown = req.body;
            const input = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
            const userId = req.user.id;
            send(res, await deps.profiles.replaceImage(userId, kind, input), () => deps.onChanged?.(userId));
        },
    );

    router.delete('/me/images/:kind', deps.requireAuth, deps.writeLimiter, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const kind = req.params.kind;
        if (!isProfileImageKind(kind)) {
            return res.status(404).json({ error: '画像の種類は avatar か banner です', code: 'not-found' });
        }
        const userId = req.user.id;
        send(res, await deps.profiles.removeImage(userId, kind), () => deps.onChanged?.(userId));
    });

    router.get('/:userId/images/:kind/:file', async (req, res) => {
        const { userId, kind, file } = req.params;
        const hash = profileImageHashOf(file);
        const image = isProfileImageKind(kind) && hash ? await deps.profiles.image(userId, kind, hash) : undefined;
        if (!image) {
            // 同じ内容をまたアップロードすれば同じ URL が有効に戻るので、見つからないことは cache させない
            return res.status(404).set('Cache-Control', 'no-store').json({ error: 'Not found' });
        }
        res.set({
            'Content-Type': PROFILE_IMAGE_CONTENT_TYPE,
            'Cache-Control': IMMUTABLE,
            ETag: `"${image.hash}"`,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': IMAGE_CSP,
            // ほかのオリジン（開発時のフロント・連合先のサーバー）の <img> からも読めるようにする
            'Cross-Origin-Resource-Policy': 'cross-origin',
        });
        res.send(Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength));
    });

    router.use(bodyErrors);
    return router;
}
