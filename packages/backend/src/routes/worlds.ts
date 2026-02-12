import { Router } from 'express';
import { worldRegistry } from '../services/worldRegistry';

const router = Router();

/**
 * GET /api/v1/worlds
 * ワールドテンプレート一覧を取得
 */
router.get('/', (_req, res) => {
    const worlds = worldRegistry.listWorlds().map((world) => ({
        id: world.id,
        displayName: world.displayName,
        description: world.description,
        thumbnail: world.thumbnail,
        version: world.version,
        capacity: world.capacity,
    }));

    res.json({ worlds });
});

/**
 * GET /api/v1/worlds/:worldId
 * ワールドテンプレート詳細を取得
 */
router.get('/:worldId', (req, res) => {
    const { worldId } = req.params;
    const world = worldRegistry.getWorld(worldId);

    if (!world) {
        res.status(404).json({ error: 'World not found' });
        return;
    }

    res.json(world);
});

export default router;
