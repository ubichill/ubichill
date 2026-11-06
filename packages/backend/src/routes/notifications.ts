/**
 * 通知: 一覧（カーソル）・未読数・既読・SSE・運営のお知らせ。規則は services/notifications.ts。
 */
import { announcementRepository, userRepository } from '@ubichill/db';
import {
    CreateAnnouncementRequestSchema,
    MarkReadRequestSchema,
    NOTIFICATION_LIMITS,
    type NotificationPage,
} from '@ubichill/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { redis } from '../lib/redis';
import { sharedRateLimit } from '../lib/sharedRateLimit';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { notificationHub } from '../services/notificationHub';
import { notificationService } from '../services/notificationService';
import { openNotificationStream } from '../services/notificationStream';
import { logger } from '../utils/logger';

const router = Router();

// EventSource は切れると数秒で繋ぎ直す。全体の制限とは別に、繋ぎ直しの嵐で 1 台の接続を使い切らせない
const streamLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '通知の接続が多すぎます。しばらくしてから再試行してください。' },
    ...sharedRateLimit('notifications-stream', redis, logger),
});

const announceLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'お知らせの作成が多すぎます。しばらくしてから再試行してください。' },
    ...sharedRateLimit('announcements-create', redis, logger),
});

router.get('/', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;
    const result = await notificationService.listFeed(req.user.id, {
        cursor,
        limit: Number.isFinite(limit) ? limit : undefined,
    });
    if (!result.ok) return res.status(400).json({ error: 'cursor が不正です' });
    res.set('Cache-Control', 'no-store');
    const { ok: _ok, ...page } = result;
    return res.json(page satisfies NotificationPage);
});

router.get('/unread-count', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    res.set('Cache-Control', 'no-store');
    return res.json({ unreadCount: await notificationService.unreadCount(req.user.id) });
});

router.post('/read', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = MarkReadRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ error: `ids（${NOTIFICATION_LIMITS.MAX_READ_IDS} 件まで）か all: true を指定してください` });
    }
    return res.json({ unreadCount: await notificationService.markRead(req.user.id, parsed.data) });
});

router.get('/stream', requireAuth, streamLimiter, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    res.status(200);
    res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        // no-transform: 途中のプロキシ（Cloudflare）に圧縮・まとめ送りをさせない
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    openNotificationStream({
        userId: req.user.id,
        hub: notificationHub,
        sink: {
            write: (chunk) => void res.write(chunk),
            end: () => res.end(),
            onClose: (listener) => req.on('close', listener),
        },
    });
});

router.get('/announcements', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const since = new Date(Date.now() - NOTIFICATION_LIMITS.RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const rows = await announcementRepository.listPage({ since, limit: NOTIFICATION_LIMITS.MAX_PAGE_SIZE });
    return res.json({
        announcements: rows.map((r) => ({
            id: r.id,
            title: r.title,
            content: r.content,
            published: r.publishedAt.toISOString(),
        })),
    });
});

router.post('/announcements', requireAuth, requireAdmin, announceLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = CreateAnnouncementRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            error: `題名（${NOTIFICATION_LIMITS.ANNOUNCEMENT_TITLE_MAX} 文字まで）と本文（${NOTIFICATION_LIMITS.ANNOUNCEMENT_CONTENT_MAX} 文字まで）を指定してください`,
        });
    }
    const user = await userRepository.findById(req.user.id);
    const result = await notificationService.publishAnnouncement(
        { id: req.user.id, handle: user?.handle },
        parsed.data,
    );
    if (!result.ok) return res.status(403).json({ error: 'お知らせを出せるのは公式アカウントだけです' });
    return res.status(201).json(result.notification);
});

export { router };
