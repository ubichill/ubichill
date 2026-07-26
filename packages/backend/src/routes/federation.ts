import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { worldRegistry } from '../services/worldRegistry';

const router = Router();

/**
 * GET /api/v1/federation/peers
 * フォロー中の連合ピア一覧を取得する（認証必須）。
 */
router.get('/peers', requireAuth, async (_req, res) => {
    try {
        const peers = await worldRegistry.listPeers();
        res.json({ peers });
    } catch (error) {
        console.error('ピア一覧取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/v1/federation/peers
 * 連合ピアをフォローする（認証必須）。
 * body: { baseUrl: string, displayName?: string }
 */
router.post('/peers', requireAuth, async (req, res) => {
    try {
        const { baseUrl, displayName } = req.body as { baseUrl?: unknown; displayName?: unknown };
        if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
            res.status(400).json({ error: 'baseUrl が必要です' });
            return;
        }
        const peer = await worldRegistry.followPeer(baseUrl, typeof displayName === 'string' ? displayName : undefined);
        res.status(201).json(peer);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'フォローに失敗しました';
        res.status(422).json({ error: message });
    }
});

/**
 * DELETE /api/v1/federation/peers/:peerId
 * 連合ピアのフォローを解除する（認証必須）。
 */
router.delete('/peers/:peerId', requireAuth, async (req, res) => {
    try {
        const peerId = req.params.peerId as string;
        const success = await worldRegistry.unfollowPeer(peerId);
        if (!success) {
            res.status(404).json({ error: 'Peer not found' });
            return;
        }
        res.status(204).send();
    } catch (error) {
        console.error('ピア削除エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export { router };
