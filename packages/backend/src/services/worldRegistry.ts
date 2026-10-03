import fs from 'node:fs';
import path from 'node:path';
import {
    type FederationPeerRecord,
    federationPeerRepository,
    userRepository,
    type WorldRecord,
    worldRepository,
} from '@ubichill/db';
import {
    type AuthorAccount,
    ENV_KEYS,
    HANDLE_PATTERN,
    isPublishable,
    LIMITS,
    type ModLock,
    parseAuthorAccount,
    type ResolvedWorld,
    SERVER_CONFIG,
    type WorldDefinition,
    WorldDefinitionSchema,
    type WorldDocument,
    type WorldListItem,
    type WorldSignature,
    type WorldSignatureInvalidReason,
    type WorldSource,
    WorldSourceKind,
} from '@ubichill/shared';
import { customAlphabet } from 'nanoid';
import yaml from 'yaml';
import { isAuthorKey, resolveAuthorDisplayName } from './authorKeyStore';
import { selfDomain } from './authorKeys';
import { createRemoteWorldCache } from './remoteWorldCache';
import { assertPublicUrl, safeFetch } from './safeFetch';
import {
    normalizeWorldUrl,
    parseStoredDefinition,
    resolveBundle,
    resolveWorldFromUrl,
    WorldIntegrityError,
} from './worldResolver';

// KebabCaseId 互換の lowercase + 数字のみ。21文字で十分な衝突耐性を確保。
const generateWorldId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 21);

// ── システム定数 ──────────────────────────────────────────────────

const SYSTEM_AUTHOR_ID = '00000000-0000-0000-0000-000000000000';

export type WorldResolution =
    | { ok: true; world: ResolvedWorld }
    | { ok: false; reason: 'not-found' | 'integrity'; message: string };

const NOT_FOUND: WorldResolution = { ok: false, reason: 'not-found', message: 'World not found' };

/** 配るファイル。リポジトリのものはファイルのパス、DB のものは中身。 */
export type WorldFile = { contentType: string } & ({ path: string } | { body: string });

/** 本体が配信するワールドの生の値（署名検証の対象そのもの）。 */
export interface HostedWorldDocument extends WorldDocument {
    lock: unknown;
    signature: unknown;
}

/**
 * 本体にバンドルを保存した結果。
 * - published: 署名が有効で、公開中の版として保存した
 * - unsigned: 署名なしで保存した（公開されない。URL から確認付きで入れる）
 * - draft: 公開中のワールドに署名なしで保存したので、公開中の版は残して下書きとして保存した
 */
export type SaveBundleResult =
    | { ok: true; world: ResolvedWorld; saved: 'published' | 'unsigned' | 'draft' }
    | {
          ok: false;
          reason: 'invalid-definition' | 'limit' | 'name-taken' | 'handle-required' | WorldSignatureInvalidReason;
          message: string;
      };

/** 署名が名乗る作者アカウント（検証前。リポジトリのワールドの URL と、配るかの事前判定に使う）。 */
function claimedAuthorOf(hosted: HostedWorldDocument | undefined): AuthorAccount | null {
    const claimed = (hosted?.signature as { author?: unknown } | null | undefined)?.author;
    return typeof claimed === 'string' ? parseAuthorAccount(claimed) : null;
}

/** 作者がこのサーバーのアカウントか（リポジトリのワールドを配ってよいか）。 */
function isOwnAuthor(identity: ResolvedWorld['identity']): boolean {
    if (identity?.status !== 'verified' || !identity.author) return false;
    return parseAuthorAccount(identity.author)?.domain === selfDomain();
}

/** Postgres の一意制約違反か（drizzle は元のエラーを cause に入れる）。 */
function isUniqueViolation(err: unknown): boolean {
    const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
    return (e?.code ?? e?.cause?.code) === '23505';
}

/** YAML の兄弟 JSON（`.lock.json` / `.sig.json`）を生の値で読む。無い・壊れていれば null。 */
function readSiblingJson(worldFilePath: string, ext: string): unknown {
    const siblingPath = worldFilePath.replace(/\.ya?ml$/i, ext);
    if (!fs.existsSync(siblingPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(siblingPath, 'utf-8')) as unknown;
    } catch {
        return null;
    }
}

// ── WorldRegistry ─────────────────────────────────────────────────

/**
 * ワールドレジストリ（URL ネイティブ）
 *
 * - ワールドの一意キーは URL（{@link ResolvedWorld.url}）。
 * - リポジトリ（イメージにバンドルした `worlds/*.yaml`）は、作者がこのサーバーのアカウントのものだけ配る。
 *   ほかのサーバーの作者のワールドは写しを配らず、作者のサーバーを連合でフォローして参照する。
 * - ユーザー作成ワールドは DB に保持（P2 で storage 抽象へ）。
 * - ファイル監視で `worlds/` の YAML 変更を自動反映する。
 *
 * instances/favorites はワールドを URL（{@link ResolvedWorld.url}）で参照するため、
 * official/registry を DB に持つ必要はない（メモリ索引のみ）。
 */
class WorldRegistry {
    private readonly worldsDir: string;

