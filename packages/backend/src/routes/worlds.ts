import { LIMITS, ModLockSchema, WorldVisibilitySchema } from '@ubichill/shared';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import yaml from 'yaml';
import { perUserLimiter } from '../lib/rateLimit';
import { optionalAuth, requireAdmin, requireAuth, requirePublisher } from '../middleware/auth';
import { bearerToken } from '../services/auth/cliAuth';
import { publishingEnvironmentService } from '../services/authors/publishingEnvironmentService';
import { federation } from '../services/federation';
import { worldRegistry } from '../services/worlds/worldRegistry';
import { logger } from '../utils/logger';

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

/**
 * 保存の認可。公開（署名あり）と API トークンは公開環境の確認（requirePublisher）。署名なしの下書き保存は公開されないので、
 * ログインしていれば足りる（エディタを長く開いていても下書きを保存できるように、再ログインを求めない）。
 */
function requireSaver(req: Request, res: Response, next: NextFunction): Promise<void> | void {
    const signed = (req.body as { signature?: unknown } | undefined)?.signature !== undefined;
    return signed || bearerToken(req.get('authorization'))
        ? requirePublisher(req, res, next)
        : requireAuth(req, res, next);
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
        const worlds = await worldRegistry.listWorlds('local');
        res.json({ success: true, worldCount: worlds.length });
    } catch (error) {
        logger.error('ワールド再読み込みエラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// NOTE: 旧 POST /worlds/import（DB コピー型）は廃止。外部/リモートワールドは
// コピーせず、共有 URL で入る（POST /instances に URL を渡す）か、ピアをフォローして参照する。

/**
 * GET /api/v1/worlds
 * ワールドテンプレート一覧を取得（認証必須）。
 * クエリ `?scope=local|global` でローカル（このサーバーのワールド）と連合（フォロー中のサーバーのワールド）を切り替える
 * （既定は local）。両方を混ぜた一覧は返さない。連合先のサーバーもこの既定で取りに来るので、こちらが連合で受け取った
 * ワールドを、さらに別のサーバーへ自分のものとして渡さない。
 */
router.get('/', optionalAuth, async (req, res) => {
    try {
        const scope = req.query.scope === 'global' ? 'global' : 'local';
        const worlds = await worldRegistry.listWorlds(scope);
        res.json({ worlds });
    } catch (error) {
        logger.error('ワールド一覧取得エラー:', error);
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
        // 作者が登録していれば短い共有ページ（/@handle/name）を添える（画面はそれで共有し、URL を置き換える）
        res.json({ ...result.world, sharePath: await worldRegistry.externalSharePath(result.world) });
    } catch (error) {
        logger.error(`外部ワールド取得エラー: ${url}`, error);
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
        logger.error('ワールド並べ替えエラー:', error);
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
        logger.error('ワールド再読み込みエラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/worlds/:worldId
 * 内部 ID でワールドを返す（画面・エディタ向けの ResolvedWorld(JSON)）。公開の URL とファイルは
 * `/api/v1/authors/:handle/worlds/:name(.yaml)`（共有 URL は `/@handle/name`）。
 */
router.get('/:worldId', optionalAuth, async (req, res) => {
    try {
        const resolution = await worldRegistry.resolveLocal(req.params.worldId as string);
        if (!resolution.ok) {
            res.status(resolution.reason === 'integrity' ? 422 : 404).json({
                error: resolution.message,
                code: resolution.reason,
            });
            return;
        }
        res.json(resolution.world);
    } catch (error) {
        logger.error('ワールド取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/worlds/:worldId/versions?contentHash=sha256-...
 * 本体のワールドの、残っている版を content_hash（shared の worldContentHash()）で返す（ResolvedWorld(JSON)）。
 * 残す数を超えて消した版は 410。ワールドが無ければ 404。
 */
router.get('/:worldId/versions', optionalAuth, async (req, res) => {
    const contentHash = typeof req.query.contentHash === 'string' ? req.query.contentHash : '';
    if (!/^sha256-[A-Za-z0-9+/]+=*$/.test(contentHash)) {
        res.status(400).json({ error: 'contentHash（sha256-<base64>）が必要です' });
        return;
    }
    try {
        const resolution = await worldRegistry.resolveVersion(req.params.worldId as string, contentHash);
        if (!resolution.ok) {
            const status = resolution.reason === 'gone' ? 410 : resolution.reason === 'integrity' ? 422 : 404;
            res.status(status).json({ error: resolution.message, code: resolution.reason });
            return;
        }
        res.json(resolution.world);
    } catch (error) {
        logger.error('ワールドの版の取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/v1/worlds
 * 作者のバンドル（`{ yaml, lock?, signature?, worldId? }`）を本体に置く（作成・更新・下書き）。外部ホストに置くのと同じく、
 * 中身は書き換えず、作者 + metadata.name でワールドを区別する（同じ作者・同じ名前なら同じワールドの更新）。
 * - 署名あり: 外部と同じ規則で検証し、通れば公開中の版として保存
 * - 署名なし: 公開中のワールドなら下書きとして保存（公開中の版は残す）、そうでなければ署名なしのまま保存（公開されない）
 * `worldId` は編集中のワールド（エディタ）。metadata.name を変えると名前の変更（URL も変わり、以前の URL からもたどれる）。
 * 自分の別のワールドと同じ名前なら上書きせず 409。同じ metadata.version で中身の違う公開も 409（version-conflict）。
 * 返り値: `{ id, url, saved, identity }`
 */
// 保存は署名の検証と作者の鍵の確認を起こすので、利用者ごとに回数を抑える
const saveLimiter = perUserLimiter(
    'worlds-save',
    60 * 1000,
    30,
    'ワールドの保存が多すぎます。少し待ってから試してください',
);

router.put('/', requireSaver, saveLimiter, async (req, res) => {
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
        // 署名の作者は保存の前に確かめる（作者の付かない署名は公開されないので、黙って非公開にせず弾く）
        const claim =
            bundle.signature === undefined
                ? null
                : await publishingEnvironmentService.checkAuthorClaim(
                      bundle.signature,
                      req.user.id,
                      req.publishingEnvironment?.id,
                  );
        if (claim && !claim.ok) {
            res.status(422).json({ error: claim.error });
            return;
        }
        const editingId = (req.body as { worldId?: unknown }).worldId;
        const result = await worldRegistry.saveBundle(req.user.id, bundle, {
            editingId: typeof editingId === 'string' ? editingId : undefined,
        });
        if (!result.ok) {
            const status =
                result.reason === 'limit'
                    ? 403
                    : result.reason === 'invalid-definition'
                      ? 400
                      : result.reason === 'name-taken' || result.reason === 'version-conflict'
                        ? 409
                        : result.reason === 'author-not-found'
                          ? 404
                          : 422;
            res.status(status).json({ error: saveFailureMessage(result.reason, result.message), code: result.reason });
            return;
        }
        if (claim) await publishingEnvironmentService.markUsed(claim.environmentId);
        federation?.featuredChanged(req.user.id);
        res.json({ id: result.world.id, url: result.world.url, saved: result.saved, identity: result.world.identity });
    } catch (error) {
        logger.error('ワールド保存エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/v1/worlds/:worldId/visibility
 * 公開範囲を変える（作者のみ）。body: `{ visibility: 'private' | 'public' }`。プライベートは作者だけがインスタンスを作れ、
 * 一覧・ワールドに置くポータルの行き先から外れる。公開（署名した版）するまでは、どちらでもプライベートとして扱う。
 */
router.put('/:worldId/visibility', requireAuth, saveLimiter, async (req, res) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const parsed = WorldVisibilitySchema.safeParse((req.body as { visibility?: unknown } | undefined)?.visibility);
        if (!parsed.success) {
            res.status(400).json({ error: '公開範囲は private か public です' });
            return;
        }
        const changed = await worldRegistry.setVisibility(req.params.worldId as string, req.user.id, parsed.data);
        if (!changed) {
            res.status(404).json({ error: 'World not found' });
            return;
        }
        federation?.featuredChanged(req.user.id);
        res.json({ visibility: parsed.data });
    } catch (error) {
        logger.error('ワールドの公開範囲の変更エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/worlds/:worldId/definition
 * エディタ用の定義（作成者のみ）。下書きがあれば下書きを返す。
 * 返り値: `{ definition, hasDraft, published, publishedVersion, visibility }`（definition は YAML と同等の構造）
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
        logger.error('ワールド定義取得エラー:', error);
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
        federation?.featuredChanged(req.user.id);

        res.status(204).send();
    } catch (error) {
        logger.error('ワールド削除エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export { router };
