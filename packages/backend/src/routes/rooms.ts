import { Router } from 'express';
import { roomRegistry } from '../services/roomRegistry';

const router = Router();

/**
 * GET /api/v1/rooms
 * ルームテンプレート一覧を取得
 */
router.get('/', (_req, res) => {
    const rooms = roomRegistry.listRooms().map((room) => ({
        id: room.id,
        displayName: room.displayName,
        description: room.description,
        thumbnail: room.thumbnail,
        version: room.version,
        capacity: room.capacity,
    }));

    res.json({ rooms });
});

/**
 * GET /api/v1/rooms/:roomId
 * ルームテンプレート詳細を取得
 */
router.get('/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = roomRegistry.getRoom(roomId);

    if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
    }

    res.json(room);
});

export default router;