    /**
     * リポジトリのワールド（id=metadata.name → YAML のパスと、ファイルをパースしたままの YAML / lock / 署名）。
     * 解決（検証）は DB のワールドと同じく {@link getWorld} で行い、結果は `_resolvedCache` に載せる。
     */
    private _repository = new Map<string, { filePath: string; hosted: HostedWorldDocument }>();
    /** 表示順（in-memory。永続化は ordering→DB の別タスク） */
    private _order: string[] = [];

    /**
     * 本体のワールド（DB・リポジトリ）の解決キャッシュ。検証できなかった結果も短く覚える
     * （一覧のたびに同じワールドの署名検証・DB の問い合わせを繰り返さない）。
     */
    private readonly _resolvedCache = new Map<string, { resolution: WorldResolution; at: number }>();
    private static readonly LOCAL_FAILURE_TTL_MS = 60 * 1000;
    /** 外部（他インスタンス/URL）ワールドの解決キャッシュ（連合、TTL 付き） */
    private static readonly REMOTE_TTL_MS = 5 * 60 * 1000;
    /** 取得できなかった外部 URL を取り直さない時間（お気に入りなどで外部への取得を繰り返し起こされないように）。 */
    private static readonly REMOTE_FAILURE_TTL_MS = 60 * 1000;
    private static readonly REMOTE_CACHE_MAX = 2000;
    /** 作者をいま確かめられなかった（pending）ワールドは、すぐ確認し直せるよう短くキャッシュする。 */
    private static readonly REMOTE_PENDING_TTL_MS = 30 * 1000;
    private readonly _remoteCache = createRemoteWorldCache<ResolvedWorld>({
        load: (url) =>
            resolveWorldFromUrl(url, this._externalSource(url), {
                isAuthorKey,
                resolveAuthorName: resolveAuthorDisplayName,
            }),
        isIntegrityError: (err): err is WorldIntegrityError => err instanceof WorldIntegrityError,
        onFailure: (url, err) => console.error(`❌ 外部ワールド解決失敗: ${url}`, err),
        ttlMs: WorldRegistry.REMOTE_TTL_MS,
        ttlFor: (world) =>
            world.identity?.status === 'verified' && world.identity.authorPending
                ? WorldRegistry.REMOTE_PENDING_TTL_MS
                : WorldRegistry.REMOTE_TTL_MS,
        failureTtlMs: WorldRegistry.REMOTE_FAILURE_TTL_MS,
        max: WorldRegistry.REMOTE_CACHE_MAX,
    });

    /** フォロー中の連合ピア（他 ubichill インスタンス） */
    private _peers: FederationPeerRecord[] = [];
    /** ピアごとのワールド一覧キャッシュ（TTL 付き） */
    private readonly _peerWorldCache = new Map<string, { at: number; worlds: WorldListItem[] }>();
    private static readonly PEER_WORLD_TTL_MS = 5 * 60 * 1000;

    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: watcher は起動後も参照保持が必要
    private _watcher: ReturnType<typeof fs.watch> | null = null;
    private readonly _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor() {
        const envWorldsDir = process.env[ENV_KEYS.WORLDS_DIR];
        this.worldsDir = envWorldsDir
            ? path.resolve(envWorldsDir)
            : path.resolve(process.cwd(), SERVER_CONFIG.WORLDS_DIR_DEFAULT);
    }

    // ── URL ヘルパー ─────────────────────────────────────────

    private get _publicBaseUrl(): string {
        return (process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL).replace(/\/$/, '');
    }

    /**
     * 本体がホストするワールドの正規 URL（＝一意キー）。作者の ID と名前で決まり（共有 URL は `/@handle/name`）、
     * DB のワールドもリポジトリのワールドも、外部ホストと同じく YAML の URL で兄弟の `.lock.json` / `.sig.json` を同じ場所に置く。
     */
    private selfWorldUrl(handle: string, name: string): string {
        return `${this._publicBaseUrl}/api/v1/authors/${handle}/worlds/${name}.yaml`;
    }

    private localSource(url: string): WorldSource {
        return { kind: WorldSourceKind.Local, url, registryName: 'this instance' };
    }

    // ================================================================
    // 初期化
    // ================================================================

    async initialize(): Promise<void> {
        if (process.env.NODE_ENV === 'production' && !process.env[ENV_KEYS.PUBLIC_BASE_URL]) {
            console.warn(
                `⚠ ${ENV_KEYS.PUBLIC_BASE_URL} が未設定です。ワールドの正規 URL が ${SERVER_CONFIG.DEV_URL} になり連合が壊れます。`,
            );
        }
        await userRepository.ensureSystemUser(SYSTEM_AUTHOR_ID);
        await this._scanLocal();
        this._startWatcher();
        await this._loadPeers();
        console.log('👤 システムユーザーを確認しました');
    }

    /** フォロー中の連合ピアを DB から読み込む。環境変数 WORLDS_FEDERATION_PEERS からの新規追加も行う。 */
    private async _loadPeers(): Promise<void> {
        this._peers = await federationPeerRepository.findAll();
        const envPeers = (process.env.WORLDS_FEDERATION_PEERS ?? '')
            .split(',')
            .map((u) => u.trim().replace(/\/$/, ''))
            .filter((u) => u.startsWith('http'));
        for (const baseUrl of envPeers) {
            const exists = this._peers.some((p) => p.baseUrl === baseUrl);
            if (!exists) {
                try {
                    const peer = await federationPeerRepository.create({ baseUrl });
                    this._peers.push(peer);
                    console.log(`🌐 連合ピアを追加: ${baseUrl}`);
                } catch (err) {
                    console.warn(`⚠ 連合ピア追加失敗 (${baseUrl}):`, err);
                }
            }
        }
    }

