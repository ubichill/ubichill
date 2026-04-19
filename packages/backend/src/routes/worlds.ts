import { WorldDefinitionSchema } from '@ubichill/shared';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { worldRegistry } from '../services/worldRegistry';

const router = Router();

/**
 * POST /api/v1/worlds/reload
 * YAMLファイルからワールド定義を再読み込み（認証必須）
 * サーバーを再起動せずにワールド定義を更新できる
 */
router.post('/reload', requireAuth, async (_req, res) => {
    try {
        await worldRegistry.reloadWorlds();
        const worlds = await worldRegistry.listWorlds();
        res.json({ success: true, worldCount: worlds.length });
    } catch (error) {
        console.error('ワールド再読み込みエラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/v1/worlds/import
 * URL または GitHub blob URL からワールドを取り込む（認証必須）
 * body: { url: string }
 */
router.post('/import', requireAuth, async (req, res) => {
    const { url } = req.body as { url?: unknown };
    if (typeof url !== 'string' || !url.startsWith('http')) {
        res.status(400).json({ error: 'url が不正です' });
        return;
    }
    try {
        const worlds = await worldRegistry.importFromUrl(url);
        res.json({
            success: true,
            worlds: worlds.map((w) => ({ id: w.id, displayName: w.displayName, version: w.version })),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : '取得失敗';
        res.status(422).json({ error: message });
    }
});

/**
 * GET /api/v1/worlds
 * ワールドテンプレート一覧を取得（認証必須）
 */
router.get('/', requireAuth, async (_req, res) => {
    try {
        const worlds = await worldRegistry.listWorlds();
        res.json({ worlds });
    } catch (error) {
        console.error('ワールド一覧取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/v1/worlds/order
 * ワールドの表示順を更新（認証必須）
 * body: { order: string[] }  ワールドIDの配列
 */
router.put('/order', requireAuth, async (req, res) => {
    try {
        const { order } = req.body as { order?: unknown };
        if (!Array.isArray(order) || !order.every((v) => typeof v === 'string')) {
            res.status(400).json({ error: 'order must be an array of strings' });
            return;
        }
        await worldRegistry.reorderWorlds(order);
        res.json({ success: true });
    } catch (error) {
        console.error('ワールド並べ替えエラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/v1/worlds/:worldId/reload
 * 指定ワールドのYAML定義のみを再読み込み（認証必須）
 */
router.post('/:worldId/reload', requireAuth, async (req, res) => {
    try {
        const worldId = req.params.worldId as string;
        const found = await worldRegistry.reloadWorld(worldId);
        if (!found) {
            res.status(404).json({ error: 'ローカルYAMLにワールドが見つかりません' });
            return;
        }
        const world = await worldRegistry.getWorld(worldId);
        res.json({ success: true, world: world ? { id: world.id, version: world.version } : null });
    } catch (error) {
        console.error('ワールド再読み込みエラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/worlds/:worldId
 * ワールドテンプレート詳細を取得（認証必須）
 */
router.get('/:worldId', requireAuth, async (req, res) => {
    try {
        const worldId = req.params.worldId as string;
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
 * 新しいワールドをアップロード（認証必須）
 */
router.post('/', requireAuth, async (req, res) => {
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

        // 認証されたユーザーIDを使用（requireAuthで保証）
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const authorId = req.user.id;

        const world = await worldRegistry.createWorld(authorId, definition);
        res.status(201).json(world);
    } catch (error) {
        console.error('ワールド作成エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/worlds/:worldId/definition
 * ワールドの生定義（WorldDefinition）を取得（GUI エディタ用）
 * ResolvedWorld ではなく YAML と同等の構造をそのまま返す
 */
router.get('/:worldId/definition', requireAuth, async (req, res) => {
    try {
        const worldId = req.params.worldId as string;
        const record = await worldRegistry.getWorldRecord(worldId);
        if (!record) {
            res.status(404).json({ error: 'World not found' });
            return;
        }
        res.json(record.definition);
    } catch (error) {
        console.error('ワールド定義取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/v1/worlds/:worldId
 * ワールドを更新（認証必須、作成者のみ）
 */
router.put('/:worldId', requireAuth, async (req, res) => {
    try {
        const worldId = req.params.worldId as string;

        // 認証されたユーザーIDを取得
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // ワールドの作成者を確認
        const worldRecord = await worldRegistry.getWorldRecord(worldId);
        if (!worldRecord) {
            res.status(404).json({ error: 'World not found' });
            return;
        }

        // 作成者のみ更新可能
        if (worldRecord.authorId !== req.user.id) {
            res.status(403).json({ error: 'Forbidden: Only the author can update this world' });
            return;
        }

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
 * ワールドを削除（認証必須、作成者のみ）
 */
router.delete('/:worldId', requireAuth, async (req, res) => {
    try {
        const worldId = req.params.worldId as string;

        // 認証されたユーザーIDを取得
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // ワールドの作成者を確認
        const worldRecord = await worldRegistry.getWorldRecord(worldId);
        if (!worldRecord) {
            res.status(404).json({ error: 'World not found' });
            return;
        }

        // 作成者のみ削除可能
        if (worldRecord.authorId !== req.user.id) {
            res.status(403).json({ error: 'Forbidden: Only the author can delete this world' });
            return;
        }

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

export { router };
