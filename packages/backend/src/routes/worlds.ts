import { worldRepository } from '@ubichill/db';
import { LIMITS, WorldCreateInputSchema, WorldDefinitionSchema } from '@ubichill/shared';
import { Router } from 'express';
import yaml from 'yaml';
import { optionalAuth, requireAuth } from '../middleware/auth';
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
router.get('/', optionalAuth, async (_req, res) => {
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
router.get('/:worldId', optionalAuth, async (req, res) => {
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
 * フォーム入力から新しいワールドを作成する（認証必須）
 * - metadata.name はサーバー側で nanoid 生成
 * - 1ユーザー最大 LIMITS.MAX_WORLDS_PER_USER 個まで
 */
router.post('/', requireAuth, async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const ownedCount = await worldRepository.countByAuthorId(req.user.id);
        if (ownedCount >= LIMITS.MAX_WORLDS_PER_USER) {
            res.status(403).json({
                error: `1ユーザーが作成できるワールドは ${LIMITS.MAX_WORLDS_PER_USER} 個までです`,
                limit: LIMITS.MAX_WORLDS_PER_USER,
            });
            return;
        }

        const result = WorldCreateInputSchema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json({
                error: 'Invalid world input',
                details: result.error.issues,
            });
            return;
        }

        const world = await worldRegistry.createFromInput(req.user.id, req.user.name, result.data);
        res.status(201).json(world);
    } catch (error) {
        console.error('ワールド作成エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/v1/worlds/yaml
 * YAML テキストから新しいワールドを作成する（認証必須）
 * body: { yaml: string }
 * - metadata.name は無視してサーバー側で再生成
 * - 1ユーザー最大 LIMITS.MAX_WORLDS_PER_USER 個まで
 */
router.post('/yaml', requireAuth, async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { yaml: yamlText } = req.body as { yaml?: unknown };
        if (typeof yamlText !== 'string' || yamlText.length === 0) {
            res.status(400).json({ error: 'yaml フィールドが必要です' });
            return;
        }
        if (yamlText.length > LIMITS.MAX_YAML_SIZE) {
            res.status(413).json({ error: `YAML が大きすぎます（最大 ${LIMITS.MAX_YAML_SIZE} bytes）` });
            return;
        }

        const ownedCount = await worldRepository.countByAuthorId(req.user.id);
        if (ownedCount >= LIMITS.MAX_WORLDS_PER_USER) {
            res.status(403).json({
                error: `1ユーザーが作成できるワールドは ${LIMITS.MAX_WORLDS_PER_USER} 個までです`,
                limit: LIMITS.MAX_WORLDS_PER_USER,
            });
            return;
        }

        const world = await worldRegistry.createFromYaml(req.user.id, req.user.name, yamlText);
        res.status(201).json(world);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'YAML 解析に失敗しました';
        res.status(422).json({ error: message });
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
 * GET /api/v1/worlds/:worldId/yaml
 * ワールドの定義を YAML テキストで取得（YAMLエディタ用）
 */
router.get('/:worldId/yaml', requireAuth, async (req, res) => {
    try {
        const record = await worldRegistry.getWorldRecord(req.params.worldId as string);
        if (!record) {
            res.status(404).json({ error: 'World not found' });
            return;
        }
        const text = yaml.stringify(record.definition);
        res.type('text/yaml').send(text);
    } catch (error) {
        console.error('ワールドYAML取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/v1/worlds/:worldId/yaml
 * YAML テキストでワールド定義を更新（認証必須、作成者のみ）
 * body: { yaml: string }
 * - metadata.name は URL の worldId に強制上書きする（ID は不変）
 */
router.put('/:worldId/yaml', requireAuth, async (req, res) => {
    try {
        const worldId = req.params.worldId as string;

        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const worldRecord = await worldRegistry.getWorldRecord(worldId);
        if (!worldRecord) {
            res.status(404).json({ error: 'World not found' });
            return;
        }

        if (worldRecord.authorId !== req.user.id) {
            res.status(403).json({ error: 'Forbidden: Only the author can update this world' });
            return;
        }

        const { yaml: yamlText } = req.body as { yaml?: unknown };
        if (typeof yamlText !== 'string' || yamlText.length === 0) {
            res.status(400).json({ error: 'yaml フィールドが必要です' });
            return;
        }
        if (yamlText.length > LIMITS.MAX_YAML_SIZE) {
            res.status(413).json({ error: `YAML が大きすぎます（最大 ${LIMITS.MAX_YAML_SIZE} bytes）` });
            return;
        }

        const parsed = yaml.parse(yamlText) as unknown;
        const result = WorldDefinitionSchema.safeParse(parsed);
        if (!result.success) {
            res.status(400).json({
                error: 'Invalid world definition',
                details: result.error.issues,
            });
            return;
        }

        // ID を不変にするため metadata.name を URL の worldId に強制上書き
        const definition = {
            ...result.data,
            metadata: { ...result.data.metadata, name: worldId },
        };

        const updated = await worldRegistry.updateWorld(worldId, definition);
        if (!updated) {
            res.status(404).json({ error: 'World not found' });
            return;
        }
        res.json(updated);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'YAML 更新に失敗しました';
        res.status(422).json({ error: message });
    }
});

/**
 * GET /api/v1/worlds/:worldId/owner
 * ワールドの作成者IDを取得（編集ボタン表示判定用、軽量レスポンス）
 */
router.get('/:worldId/owner', async (req, res) => {
    try {
        const record = await worldRegistry.getWorldRecord(req.params.worldId as string);
        if (!record) {
            res.status(404).json({ error: 'World not found' });
            return;
        }
        res.json({ authorId: record.authorId });
    } catch (error) {
        console.error('ワールド所有者取得エラー:', error);
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