    // ================================================================
    // 公開 API
    // ================================================================

    /**
     * ワールド一覧を返す。
     * - `local`: official/registry + ユーザー作成（自インスタンス）
     * - `global`: フォロー中の連合ピアから取得したワールド
     * - `all`: 両方（デフォルト）
     */
    async listWorlds(scope: 'local' | 'global' | 'all' = 'all'): Promise<WorldListItem[]> {
        const localItems = await this._listLocalWorlds();
        if (scope === 'local') return localItems;

        const globalItems = await this._listGlobalWorlds();
        if (scope === 'global') return globalItems;

        return [...localItems, ...globalItems];
    }

    /** 自インスタンスのワールド一覧（署名検証済みのみ。未署名は URL を知っている人だけが入れる）。 */
    private async _listLocalWorlds(): Promise<WorldListItem[]> {
        const allRecords = await worldRepository.findAll();
        const dbRecordByName = new Map<string, WorldRecord>(allRecords.map((r: WorldRecord) => [r.name, r]));

        const repositoryItems = await Promise.all(
            this._order.map(async (id) => {
                const w = await this.getWorld(id);
                return w ? [this._toListItem(w, dbRecordByName.get(w.id))] : [];
            }),
        );

        const known = new Set(this._repository.keys());
        const userRecords = allRecords.filter((r: WorldRecord) => !known.has(r.name));
        const dbItems = await Promise.all(
            userRecords.map(async (r: WorldRecord) => {
                const resolved = await this.getWorld(r.name);
                return resolved ? [this._toListItem(resolved, r)] : [];
            }),
        );

        return [...repositoryItems.flat(), ...dbItems.flat()].filter((w) => isPublishable(w.identity));
    }

    /**
     * 連合ピアから取得したワールド一覧。ピアの自己申告は信用せず、各ワールドを自分で取得・検証し
     * 署名検証できたものだけを返す（検証結果は外部ワールドの TTL キャッシュに乗る）。
     */
    private async _listGlobalWorlds(): Promise<WorldListItem[]> {
        const results = await Promise.allSettled(this._peers.map((peer) => this._fetchPeerWorlds(peer)));
        const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        const verified = await Promise.all(
            items.map(async (item): Promise<WorldListItem | null> => {
                const resolution = await this._resolveRemote(normalizeWorldUrl(item.url));
                if (!resolution.ok || !isPublishable(resolution.world.identity)) return null;
                // 作者名・識別はピアの自己申告ではなく、自分で解決した値を使う
                return { ...item, identity: resolution.world.identity, authorName: resolution.world.authorName };
            }),
        );
        return verified.filter((w): w is WorldListItem => w !== null);
    }

    /** 単一ピアのワールド一覧を取得する。キャッシュが有効ならそれを返す。 */
    private async _fetchPeerWorlds(peer: FederationPeerRecord): Promise<WorldListItem[]> {
        const cached = this._peerWorldCache.get(peer.baseUrl);
        if (cached && Date.now() - cached.at < WorldRegistry.PEER_WORLD_TTL_MS) {
            return cached.worlds;
        }
        try {
            const res = await safeFetch(`${peer.baseUrl}/api/v1/worlds`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) {
                console.warn(`⚠ ピア ${peer.baseUrl} からの一覧取得失敗: HTTP ${res.status}`);
                return cached?.worlds ?? [];
            }
            const data = (await res.json()) as { worlds?: WorldListItem[] };
            // identity はピアの自己申告で検証していないため落とす（入室/詳細の解決時に検証する）。
            const worlds = (data.worlds ?? []).map(({ identity: _unverified, ...w }) => ({
                ...w,
                source: { kind: WorldSourceKind.RemoteInstance, url: w.url, originInstance: peer.baseUrl },
            }));
            this._peerWorldCache.set(peer.baseUrl, { at: Date.now(), worlds });
            return worlds;
        } catch (err) {
            console.warn(`⚠ ピア ${peer.baseUrl} との通信失敗:`, err);
            return cached?.worlds ?? [];
        }
    }

    /**
     * 単一ワールドをフル解決して返す。
     * official/registry はメモリ索引、ユーザー作成は DB から。
     * @param worldId ワールド id（metadata.name）
     */
    async getWorld(worldId: string): Promise<ResolvedWorld | undefined> {
        const resolution = await this.resolveLocal(worldId);
        return resolution.ok ? resolution.world : undefined;
    }

    /** 本体のワールドを id で解決する。検証できなければ理由を返す（「見つからない」と区別する）。 */
    async resolveLocal(worldId: string): Promise<WorldResolution> {
        const cached = this._resolvedCache.get(worldId);
        if (cached && (cached.resolution.ok || Date.now() - cached.at < WorldRegistry.LOCAL_FAILURE_TTL_MS)) {
            return cached.resolution;
        }
        const repository = this._repository.get(worldId);
        const record = repository ? undefined : await worldRepository.findByName(worldId);
        // 存在しない id は覚えない（任意の id で問い合わせてキャッシュを膨らませられないように）
        if (!repository && !record) return NOT_FOUND;
        const resolution = repository
            ? await this._resolveRepositoryWorld(worldId, repository.hosted)
            : await this._resolveWorld(record as WorldRecord);
        this._resolvedCache.set(worldId, { resolution, at: Date.now() });
        return resolution;
    }

