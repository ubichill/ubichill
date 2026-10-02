import { publishingEnvironmentRepository, userRepository } from '@ubichill/db';
import { LIMITS, ModLockSchema } from '@ubichill/shared';
import { Router } from 'express';
import yaml from 'yaml';
import { optionalAuth, requireAdmin, requireAuth, requirePublisher } from '../middleware/auth';
import { selfAccount } from '../services/authorKeys';
import { worldRegistry } from '../services/worldRegistry';

const router = Router();

type ParsedBundle =
    | { ok: true; definition: unknown; lock: unknown; signature: unknown }
    | { ok: false; status: number; error: string };

/**
 * アップロードされたバンドル（`{ yaml, lock?, signature? }`）を読む。**ホストは中身を書き換えない**ので、
 * YAML をパースした生の値・lock・署名を、そのまま保存・配信する（スキーマの既定値も足さない）。
 */
function parseBundle(body: unknown): ParsedBundle {
    const { yaml: yamlText, lock, signature } = (body ?? {}) as { yaml?: unknown; lock?: unknown; signature?: unknown };
    if (typeof yamlText !== 'string' || yamlText.length === 0)
        return { ok: false, status: 400, error: 'yaml が必要です' };
    if (yamlText.length > LIMITS.MAX_YAML_SIZE) {
        return { ok: false, status: 413, error: `YAML が大きすぎます（最大 ${LIMITS.MAX_YAML_SIZE} bytes）` };
    }
    if (lock !== undefined && lock !== null && !ModLockSchema.safeParse(lock).success) {
        return { ok: false, status: 400, error: 'lock が不正です' };
    }
    const definition = (() => {
        try {
            return yaml.parse(yamlText) as unknown;
        } catch {
            return undefined;
        }
    })();
    if (definition === undefined) return { ok: false, status: 400, error: 'YAML を読めません' };
    return { ok: true, definition, lock: lock ?? null, signature };
}

type AuthorClaim = { error: string } | { environmentId?: string };

/**
 * 署名には作者アカウントが要り、それはアップロードした本人のアカウントで、鍵はその有効な公開環境でなければならない。
 * （作者が付かない署名は保存しても公開されないので、黙って非公開にせず保存の時点で弾く。取り消し済みの鍵もここで止まる）
 * 通った場合は署名に使った公開環境の ID を返す（最終利用の記録に使う）。
 */
async function checkAuthorClaim(
    rawSignature: unknown,
    userId: string,
    tokenEnvironment?: { id: string; publicKey: string },
): Promise<AuthorClaim> {
    const { author: claimed, publicKey } = (rawSignature ?? {}) as { author?: unknown; publicKey?: unknown };
    if (claimed === undefined)
        return { error: '署名に作者アカウントがありません（作者の付かない署名では公開されません）' };
    const user = await userRepository.findById(userId);
    const own = user?.handle ? selfAccount(user.handle) : null;
    if (claimed !== own) return { error: `署名の作者（${String(claimed)}）があなたのアカウントと一致しません` };
    const env =
        typeof publicKey === 'string' ? await publishingEnvironmentRepository.findByPublicKey(publicKey) : undefined;
    // API トークンで送る署名は、そのトークンの公開環境の鍵で署名したものに限る（盗まれたトークンで別の鍵の署名を通させない）
    if (tokenEnvironment && (typeof publicKey !== 'string' || publicKey !== tokenEnvironment.publicKey)) {
        return { error: 'API トークンで送る署名は、そのトークンの公開環境の鍵で署名してください' };
    }
    if (!env || env.userId !== userId || env.revokedAt) {
        return {
            error: 'この署名の鍵はあなたの有効な公開環境ではありません（取り消し済みか未登録）。画面を読み込み直して公開し直してください',
        };
    }
    return { environmentId: env.id };
}

/** 公開に使った公開環境の最終利用を記録する（使われなくなった環境を一覧で見分けるため）。失敗しても公開は止めない。 */
async function markEnvironmentUsed(claim: AuthorClaim): Promise<void> {
    if ('environmentId' in claim && claim.environmentId) {
        await publishingEnvironmentRepository.touch(claim.environmentId).catch(() => undefined);
    }
}

function saveFailureMessage(reason: string, message: string): string {
    if (reason === 'lock-incomplete') {
        return '使用する mod のコードが lock に固定されていないため公開できません（署名できません）';
    }
    return message;
}

/**
 * POST /api/v1/worlds/reload
 * YAMLファイルからワールド定義を再読み込み（認証必須）
 * サーバーを再起動せずにワールド定義を更新できる
 */
router.post('/reload', requireAuth, requireAdmin, async (_req, res) => {
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
router.put('/order', requireAuth, requireAdmin, async (req, res) => {
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
router.post('/:worldId/reload', requireAuth, requireAdmin, async (req, res) => {
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
 * PUT /api/v1/worlds
 * 作者のバンドル（`{ yaml, lock?, signature? }`）を本体に置く（作成・更新・下書き）。外部ホストに置くのと同じく、
 * 中身は書き換えず、作者 + metadata.name でワールドを区別する（同じ作者・同じ名前なら同じワールドの更新）。
 * - 署名あり: 外部と同じ規則で検証し、通れば公開中の版として保存
 * - 署名なし: 公開中のワールドなら下書きとして保存（公開中の版は残す）、そうでなければ署名なしのまま保存（公開されない）
 * 返り値: `{ id, url, saved, identity }`
 */
router.put('/', requirePublisher, async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const bundle = parseBundle(req.body);
        if (!bundle.ok) {
            res.status(bundle.status).json({ error: bundle.error });
            return;
        }
        const claim =
            bundle.signature === undefined
                ? {}
                : await checkAuthorClaim(bundle.signature, req.user.id, req.publishingEnvironment);
        if ('error' in claim) {
            res.status(422).json({ error: claim.error });
            return;
        }
        const result = await worldRegistry.saveBundle(req.user.id, bundle);
        if (!result.ok) {
            const status = result.reason === 'limit' ? 403 : result.reason === 'invalid-definition' ? 400 : 422;
            res.status(status).json({ error: saveFailureMessage(result.reason, result.message), code: result.reason });
            return;
        }
        await markEnvironmentUsed(claim);
        res.json({ id: result.world.id, url: result.world.url, saved: result.saved, identity: result.world.identity });
    } catch (error) {
        console.error('ワールド保存エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/worlds/:worldId/definition
 * エディタ用の定義（作成者のみ）。下書きがあれば下書きを返す。
 * 返り値: `{ definition, hasDraft, published }`（definition は YAML と同等の構造）
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
        res.json(await worldRegistry.getEditorDefinition(worldId));
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
 * 作者が置いた内容をそのまま公開で配信する（フェデレーション＝他インスタンスやクローラが URL でワールド実体を
 * 取得できるようにするため）。保存は PUT /api/v1/worlds で認可する。
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
 * 作者署名を返す（兄弟ファイル配信）。サーバーは署名せず、作者が付けた署名をそのまま返す。
 * 無ければ 404（＝未署名）。受け取る側が {@link sigUrlFor} で導出して検証する（外部ホストと同じ）。
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
