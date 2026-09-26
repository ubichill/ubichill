import { userRepository, worldRepository } from '@ubichill/db';
import {
    LIMITS,
    type ModLock,
    ModLockSchema,
    WorldCreateInputSchema,
    type WorldDefinition,
    WorldDefinitionSchema,
} from '@ubichill/shared';
import { Router } from 'express';
import yaml from 'yaml';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { selfAccount } from '../services/authorKeys';
import { prepareWorldUpdate, worldRegistry } from '../services/worldRegistry';

const router = Router();

/**
 * リクエスト body の `lock` を検証する。
 * - undefined/null → undefined（lock 無しで保存）
 * - 妥当な ModLock → その値
 * - それ以外 → 'invalid'（呼び出し側が 400 を返す）
 */
function parseOptionalLock(input: unknown): ModLock | undefined | 'invalid' {
    if (input === undefined || input === null) return undefined;
    const parsed = ModLockSchema.safeParse(input);
    return parsed.success ? parsed.data : 'invalid';
}

type ParsedYamlUpdate =
    | { ok: true; definition: WorldDefinition; lock: ModLock | undefined }
    | { ok: false; status: number; body: { error: string; details?: unknown } };

/** 更新 body（`{ yaml, lock }`）を検証してワールド定義にする。prepare と PUT で同じ解釈をするため共通化。 */
function parseYamlUpdate(body: unknown): ParsedYamlUpdate {
    const { yaml: yamlText, lock: lockInput } = (body ?? {}) as { yaml?: unknown; lock?: unknown };
    if (typeof yamlText !== 'string' || yamlText.length === 0) {
        return { ok: false, status: 400, body: { error: 'yaml フィールドが必要です' } };
    }
    if (yamlText.length > LIMITS.MAX_YAML_SIZE) {
        return { ok: false, status: 413, body: { error: `YAML が大きすぎます（最大 ${LIMITS.MAX_YAML_SIZE} bytes）` } };
    }
    const lock = parseOptionalLock(lockInput);
    if (lock === 'invalid') return { ok: false, status: 400, body: { error: 'lock フィールドが不正です' } };
    const result = WorldDefinitionSchema.safeParse(yaml.parse(yamlText) as unknown);
    if (!result.success) {
        return { ok: false, status: 400, body: { error: 'Invalid world definition', details: result.error.issues } };
    }
    return { ok: true, definition: result.data, lock };
}

/**
 * 署名が作者アカウントを主張するなら、それはアップロードした本人のアカウントでなければならない。
 * （他人の handle を名乗る署名は、鍵が一致しなければ表示されないが、保存の時点で弾いておく）
 */
async function authorClaimError(rawSignature: unknown, userId: string): Promise<string | null> {
    const claimed = (rawSignature as { author?: unknown } | null)?.author;
    if (claimed === undefined) return null;
    const user = await userRepository.findById(userId);
    const own = user?.handle ? selfAccount(user.handle) : null;
    return claimed === own ? null : `署名の作者（${String(claimed)}）があなたのアカウントと一致しません`;
}

function updateFailureStatus(reason: string): number {
    if (reason === 'not-found') return 404;
    if (reason === 'signature-required') return 409;
    return 422;
}

function updateFailureMessage(reason: string): string {
    if (reason === 'not-found') return 'World not found';
    if (reason === 'signature-required') {
        return '署名済みのワールドです。署名を付けて保存するか、未署名（非公開）にすることを明示してください';
    }
    return `署名を検証できません (${reason})`;
}

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

// NOTE: 旧 POST /worlds/import（DB コピー型）は廃止。外部/リモートワールドは
// コピーせず、共有 URL で入る（POST /instances に URL を渡す）か、ピアをフォローして参照する。

/**
 * GET /api/v1/worlds
 * ワールドテンプレート一覧を取得（認証必須）。
 * クエリ `?scope=local|global|all` でローカル/連合/すべてを切り替え（デフォルト all）。
 */
