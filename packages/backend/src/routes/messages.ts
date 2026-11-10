import {
    type ConversationPage,
    type ConversationsResponse,
    type DirectMessage,
    MESSAGE_LIMITS,
    MESSAGE_REFUSAL_MESSAGES,
    SendMessageRequestSchema,
} from '@ubichill/shared';
import { type RequestHandler, Router } from 'express';
import type { MessageService } from '../services/social/messages';

export interface MessagesRouterDeps {
    requireAuth: RequestHandler;
    /** 送る回数（1 人あたり。短い窓と長い窓を重ねる） */
    sendLimiters: readonly RequestHandler[];
    messages: MessageService;
}

/**
 * フレンド同士のメッセージ（`/api/v1/messages` の下）。
 * - `GET /`: 会話の一覧（新しい順・相手ごとの未読の数）
 * - `GET /:userId`: 会話の 1 ページ（新しい順・cursor で前へ）。いま送れなければ refusal
 * - `POST /:userId`: 送る
 * - `POST /:userId/read`: 相手から届いた分を既読にする
 */
export function createMessagesRouter(deps: MessagesRouterDeps): Router {
    const router = Router();

    router.get('/', deps.requireAuth, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        const conversations = await deps.messages.conversations(userId);
        res.set('Cache-Control', 'no-store').json({ conversations } satisfies ConversationsResponse);
    });

    router.get('/:userId', deps.requireAuth, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
        const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;
        const outcome = await deps.messages.conversation(userId, String(req.params.userId), { cursor, limit });
        if (!outcome.ok) {
            return void (outcome.error === 'bad-cursor'
                ? res.status(400).json({ error: 'cursor が不正です' })
                : res.status(404).json({ error: 'ユーザーが見つかりません' }));
        }
        const { ok: _ok, ...page } = outcome;
        res.set('Cache-Control', 'no-store').json(page satisfies ConversationPage);
    });

    router.post('/:userId', deps.requireAuth, ...deps.sendLimiters, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        const parsed = SendMessageRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return void res.status(400).json({
                error: parsed.error.issues[0]?.message ?? `${MESSAGE_LIMITS.CONTENT_MAX} 文字以内で入力してください`,
            });
        }
        const outcome = await deps.messages.send(userId, String(req.params.userId), parsed.data.content);
        if (!outcome.ok) {
            return void res
                .status(outcome.reason === 'self' ? 400 : 403)
                .json({ error: MESSAGE_REFUSAL_MESSAGES[outcome.reason], reason: outcome.reason });
        }
        res.status(201).json(outcome.message satisfies DirectMessage);
    });

    router.post('/:userId/read', deps.requireAuth, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        await deps.messages.markRead(userId, String(req.params.userId));
        res.status(204).send();
    });

    return router;
}