    /**
     * id または URL でワールドを解決する。instance 作成の入口。
     * - `http(s)://` → URL 解決（自ホスト or 外部＝連合）
     * - それ以外 → id（メモリ索引 or DB）
     */
    async resolveRef(idOrUrl: string): Promise<ResolvedWorld | undefined> {
        const result = await this.resolveRefDetailed(idOrUrl);
        return result.ok ? result.world : undefined;
    }

    /** {@link resolveRef} の失敗理由付き版。改竄（署名不正）を「見つからない」と区別して利用者に伝える。 */
    async resolveRefDetailed(ref: string): Promise<WorldResolution> {
        const authorRef = /^@([^/]+)\/([^/]+)$/.exec(ref);
        if (authorRef) return this.resolveByAuthorName(authorRef[1] as string, authorRef[2] as string);
        if (!/^https?:\/\//i.test(ref)) return this.resolveLocal(ref);
        const norm = normalizeWorldUrl(ref);
        const self = this._selfRef(norm);
        if (!self) return this._resolveRemote(norm);
        return 'id' in self ? this.resolveLocal(self.id) : this.resolveByAuthorName(self.handle, self.name);
    }

    /**
     * 作者の ID と名前（共有 URL `/@handle/name`）で本体のワールドを解決する。名前を変えたワールドは以前の名前でもたどれる。
     */
    async resolveByAuthorName(handle: string, name: string): Promise<WorldResolution> {
        const located = await this._locate(handle, name);
        return located ? this.resolveLocal(located.id) : NOT_FOUND;
    }

    /** 作者の ID と名前から、リポジトリのワールドか DB のワールド（以前の名前を含む）を探す。 */
    private async _locate(
        handle: string,
        name: string,
    ): Promise<{ id: string; repository?: { filePath: string }; record?: WorldRecord } | undefined> {
        const repository = this._repository.get(name);
        if (repository && claimedAuthorOf(repository.hosted)?.handle === handle) return { id: name, repository };
        if (!HANDLE_PATTERN.test(handle)) return undefined;
        const user = await userRepository.findByHandle(handle);
        if (!user) return undefined;
        const record =
            (await worldRepository.findByAuthorAndWorldName(user.id, name)) ??
            (await worldRepository.findByAuthorAndAlias(user.id, name));
        return record ? { id: record.name, record } : undefined;
    }

    /**
     * URL（＝ワールドの一意キー）でワールドを取得する。instances/favorites が参照する。
     * official/registry はメモリ索引、自ホストのユーザーワールドは self URL から id を得て DB 解決、
     * 他ホストの URL は on-demand 取得（連合、TTL キャッシュ）。
     */
    async getWorldByUrl(url: string): Promise<ResolvedWorld | undefined> {
        // 人間向け共有 URL（.../world/:id）も受け付ける（機械 URL へ正規化）。
        const result = await this.resolveRefDetailed(url);
        return result.ok ? result.world : undefined;
    }

    /**
     * 自ホストの URL なら、作者の ID と名前（`.../api/v1/authors/{handle}/worlds/{name}.yaml`）か、以前の形の内部 ID
     * （`.../api/v1/worlds/{id}`）を取り出す。他ホストは undefined。
     */
    private _selfRef(url: string): { handle: string; name: string } | { id: string } | undefined {
        try {
            const u = new URL(url);
            if (u.origin !== new URL(this._publicBaseUrl).origin) return undefined;
            const author = /^\/api\/v1\/authors\/([^/]+)\/worlds\/([^/]+)\.yaml$/.exec(u.pathname);
            if (author) return { handle: author[1] as string, name: author[2] as string };
            const legacy = /^\/api\/v1\/worlds\/([^/.]+)$/.exec(u.pathname);
            return legacy ? { id: legacy[1] as string } : undefined;
        } catch {
            return undefined;
        }
    }

    /** 外部（他インスタンス/任意 URL）のワールドをその場で解決する（連合）。TTL キャッシュ（失敗も短時間）。 */
    private _resolveRemote(url: string): Promise<WorldResolution> {
        return this._remoteCache.resolve(url);
    }

    /** 外部 URL から provenance（source）を推定する。 */
    private _externalSource(url: string): WorldSource {
        try {
            const u = new URL(url);
            if (/^\/api\/v1\/(?:authors|worlds)\//.test(u.pathname)) {
                return { kind: WorldSourceKind.RemoteInstance, url, originInstance: u.origin };
            }
            if (u.hostname.includes('github')) return { kind: WorldSourceKind.GitHub, url };
        } catch {
            // fallthrough
        }
        return { kind: WorldSourceKind.Url, url };
    }

    /** 内部用：生の DB レコードを取得 */
    async getWorldRecord(worldId: string): Promise<WorldRecord | undefined> {
        return worldRepository.findByName(worldId);
    }

    // ---- 連合ピア管理（フォロー） ----------------------------------

    /** 他 ubichill インスタンスをフォローする。 */
    async followPeer(baseUrl: string, displayName?: string): Promise<FederationPeerRecord> {
        const normalized = (() => {
            try {
                const url = new URL(baseUrl.trim());
                return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
            } catch {
                return undefined;
            }
        })();
        if (!normalized) throw new Error('baseUrl は http:// または https:// のサーバーの URL にしてください');
        // SSRF 対策: 内部/loopback/メタデータ等のホストはフォロー登録させない。
        await assertPublicUrl(normalized);
        const existing = await federationPeerRepository.findByBaseUrl(normalized);
        if (existing) return existing;
        const peer = await federationPeerRepository.create({ baseUrl: normalized, displayName });
        this._peers.push(peer);
        return peer;
    }

    /** フォローを解除する。 */
    async unfollowPeer(peerId: string): Promise<boolean> {
        const success = await federationPeerRepository.delete(peerId);
        if (success) {
            this._peers = this._peers.filter((p) => p.id !== peerId);
            this._peerWorldCache.delete(peerId);
        }
        return success;
    }

    /** フォロー中のピア一覧を返す。 */
    async listPeers(): Promise<FederationPeerRecord[]> {
        return [...this._peers];
    }

    // ---- CRUD（ユーザー操作） ----------------------------------------

    /**
     * 作者のバンドル（world 定義・lock・署名の生の値）を本体に保存する。**ホストは中身を書き換えない**（metadata.name も）。
     * 外部に置くワールドと同じく、作者 + metadata.name でワールドを区別し、同じ作者・同じ名前なら同じワールドの更新になる。
     * - 署名あり: {@link resolveBundle} で外部と同じ規則で検証し、通れば公開中の版として保存する（下書きは消す）
     * - 署名なし: 公開中（署名が有効）のワールドなら、公開中の版は残して下書きとして保存する（黙って非公開にしない）。
     *   そうでなければ署名なしのまま保存する（公開されない）
     */
    async saveBundle(
        authorId: string,
        bundle: { definition: unknown; lock: unknown; signature?: unknown },
        options: { editingId?: string; retried?: boolean } = {},
    ): Promise<SaveBundleResult> {
        const parsed = WorldDefinitionSchema.safeParse(bundle.definition);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return {
                ok: false,
                reason: 'invalid-definition',
                message: `ワールドの定義が不正です: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
            };
        }
        const worldName = parsed.data.metadata.name;
        const handle = (await userRepository.findById(authorId))?.handle;
        if (!handle) {
            return {
                ok: false,
                reason: 'handle-required',
                message: '先に ID を設定してください（ワールドの URL になります）',
            };
        }
        const lock = bundle.lock === undefined ? null : bundle.lock;
        const existing = await worldRepository.findByAuthorAndWorldName(authorId, worldName);
        const editingRecord = options.editingId ? await worldRepository.findByName(options.editingId) : undefined;
        const editing = editingRecord?.authorId === authorId ? editingRecord : undefined;
        const nameTaken = (where: string): SaveBundleResult => ({
            ok: false,
            reason: 'name-taken',
            message: `名前「${worldName}」は${where}で使われています。別の名前にしてください`,
        });
        // 編集中のワールドと違う既存のワールドに当たったら、黙って上書きしない
        if (existing && editing && existing.id !== editing.id) return nameTaken('あなたの別のワールド');
        if (!existing && claimedAuthorOf(this._repository.get(worldName)?.hosted)?.handle === handle) {
            return nameTaken('リポジトリのワールド');
        }
        // 同じ名前のワールドがあればその更新、無くて編集中のワールドがあればその名前の変更（URL も変わり、以前の URL からもたどれる）
        const target = existing ?? editing;
        if (!target && (await worldRepository.countByAuthorId(authorId)) >= LIMITS.MAX_WORLDS_PER_USER) {
            return {
                ok: false,
                reason: 'limit',
                message: `1ユーザーが作成できるワールドは ${LIMITS.MAX_WORLDS_PER_USER} 個までです`,
            };
        }
        const urlId = target?.name ?? generateWorldId();
        const url = this.selfWorldUrl(handle, worldName);

        const verified =
            bundle.signature === undefined
                ? undefined
                : await resolveBundle(
                      { definition: bundle.definition, lock, signature: bundle.signature },
                      url,
                      this.localSource(url),
                      { isAuthorKey, resolveAuthorName: resolveAuthorDisplayName, authorId },
                  ).then(
                      ({ resolved }) => resolved.identity,
                      (err: unknown) => {
                          if (err instanceof WorldIntegrityError) return err;
                          throw err;
                      },
                  );
        if (verified instanceof WorldIntegrityError) {
            return { ok: false, reason: verified.reason, message: verified.message };
        }
        if (verified && verified.status !== 'verified') {
            return { ok: false, reason: 'malformed', message: '署名を確認できません' };
        }

        const published = target ? await this.getWorld(target.name) : undefined;
        const keepPublished = !verified && published?.identity?.status === 'verified';
        // 公開中の版に署名し直しただけなら下書きは残す
        const keepDraft = !!verified && verified.contentHash === published?.identity?.contentHash;
        // 公開中の版を残す下書きでは名前を変えない（公開するときに変わる）
        const fields = keepPublished
            ? {
                  draftDefinition: bundle.definition,
                  draftLock: lock as ModLock | null,
                  draftUpdatedAt: new Date(),
              }
            : {
                  worldName,
                  version: parsed.data.metadata.version,
                  definition: bundle.definition,
                  lock: lock as ModLock | null,
                  signature: (bundle.signature as WorldSignature | undefined) ?? null,
                  ...(keepDraft ? {} : { draftDefinition: null, draftLock: null, draftUpdatedAt: null }),
              };
        const saved = await (target
            ? worldRepository.update(target.id, fields)
            : worldRepository.create({
                  authorId,
                  name: urlId,
                  worldName,
                  version: parsed.data.metadata.version,
                  definition: bundle.definition,
                  lock: lock as ModLock | null,
                  signature: (bundle.signature as WorldSignature | undefined) ?? null,
              })
        ).catch((err: unknown) => {
            if (!isUniqueViolation(err)) throw err;
            // 作成: 同じ作者・同じ名前の作成が同時に来た（2 つのタブ・CI のリトライ）。もう一方が作ったワールドの更新にする
            // 名前の変更: その間に同じ名前のワールドが作られた
            return target ? ('taken' as const) : options.retried ? ('taken' as const) : ('retry' as const);
        });
        if (saved === 'retry') return this.saveBundle(authorId, bundle, { ...options, retried: true });
        if (saved === 'taken') return nameTaken('あなたの別のワールド');
        if (!saved) return { ok: false, reason: 'invalid-definition', message: 'ワールドを保存できませんでした' };
        this._resolvedCache.delete(urlId);
        const world = await this.getWorld(urlId);
        if (!world) return { ok: false, reason: 'invalid-definition', message: 'ワールドを読み込めませんでした' };
        return {
            ok: true,
            world,
            saved: keepPublished ? 'draft' : bundle.signature !== undefined ? 'published' : 'unsigned',
        };
    }

    // NOTE: 外部/リモートのワールドは DB にコピーしない（＝連合は参照のみ）。
    // 単発で入るなら resolveRef(URL)→instance 作成、永続的に見たいならピアをフォローする。

    /** エディタ用: 下書きがあれば下書き、無ければ本体の定義と、公開状態。 */
    async getEditorDefinition(
        worldId: string,
    ): Promise<{ definition: WorldDefinition; hasDraft: boolean; published: boolean } | undefined> {
        const record = await worldRepository.findByName(worldId);
        if (!record) return undefined;
        // 保存したのは作者が送った生の値なので、既定値を補ってから渡す
        const definition = parseStoredDefinition(record.draftDefinition ?? record.definition);
        if (!definition) return undefined;
        const world = await this.getWorld(worldId);
        return {
            definition,
            hasDraft: !!record.draftDefinition,
            published: isPublishable(world?.identity),
        };
    }

    async deleteWorld(worldId: string): Promise<boolean> {
        const existing = await worldRepository.findByName(worldId);
        if (!existing) return false;
        const success = await worldRepository.delete(existing.id);
        if (success) this._resolvedCache.delete(worldId);
        return success;
    }

    /** 全件リロード（緊急用・SIGUSR2 などから呼ばれる） */
    async reloadWorlds(): Promise<void> {
        this._resolvedCache.clear();
        await this._scanLocal();
        console.log('✅ ワールド定義を全件再読み込みしました');
    }

    /** 特定ワールドのみリロード（API から呼ばれる） */
    async reloadWorld(worldId: string): Promise<boolean> {
        const file = this._repository.get(worldId)?.filePath;
        if (!file) return false;
        await this._onYamlChanged(path.basename(file));
        return true;
    }

    /** ワールドの表示順を変更する（in-memory）。 */
    async reorderWorlds(order: string[]): Promise<void> {
        const known = new Set(this._order);
        const filtered = order.filter((n) => known.has(n));
        const rest = this._order.filter((n) => !filtered.includes(n));
        this._order = [...filtered, ...rest];
    }

    // ================================================================
    // プライベート: ローカルスキャン
    // ================================================================

    private async _scanLocal(): Promise<void> {
        this._repository.clear();
        this._resolvedCache.clear();
        const nextOrder: string[] = [];
        if (!fs.existsSync(this.worldsDir)) {
            this._order = nextOrder;
            return;
        }
        const files = fs.readdirSync(this.worldsDir).filter((f) => /\.(ya?ml)$/.test(f));
        for (const file of files) {
            const filePath = path.join(this.worldsDir, file);
            const id = this._indexLocalFile(filePath);
            if (id) nextOrder.push(id);
        }
        // 既存の順序を優先しつつ新規を末尾へ
        const prev = new Map(this._order.map((id, i) => [id, i]));
        nextOrder.sort((a, b) => (prev.get(a) ?? 999) - (prev.get(b) ?? 999));
        this._order = nextOrder;
        const served = (await Promise.all(nextOrder.map((id) => this.getWorld(id)))).filter(Boolean).length;
        console.log(
            `📋 worlds/ の ${nextOrder.length} ワールドのうち ${served} 個を配ります（ほかのサーバーの作者のものは配らない）`,
        );
    }

    /** リポジトリ（worlds/）の 1 つのワールドを読み込む（検証は {@link getWorld} で行う）。読めなければ undefined。 */
    private _indexLocalFile(filePath: string): string | undefined {
        try {
            const hosted: HostedWorldDocument = {
                definition: yaml.parse(fs.readFileSync(filePath, 'utf-8')) as unknown,
                lock: readSiblingJson(filePath, '.lock.json'),
                signature: readSiblingJson(filePath, '.sig.json'),
            };
            const name = (hosted.definition as { metadata?: { name?: unknown } } | null)?.metadata?.name;
            if (typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name)) {
                throw new Error('metadata.name は [a-z0-9-] で書いてください');
            }
            this._repository.set(name, { filePath, hosted });
            this._resolvedCache.delete(name);
            return name;
        } catch (err) {
            console.error(`❌ リポジトリのワールドを読み込めません（配信しません）: ${filePath}`, err);
            return undefined;
        }
    }

    /**
     * リポジトリのワールドを、外部のワールドと同じ {@link resolveBundle} で検証する（ファイルから読むのは取得の方法だけ）。
     * 配るのは作者がこのサーバーのアカウントのものだけ。ほかのサーバーの作者のものは写しを配らない（作者のサーバーを連合でフォローする）。
     */
    private async _resolveRepositoryWorld(id: string, hosted: HostedWorldDocument): Promise<WorldResolution> {
        // 署名が名乗る作者がほかのサーバーなら検証もしない（一覧のたびに作者のサーバーへ問い合わせない）
        const claimed = claimedAuthorOf(hosted);
        if (!claimed || claimed.domain !== selfDomain()) return NOT_FOUND;
        const author = await userRepository.findByHandle(claimed.handle);
        if (!author) return NOT_FOUND;
        const resolution = await this._verify(id, this.selfWorldUrl(claimed.handle, id), hosted, author.id);
        if (resolution.ok && !isOwnAuthor(resolution.world.identity)) {
            console.warn(`↪ リポジトリのワールド ${id} は作者（@${claimed.handle}）の鍵を確かめられないため配りません`);
            return NOT_FOUND;
        }
        return resolution;
    }

    /**
     * 本体が配るワールドのファイル（`/api/v1/authors/<handle>/worlds/<name>.yaml` と兄弟の `.lock.json` / `.sig.json`）。
     * リポジトリのワールドは置いてあるファイルをそのまま、DB のワールドは保存した値をファイルにして返す（公開中の版。下書きは配らない）。
     * 配り方はどちらも同じで、外部ホストとも同じ。無ければ undefined。
     */
    async worldFile(handle: string, fileName: string): Promise<WorldFile | undefined> {
        const m = /^([a-z0-9-]+)\.(yaml|lock\.json|sig\.json)$/.exec(fileName);
        if (!m) return undefined;
        const [, name, kind] = m as unknown as [string, string, 'yaml' | 'lock.json' | 'sig.json'];
        const contentType = kind === 'yaml' ? 'application/yaml; charset=utf-8' : 'application/json; charset=utf-8';
        const located = await this._locate(handle, name);
        if (located?.repository) {
            if (!(await this.getWorld(located.id))) return undefined;
            const yamlPath = located.repository.filePath;
            const filePath = kind === 'yaml' ? yamlPath : yamlPath.replace(/\.ya?ml$/i, `.${kind}`);
            return fs.existsSync(filePath) ? { contentType, path: filePath } : undefined;
        }
        const record = located?.record;
        if (!record) return undefined;
        if (kind === 'yaml') return { contentType, body: yaml.stringify(record.definition) };
        const value = kind === 'lock.json' ? record.lock : record.signature;
        return value ? { contentType, body: JSON.stringify(value) } : undefined;
    }

    // ================================================================
    // プライベート: ファイル監視
    // ================================================================

    private _startWatcher(): void {
        if (!fs.existsSync(this.worldsDir)) return;
        this._watcher = fs.watch(this.worldsDir, (_event, filename) => {
            if (!filename) return;

            // A world lock is intentionally stored next to (not inside) its YAML.
            // Re-index the YAML when either half changes so a running dev backend
            // never keeps serving worker URLs from the previous build.
            let yamlFilename: string | undefined;
            if (/\.ya?ml$/.test(filename)) {
                yamlFilename = filename;
            } else {
                const sibling = /\.(lock|sig)\.json$/.exec(filename);
                if (sibling) {
                    const ext = `.${sibling[1]}.json`;
                    const trackedFile = [...this._repository.values()]
                        .map((r) => r.filePath)
                        .find((filePath) => path.basename(filePath).replace(/\.ya?ml$/i, ext) === filename);
                    yamlFilename = trackedFile ? path.basename(trackedFile) : filename.replace(ext, '.yaml');
                }
            }
            if (!yamlFilename) return;

            const key = yamlFilename;
            const prev = this._debounceTimers.get(key);
            if (prev) clearTimeout(prev);
            this._debounceTimers.set(
                key,
                setTimeout(() => {
                    this._debounceTimers.delete(key);
                    void this._onYamlChanged(yamlFilename);
                }, 300),
            );
        });
        console.log('👁  worlds/ の YAML / lock / sig を監視中（変更時に自動リロード）');
    }

    private async _onYamlChanged(filename: string): Promise<void> {
        const filePath = path.join(this.worldsDir, filename);

        // ファイル削除
        if (!fs.existsSync(filePath)) {
            const id = [...this._repository.entries()].find(([, r]) => path.basename(r.filePath) === filename)?.[0];
            if (id) {
                this._repository.delete(id);
                this._resolvedCache.delete(id);
                this._order = this._order.filter((n) => n !== id);
                console.log(`🗑  ワールド削除を検知: ${id}`);
            }
            return;
        }

        const id = this._indexLocalFile(filePath);
        if (!id) return;
        if (!this._order.includes(id)) this._order.push(id);
        const resolved = await this.getWorld(id);
        console.log(
            resolved
                ? `✅ ワールド自動リロード: ${id} (v${resolved.version})`
                : `↪ ${id} は作者を確かめられないか、ほかのサーバーの作者のため配りません`,
        );
    }

    // ================================================================
    // プライベート: 変換ヘルパー
    // ================================================================

    /** DB レコード → ResolvedWorld。外部のワールドと同じく {@link resolveBundle} で検証する（同じ規則）。 */
    private async _resolveWorld(record: WorldRecord): Promise<WorldResolution> {
        const handle = (await userRepository.findById(record.authorId))?.handle;
        // 公開の URL は作者の ID で決まるので、ID の無い作者（以前のアカウント）のワールドは配れない
        if (!handle) {
            return { ok: false, reason: 'not-found', message: '作者の ID が未設定のため配信していません' };
        }
        return this._verify(
            record.name,
            this.selfWorldUrl(handle, record.worldName),
            { definition: record.definition, lock: record.lock ?? null, signature: record.signature ?? null },
            record.authorId,
        );
    }

    /**
     * 本体のワールドの組を検証する。署名が内容と一致しない（改竄・規則違反）なら配信せず、理由を返す
     * （外部のワールドと同じく拒否する。未署名に格下げしない）。作者名は確認できた作者アカウントの表示名。
     */
    private async _verify(
        id: string,
        url: string,
        hosted: HostedWorldDocument,
        authorId: string,
    ): Promise<WorldResolution> {
        try {
            const { resolved } = await resolveBundle(hosted, url, this.localSource(url), {
                isAuthorKey,
                resolveAuthorName: resolveAuthorDisplayName,
                authorId,
            });
            return { ok: true, world: { ...resolved, id } };
        } catch (err) {
            if (err instanceof WorldIntegrityError) {
                console.warn(`⚠ ワールド ${id} の署名が内容と一致しないため配信しません（${err.reason}）`);
                return {
                    ok: false,
                    reason: 'integrity',
                    message: `署名が内容と一致しないため配信していません（${err.reason}）。作者が公開し直す必要があります`,
                };
            }
            console.error(`❌ ワールド ${id} を読み込めません（配信しません）`, err);
            return { ok: false, reason: 'integrity', message: 'ワールドの定義を読み込めないため配信していません' };
        }
    }

    /**
     * キャッシュ済みの解決結果（作者表示・作者名・worldId）を捨てる。作者の署名鍵や表示名が変わったときに呼ぶ。
     * official の索引は作者アカウントを持たない（メンテナ鍵のみ）ので対象外。
     */
    invalidateResolvedWorlds(): void {
        this._resolvedCache.clear();
        this._remoteCache.clearWorlds();
    }

    /**
     * URL（または id）で解決し、公開ルールを満たすときだけ一覧の項目にする（お気に入りなど URL で持つ参照用）。
     * 外部ワールドも自分で取得・検証した結果を使う。満たさなければ undefined。
     */
    async publishableListItem(ref: string): Promise<WorldListItem | undefined> {
        const resolution = await this.resolveRefDetailed(ref);
        if (!resolution.ok || !isPublishable(resolution.world.identity)) return undefined;
        return this._toListItem(resolution.world);
    }

    /**
     * リポジトリ（worlds/）で管理しているワールドのうち、作者がこれらの作者アカウントのもの。
     * DB のワールドではないので画面からは編集・削除できない（変更はリポジトリの PR で行う）。
     */
    async repositoryWorldsByAuthor(accounts: readonly string[]): Promise<ResolvedWorld[]> {
        const worlds = await Promise.all(this._order.map((id) => this.getWorld(id)));
        return worlds.filter(
            (w): w is ResolvedWorld =>
                !!w && w.identity?.status === 'verified' && !!w.identity.author && accounts.includes(w.identity.author),
        );
    }

    /** ResolvedWorld(+DB record) → WorldListItem。 */
    private _toListItem(w: ResolvedWorld, rec?: WorldRecord): WorldListItem {
        return {
            url: w.url,
            source: w.source,
            id: w.id,
            displayName: w.displayName,
            description: w.description,
            thumbnail: w.thumbnail,
            version: w.version,
            capacity: w.capacity,
            authorId: rec?.authorId ?? w.authorId,
            authorName: w.authorName,
            mods: w.mods,
            identity: w.identity,
            createdAt: rec ? rec.createdAt.toISOString() : undefined,
            updatedAt: rec ? rec.updatedAt.toISOString() : undefined,
        };
    }
}

export const worldRegistry = new WorldRegistry();
