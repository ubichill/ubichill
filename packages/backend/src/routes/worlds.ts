import { WorldDefinitionSchema } from '@ubichill/shared';
import { Router } from 'express';
import { worldRegistry } from '../services/worldRegistry';

const router = Router();

/**
 * GET /api/v1/worlds
 * ワールドテンプレート一覧を取得
 */
router.get('/', async (_req, res) => {
    try {
        const worlds = await worldRegistry.listWorlds();
        const response = worlds.map((world) => ({
            id: world.id,
            displayName: world.displayName,
            description: world.description,
            thumbnail: world.thumbnail,
            version: world.version,
            capacity: world.capacity,
        }));

        res.json({ worlds: response });
    } catch (error) {
        console.error('ワールド一覧取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/worlds/:worldId
 * ワールドテンプレート詳細を取得
 */
router.get('/:worldId', async (req, res) => {
    try {
        const { worldId } = req.params;
        const world = await worldRegistry.getWorld(worldId);

        if (!world) {
            res.status(404).json({ error: 'World not found' });
            return;
        }

        res.json(world);
    } catch (error) {
        console.error('ワールド取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/v1/worlds
 * 新しいワールドをアップロード
 */
router.post('/', async (req, res) => {
    try {
        const result = WorldDefinitionSchema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json({
                error: 'Invalid world definition',
                details: result.error.issues,
            });
            return;
        }

        const definition = result.data;
        const worldId = definition.metadata.name;

        // 既存チェック
        const existing = await worldRegistry.getWorld(worldId);
        if (existing) {
            res.status(409).json({ error: 'World already exists', worldId });
            return;
        }

        // TODO: 認証から authorId を取得（現在は仮のシステムID）
        const authorId = '00000000-0000-0000-0000-000000000000';

        const world = await worldRegistry.createWorld(authorId, definition);
        res.status(201).json(world);
    } catch (error) {
        console.error('ワールド作成エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/v1/worlds/:worldId
 * ワールドを更新
 */
router.put('/:worldId', async (req, res) => {
    try {
        const { worldId } = req.params;

        const result = WorldDefinitionSchema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json({
                error: 'Invalid world definition',
                details: result.error.issues,
            });
            return;
        }

        const definition = result.data;

        // metadata.name と URL の worldId が一致するか確認
        if (definition.metadata.name !== worldId) {
            res.status(400).json({
                error: 'World ID mismatch',
                message: 'metadata.name must match the URL worldId',
            });
            return;
        }

        const updated = await worldRegistry.updateWorld(worldId, definition);
        if (!updated) {
            res.status(404).json({ error: 'World not found' });
            return;
        }

        res.json(updated);
    } catch (error) {
        console.error('ワールド更新エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/v1/worlds/:worldId
 * ワールドを削除
 */
router.delete('/:worldId', async (req, res) => {
    try {
        const { worldId } = req.params;

        const deleted = await worldRegistry.deleteWorld(worldId);
        if (!deleted) {
            res.status(404).json({ error: 'World not found' });
            return;
        }

        res.status(204).send();
    } catch (error) {
        console.error('ワールド削除エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
