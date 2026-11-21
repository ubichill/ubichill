/**
 * 守る操作（新規登録・パスワードでのログイン）の前に、ボットでないことを確かめる。トークンは `x-bot-check` ヘッダーで受ける
 * （better-auth の口は本文を Express で読まないので、本文には入れない）。ボット対策を使っていなければ通す。
 * 失敗は `{ code, message, error }` で返す（v1 の API は error を、better-auth の口の画面は code と message を読む）。
 */
import { BOT_CHECK_ERRORS, BOT_CHECK_HEADER, type BotCheckAction } from '@ubichill/shared';
import type { RequestHandler } from 'express';
import type { BotCheckOutcome } from '../services/auth/botProtection/botProtection';
import { botProtectionService } from '../services/auth/botProtection/botProtectionService';
import { logger } from '../utils/logger';

type Check = (input: {
    token: string | undefined;
    action: BotCheckAction;
    remoteIp: string | undefined;
}) => Promise<BotCheckOutcome>;

const UNAVAILABLE: BotCheckOutcome = { ok: false, status: 503, code: 'bot-check-unavailable' };

export function createBotCheck(check: Check): (action: BotCheckAction) => RequestHandler {
    return (action) => async (req, res, next) => {
        // 設定を読めないときも通さない（ボット対策を外したことにしない）
        const outcome = await check({ token: req.get(BOT_CHECK_HEADER), action, remoteIp: req.ip }).catch(
            (error: unknown) => {
                logger.error('ボット対策の確認に失敗しました', error);
                return UNAVAILABLE;
            },
        );
        if (outcome.ok) return next();
        const message = BOT_CHECK_ERRORS[outcome.code];
        res.status(outcome.status).json({ code: outcome.code, message, error: message });
    };
}

export const requireBotCheck = createBotCheck((input) => botProtectionService.check(input));