router.get('/', optionalAuth, async (req, res) => {
    try {
        const scopeParam = req.query.scope;
        const scope: 'local' | 'global' | 'all' =
            scopeParam === 'local' || scopeParam === 'global' ? scopeParam : 'all';
        const worlds = await worldRegistry.listWorlds(scope);
        res.json({ worlds });
    } catch (error) {
        console.error('ワールド一覧取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/worlds/resolve?url=https://.../world.yaml
 *
 * 任意の公開ワールド URL を登録・フォローせず、その場で解決する。
 * 実際の取得は worldRegistry -> safeFetch を通るため、SSRF 防止と外部 lock 検証の境界は
 * インスタンス作成時と共通になる。
 */
router.get('/resolve', optionalAuth, async (req, res) => {
    const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) {
        res.status(400).json({ error: 'http(s) のワールドURLが必要です' });
        return;
    }
    try {
        const result = await worldRegistry.resolveRefDetailed(url);
        if (!result.ok) {
            res.status(result.reason === 'integrity' ? 422 : 404).json({ error: result.message });
            return;
        }
        res.set('Cache-Control', 'no-store');
        res.json(result.world);
    } catch (error) {
        console.error(`外部ワールド取得エラー: ${url}`, error);
        res.status(400).json({ error: '外部ワールドを取得できませんでした' });
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
 * ワールドの**正規 URL**（{@link ResolvedWorld.url}）。content negotiation で返す形式を切り替える:
 *   - 既定 / `Accept: application/json` → ResolvedWorld(JSON)（フロント詳細表示用）
 *   - `Accept` が yaml を含む または `?format=yaml` → WorldDefinition(YAML)（連合/クローラ/エディタ用、公開）
 * official/ユーザー作成を問わず公開で配信する（他インスタンスが URL でワールド実体を取得できるように）。
 */
router.get('/:worldId', optionalAuth, async (req, res) => {
    try {
        const worldId = req.params.worldId as string;
        const wantsYaml = req.query.format === 'yaml' || /ya?ml/i.test(req.get('accept') ?? '');

        if (wantsYaml) {
            const hosted = await worldRegistry.getHostedDocument(worldId);
            if (!hosted) {
                res.status(404).json({ error: 'World not found' });
                return;
            }
            res.type('text/yaml').send(yaml.stringify(hosted.definition));
            return;
        }

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

        const { yaml: yamlText, lock: lockInput } = req.body as { yaml?: unknown; lock?: unknown };
        if (typeof yamlText !== 'string' || yamlText.length === 0) {
            res.status(400).json({ error: 'yaml フィールドが必要です' });
            return;
        }
        if (yamlText.length > LIMITS.MAX_YAML_SIZE) {
            res.status(413).json({ error: `YAML が大きすぎます（最大 ${LIMITS.MAX_YAML_SIZE} bytes）` });
            return;
        }
        // lock は definition とは別に受け取り別カラム保存する（人間 YAML はクリーンに保つ）。
        const lock = parseOptionalLock(lockInput);
        if (lock === 'invalid') {
            res.status(400).json({ error: 'lock フィールドが不正です' });
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

        const world = await worldRegistry.createFromYaml(req.user.id, req.user.name, yamlText, lock);
        res.status(201).json(world);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'YAML 解析に失敗しました';
        res.status(422).json({ error: message });
    }
});

/**
 * GET /api/v1/worlds/:worldId/definition
 * ワールドの生定義（WorldDefinition）を取得（GUI エディタ用、作成者のみ）
 * ResolvedWorld ではなく YAML と同等の構造をそのまま返す
 */
router.get('/:worldId/definition', requireAuth, async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const worldId = req.params.worldId as string;
        const record = await worldRegistry.getWorldRecord(worldId);
        if (!record) {
            res.status(404).json({ error: 'World not found' });
            return;
        }
        if (record.authorId !== req.user.id) {
            res.status(403).json({ error: 'Forbidden: Only the author can view the raw definition' });
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
 * ワールドの定義を YAML テキストで取得する。
 *
 * これは「ワールド＝URL」の**正規 URL**（{@link ResolvedWorld.url}）が指す先であり、
 * official/registry/ユーザー作成を問わず**公開**で配信する（フェデレーション＝他インスタンスや
 * クローラが URL でワールド実体を取得できるようにするため）。編集用の保存は PUT 側で認可する。
 */
router.get('/:worldId/yaml', optionalAuth, async (req, res) => {
    try {
        const hosted = await worldRegistry.getHostedDocument(req.params.worldId as string);
        if (!hosted) {
            res.status(404).json({ error: 'World not found' });
            return;
        }
        res.type('text/yaml').send(yaml.stringify(hosted.definition));
    } catch (error) {
        console.error('ワールドYAML取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/worlds/:worldId/lock
 * ワールドの mod 完全性ロックを返す（兄弟ファイル配信）。
 *
 * lock は人間が書く YAML には埋めず、この公開エンドポイントで別配信する。
 * 他インスタンス/クローラが正規 URL から {@link lockUrlFor} で導出して取得する。
 * lock 未設定のワールドは 404（＝外部 provenance ではロード側で lock-missing 拒否になる）。
 */
router.get('/:worldId/lock', optionalAuth, async (req, res) => {
    try {
        const hosted = await worldRegistry.getHostedDocument(req.params.worldId as string);
        if (!hosted?.lock) {
            res.status(404).json({ error: 'Lock not found' });
            return;
        }
        res.json(hosted.lock);
    } catch (error) {
        console.error('ワールドlock取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/worlds/:worldId/sig
 * 作者署名を返す（兄弟ファイル配信）。サーバーは署名しない。現在の YAML + lock に対して
 * 有効な署名だけを返し、無い・古い場合は 404（＝未署名）。他インスタンスは {@link sigUrlFor} で導出して検証する。
 */
router.get('/:worldId/sig', optionalAuth, async (req, res) => {
    try {
        const sig = await worldRegistry.getWorldSignature(req.params.worldId as string);
        if (!sig) {
            res.status(404).json({ error: 'Signature not found' });
            return;
        }
        res.set('Cache-Control', 'no-cache');
        res.json(sig);
    } catch (error) {
        console.error('ワールド署名取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/v1/worlds/:worldId/sig
 * 作者が手元の鍵で付けた署名を保存する（認証必須、作成者のみ）。body は WorldSignature。
 * 現在の内容に対して検証できない署名は 422。
 */
router.put('/:worldId/sig', requireAuth, async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const worldId = req.params.worldId as string;
        const record = await worldRegistry.getWorldRecord(worldId);
        if (!record) {
            res.status(404).json({ error: 'World not found' });
            return;
        }
        if (record.authorId !== req.user.id) {
            res.status(403).json({ error: 'Forbidden: Only the author can sign this world' });
            return;
        }
        const claimError = await authorClaimError(req.body, req.user.id);
        if (claimError) {
            res.status(422).json({ error: claimError });
            return;
        }
        const result = await worldRegistry.setWorldSignature(worldId, req.body as unknown);
        if (!result.ok) {
            const status = result.reason === 'not-found' ? 404 : 422;
            res.status(status).json({ error: `署名を検証できません (${result.reason})` });
            return;
        }
        res.json({ identity: result.identity });
    } catch (error) {
        console.error('ワールド署名保存エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/v1/worlds/:worldId/prepare
 * PUT /:worldId/yaml で保存される値（definition + lock）を保存せずに返す（認証必須、作成者のみ）。
 * 作者はこの値に署名し、PUT に signature を添えて送る＝内容と署名を 1 回で原子的に保存する。
 * body: { yaml: string, lock?: ModLock }
 */
router.post('/:worldId/prepare', requireAuth, async (req, res) => {
    try {
        const worldId = req.params.worldId as string;
        const record = await worldRegistry.getWorldRecord(worldId);
        if (!record) {
            res.status(404).json({ error: 'World not found' });
            return;
        }
        if (record.authorId !== req.user?.id) {
            res.status(403).json({ error: 'Forbidden: Only the author can update this world' });
            return;
        }
        const parsed = parseYamlUpdate(req.body);
        if (!parsed.ok) {
            res.status(parsed.status).json(parsed.body);
            return;
        }
        res.json(prepareWorldUpdate(worldId, parsed.definition, parsed.lock));
    } catch (error) {
        console.error('ワールド更新準備エラー:', error);
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

        const parsed = parseYamlUpdate(req.body);
        if (!parsed.ok) {
            res.status(parsed.status).json(parsed.body);
            return;
        }
        const { signature, allowUnsigned } = req.body as { signature?: unknown; allowUnsigned?: unknown };
        const claimError = signature === undefined ? null : await authorClaimError(signature, req.user.id);
        if (claimError) {
            res.status(422).json({ error: claimError });
            return;
        }
        const result = await worldRegistry.updateWorld(worldId, parsed.definition, parsed.lock, {
            signature,
            allowUnsigned: allowUnsigned === true,
        });
        if (!result.ok) {
            res.status(updateFailureStatus(result.reason)).json({ error: updateFailureMessage(result.reason) });
            return;
        }
        res.json(result.world);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'YAML 更新に失敗しました';
        res.status(422).json({ error: message });
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

        const updated = await worldRegistry.updateWorld(worldId, definition, undefined, {
            allowUnsigned: req.query.allowUnsigned === 'true',
        });
        if (!updated.ok) {
            res.status(updateFailureStatus(updated.reason)).json({ error: updateFailureMessage(updated.reason) });
            return;
        }

        res.json(updated.world);
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
