import fs from 'node:fs';
import path from 'node:path';
import {
    editorWorldOf,
    type FederationPeerRecord,
    federationPeerRepository,
    type PublishOutcome,
    servedWorldOf,
    userRepository,
    type WorldRecord,
    type WorldState,
    worldRepository,
} from '@ubichill/db';
import {
    type AuthorAccount,
    ENV_KEYS,
    HANDLE_PATTERN,
    isPublishable,
    limitsFor,
    type ModLock,
    OFFICIAL_HANDLE,
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
import yaml from 'yaml';
import { isAuthorKey, resolveAuthorDisplayName } from './authorKeyStore';
import { selfDomain } from './authorKeys';
import { type BackendEvents, backendEvents } from './backendEvents';
import { federatedCandidates, uniqueByWorldId } from './federatedWorlds';
import { createRemoteWorldCache } from './remoteWorldCache';
import { assertPublicUrl, safeFetch } from './safeFetch';
import {
    normalizeWorldUrl,
    parseStoredDefinition,
    resolveBundle,
    resolveWorldFromUrl,
    WorldIntegrityError,
} from './worldResolver';

// ── システム定数 ──────────────────────────────────────────────────

const SYSTEM_AUTHOR_ID = '00000000-0000-0000-0000-000000000000';

export type WorldResolution =
    | {
          ok: true;
          world: ResolvedWorld;
          /** 自サーバーで公開した版から配るときだけ（インスタンスに記録する）。 */
          versionId?: string;
      }
    | {
          ok: false;
          reason: 'not-found' | 'integrity';
          message: string;
          /** 署名を検証できなかった理由（本体のワールドだけ。作者に直し方を案内するため）。 */
          signatureReason?: WorldSignatureInvalidReason;
      };

const NOT_FOUND: WorldResolution = { ok: false, reason: 'not-found', message: 'World not found' };

/** ワールドはあるが、その版（content_hash）はもう残っていない（古い版を消した）。 */
export type VersionResolution = WorldResolution | { ok: false; reason: 'gone'; message: string };

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
          reason:
              | 'invalid-definition'
              | 'limit'
              | 'name-taken'
              | 'author-not-found'
              | 'version-conflict'
              | WorldSignatureInvalidReason;
          message: string;
      };

/** 署名が名乗る作者アカウント（検証前。リポジトリのワールドの URL と、配るかの事前判定に使う）。 */
/**
 * リポジトリ（worlds/）のワールドの扱い。
 * - 自サーバーの作者の署名 → 作者の鍵で確かめて配る
 * - ほかのサーバーの作者の署名 → 配らない（一覧のたびに作者のサーバーへ問い合わせない）
 * - 署名なし → 配らない。開発・プレビュー（`WORLDS_SERVE_UNSIGNED_REPOSITORY=true`）だけ、公式アカウントの名義で「署名なし」として配る。
 *   公式ワールドの署名は main への push でしか付けないので、無いとプレビューに入れるワールドが 1 つも無くなる
 */
export type RepositoryWorldPolicy = 'verify-own' | 'serve-unsigned' | 'skip';

export function repositoryWorldPolicy(
    claimed: AuthorAccount | null,
    ownDomain: string,
    serveUnsigned: boolean,
): RepositoryWorldPolicy {
    if (claimed) return claimed.domain === ownDomain ? 'verify-own' : 'skip';
    return serveUnsigned ? 'serve-unsigned' : 'skip';
}

const serveUnsignedRepositoryWorlds = (): boolean => process.env.WORLDS_SERVE_UNSIGNED_REPOSITORY === 'true';

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
    /**
     * 表示順（in-memory。永続化は ordering→DB の別タスク）。backend を複数にすると、並べ替えた backend にしか効かない
     * （ほかの backend に知らせてもいない。Postgres に移すまでの既知の制限）。
     */
    private _order: string[] = [];

    /**
     * 本体のワールド（DB・リポジトリ）の解決キャッシュ。検証できなかった結果も短く覚える
     * （一覧のたびに同じワールドの署名検証・DB の問い合わせを繰り返さない）。
     * ほかの backend での保存・削除は知らせ（{@link BackendEvents}）で捨てるが、届かなくても LOCAL_TTL_MS で揃う。
     */
    private readonly _resolvedCache = new Map<string, { resolution: WorldResolution; at: number }>();
    private static readonly LOCAL_TTL_MS = 5 * 60 * 1000;
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

    /** フォロー中の連合ピア（他 ubichill インスタンス）。ほかの backend でのフォローの変更に追いつくよう、期限で DB から読み直す。 */
    private _peers: FederationPeerRecord[] = [];
    private _peersLoadedAt = 0;
    private static readonly PEER_LIST_TTL_MS = 5 * 60 * 1000;
    /** ピアごとのワールド一覧キャッシュ（TTL 付き） */
    private readonly _peerWorldCache = new Map<string, { at: number; worlds: WorldListItem[] }>();
    private static readonly PEER_WORLD_TTL_MS = 5 * 60 * 1000;

    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: watcher は起動後も参照保持が必要
    private _watcher: ReturnType<typeof fs.watch> | null = null;
    private readonly _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(private readonly events: BackendEvents = backendEvents) {
        events.on('world.changed', ({ worldId }) => {
            this._resolvedCache.delete(worldId);
        });
        events.on('world.reload', ({ worldId }) => this._reloadWorldHere(worldId).then(() => undefined));
        events.on('worlds.reload', () => this._reloadWorldsHere());
        events.on('worlds.resolved-stale', () => this._dropResolvedHere());
        events.on('remote.changed', ({ url }) => {
            this._remoteCache.forget(url);
        });
        events.on('peers.changed', () => this._reloadPeers());
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
    hostedWorldUrl(handle: string, name: string): string {
        return this.selfWorldUrl(handle, name);
    }

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
        await this._reloadPeers();
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
     * ワールド一覧を返す。ローカルと連合は混ぜない。
     * - `local`: このサーバーのワールド（リポジトリ + ユーザー作成）
     * - `global`: フォロー中の連合ピアのワールド（各ピアのローカルだけ）
     */
    async listWorlds(scope: 'local' | 'global'): Promise<WorldListItem[]> {
        return scope === 'local' ? this._listLocalWorlds() : this._listGlobalWorlds();
    }

    /** 自インスタンスのワールド一覧（署名検証済みのみ。未署名は URL を知っている人だけが入れる）。 */
    private async _listLocalWorlds(): Promise<WorldListItem[]> {
        const allRecords = await worldRepository.findAll();
        const dbRecordById = new Map<string, WorldRecord>(allRecords.map((r: WorldRecord) => [r.id, r]));

        const repositoryItems = await Promise.all(
            this._order.map(async (id) => {
                const w = await this.getWorld(id);
                return w ? [this._toListItem(w, dbRecordById.get(w.id))] : [];
            }),
        );

        const known = new Set(this._repository.keys());
        const userRecords = allRecords.filter((r: WorldRecord) => !known.has(r.id));
        const dbItems = await Promise.all(
            userRecords.map(async (r: WorldRecord) => {
                const resolved = await this.getWorld(r.id);
                return resolved ? [this._toListItem(resolved, r)] : [];
            }),
        );

        // 開発・プレビューで署名なしとして配っている同梱ワールドも一覧に出す（利用者のワールドは署名済みだけ）
        const repositoryListed = repositoryItems
            .flat()
            .filter((w) => isPublishable(w.identity) || serveUnsignedRepositoryWorlds());
        return [...repositoryListed, ...dbItems.flat().filter((w) => isPublishable(w.identity))];
    }

    /**
     * 連合ピアから取得したワールド一覧。ピアの自己申告は信用せず、各ワールドを自分で取得・検証し
     * 署名検証できたものだけを返す（検証結果は外部ワールドの TTL キャッシュに乗る）。
     */
    private async _listGlobalWorlds(): Promise<WorldListItem[]> {
        if (Date.now() - this._peersLoadedAt >= WorldRegistry.PEER_LIST_TTL_MS) {
            await this._reloadPeers().catch((err: unknown) => console.warn('⚠ 連合ピアを読み直せません:', err));
        }
        const results = await Promise.allSettled(this._peers.map((peer) => this._fetchPeerWorlds(peer)));
        const candidates = federatedCandidates(
            results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
            this._publicBaseUrl,
        );
        const verified = await Promise.all(
            candidates.map(async (item): Promise<WorldListItem | null> => {
                const resolution = await this._resolveRemote(normalizeWorldUrl(item.url));
                if (!resolution.ok || !isPublishable(resolution.world.identity)) return null;
                // 表示する値（名前・説明・作者・識別）はピアの申告ではなく、自分で取得して確かめたワールドから作る。
                // どのピアから知ったか（source）だけはピアの一覧の値を使う
                return { ...this._toListItem(resolution.world), source: item.source };
            }),
        );
        return uniqueByWorldId(verified.filter((w): w is WorldListItem => w !== null));
    }

    /** 単一ピアのワールド一覧を取得する。キャッシュが有効ならそれを返す。 */
    private async _fetchPeerWorlds(peer: FederationPeerRecord): Promise<WorldListItem[]> {
        const cached = this._peerWorldCache.get(peer.baseUrl);
        if (cached && Date.now() - cached.at < WorldRegistry.PEER_WORLD_TTL_MS) {
            return cached.worlds;
        }
        try {
            // ピアのローカルだけを取る（ピアが連合で受け取ったワールドまで取り込まない）
            const res = await safeFetch(`${peer.baseUrl}/api/v1/worlds?scope=local`, {
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
        const ttl = cached?.resolution.ok ? WorldRegistry.LOCAL_TTL_MS : WorldRegistry.LOCAL_FAILURE_TTL_MS;
        if (cached && Date.now() - cached.at < ttl) {
            return cached.resolution;
        }
        const repository = this._repository.get(worldId);
        const state = repository ? undefined : await worldRepository.findState(worldId);
        // 存在しない id は覚えない（任意の id で問い合わせてキャッシュを膨らませられないように）
        if (!repository && !state) return NOT_FOUND;
        const resolution = repository
            ? await this._resolveRepositoryWorld(worldId, repository.hosted)
            : await this._resolveWorld(state as WorldState);
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
        if (repository) {
            const claimed = claimedAuthorOf(repository.hosted);
            // 署名なしとして配っている同梱ワールドは公式アカウントの名義（_resolveRepositoryWorld と同じ規則）
            const owner = claimed?.handle ?? (serveUnsignedRepositoryWorlds() ? OFFICIAL_HANDLE : undefined);
            if (owner === handle) return { id: name, repository };
        }
        if (!HANDLE_PATTERN.test(handle)) return undefined;
        const user = await userRepository.findByHandle(handle);
        if (!user) return undefined;
        const record =
            (await worldRepository.findByAuthorAndWorldName(user.id, name)) ??
            (await worldRepository.findByAuthorAndAlias(user.id, name));
        return record ? { id: record.id, record } : undefined;
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

    /** 外部のワールドを取り直して解決する（作者が公開し直したのを確かめ直すとき。呼び出し側で回数を抑えること）。 */
    async resolveRemoteFresh(url: string): Promise<WorldResolution> {
        const norm = normalizeWorldUrl(url);
        if (this._selfRef(norm)) return NOT_FOUND;
        this._remoteCache.forget(norm);
        this.events.broadcast({ type: 'remote.changed', url: norm });
        return this._resolveRemote(norm);
    }

    /** 外部のワールドを解決する（キャッシュを使う）。このサーバーのワールドの URL は外部として扱わない。 */
    async resolveRemote(url: string): Promise<WorldResolution> {
        const norm = normalizeWorldUrl(url);
        return this._selfRef(norm) ? NOT_FOUND : this._resolveRemote(norm);
    }

    /** 一覧の 1 件の形にする（外部の作品をユーザーページ・一覧に出すとき）。 */
    listItemOf(world: ResolvedWorld): WorldListItem {
        return this._toListItem(world);
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
        return worldRepository.findById(worldId);
    }

    /**
     * 本体のワールドの、残っている版を content_hash で解決する。ワールドが無ければ not-found、版を消していれば gone。
     * 未公開のワールドが署名なしとして配っている下書きも、いまの中身と同じ content_hash なら返す。
     */
    async resolveVersion(worldId: string, contentHash: string): Promise<VersionResolution> {
        const world = await worldRepository.findById(worldId);
        if (!world) return NOT_FOUND;
        const latest = await this.resolveLocal(worldId);
        if (latest.ok && latest.world.identity?.contentHash === contentHash) return latest;
        const version = await worldRepository.findVersionByContentHash(worldId, contentHash);
        if (!version) {
            return { ok: false, reason: 'gone', message: 'この版は残っていません（古い版は消しています）' };
        }
        const handle = (await userRepository.findById(world.authorId))?.handle;
        if (!handle) return { ok: false, reason: 'not-found', message: '作者のアカウントが見つかりません' };
        const resolution = await this._verify(
            world.id,
            this.selfWorldUrl(handle, world.worldName),
            { definition: version.definition, lock: version.lock ?? null, signature: version.signature ?? null },
            world.authorId,
        );
        return resolution.ok ? { ...resolution, versionId: version.id } : resolution;
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
        this.events.broadcast({ type: 'peers.changed' });
        return peer;
    }

    /** フォローを解除する。 */
    async unfollowPeer(peerId: string): Promise<boolean> {
        const success = await federationPeerRepository.delete(peerId);
        if (success) {
            this._setPeers(this._peers.filter((p) => p.id !== peerId));
            this.events.broadcast({ type: 'peers.changed' });
        }
        return success;
    }

    /** フォロー中のピアを DB から読み直す（ほかの backend でのフォローの変更に追いつく）。 */
    private async _reloadPeers(): Promise<void> {
        this._setPeers(await federationPeerRepository.findAll());
    }

    private _setPeers(peers: FederationPeerRecord[]): void {
        const followed = new Set(peers.map((p) => p.baseUrl));
        for (const baseUrl of this._peerWorldCache.keys()) {
            if (!followed.has(baseUrl)) this._peerWorldCache.delete(baseUrl);
        }
        this._peers = peers;
        this._peersLoadedAt = Date.now();
    }

    /** フォロー中のピア一覧を返す。 */
    async listPeers(): Promise<FederationPeerRecord[]> {
        return [...this._peers];
    }

    // ---- CRUD（ユーザー操作） ----------------------------------------

    /**
     * 作者のバンドル（world 定義・lock・署名の生の値）を本体に保存する。**ホストは中身を書き換えない**（metadata.name も）。
     * 外部に置くワールドと同じく、作者 + metadata.name でワールドを区別し、同じ作者・同じ名前なら同じワールドの更新になる。
     * - 署名あり: {@link resolveBundle} で外部と同じ規則で検証し、通れば版として公開する（下書きは消す）。
     *   同じ version で中身が違えば拒否する。残す数を超えた古い版は消す
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
        if (!handle) return { ok: false, reason: 'author-not-found', message: '作者のアカウントが見つかりません' };
        const lock = bundle.lock === undefined ? null : bundle.lock;
        const existing = await worldRepository.findByAuthorAndWorldName(authorId, worldName);
        const editingRecord = options.editingId ? await worldRepository.findById(options.editingId) : undefined;
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
        const { maxWorlds } = limitsFor({ id: authorId });
        if (!target && (await worldRepository.countByAuthorId(authorId)) >= maxWorlds) {
            return {
                ok: false,
                reason: 'limit',
                message: `1ユーザーが作成できるワールドは ${maxWorlds} 個までです`,
            };
        }
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

        const published = target ? await this.getWorld(target.id) : undefined;
        const keepPublished = !verified && published?.identity?.status === 'verified';
        const saved = await this._store(authorId, target, worldName, {
            definition: bundle.definition,
            lock: lock as ModLock | null,
            version: parsed.data.metadata.version,
            signature: verified
                ? { value: bundle.signature as WorldSignature, contentHash: verified.contentHash }
                : null,
            keepPublished,
        }).catch((err: unknown) => {
            if (!isUniqueViolation(err)) throw err;
            // 作成: 同じ作者・同じ名前の作成が同時に来た（2 つのタブ・CI のリトライ）。もう一方が作ったワールドの更新にする
            // 名前の変更: その間に同じ名前のワールドが作られた。同じ版の公開が同時に来た。どれも読み直して決め直す
            return options.retried ? ('taken' as const) : ('retry' as const);
        });
        if (saved === 'retry') return this.saveBundle(authorId, bundle, { ...options, retried: true });
        if (saved === 'taken') return nameTaken('あなたの別のワールド');
        if (saved.status === 'version-conflict') {
            return {
                ok: false,
                reason: 'version-conflict',
                message: `版 ${saved.version} は別の内容で公開済みです。metadata.version を上げてから公開してください`,
            };
        }
        const worldId = saved.worldId;
        this._resolvedCache.delete(worldId);
        this.events.broadcast({ type: 'world.changed', worldId });
        if (saved.status === 'published') await this._pruneVersions(worldId, authorId);
        const world = await this.getWorld(worldId);
        if (!world) return { ok: false, reason: 'invalid-definition', message: 'ワールドを読み込めませんでした' };
        return {
            ok: true,
            world,
            saved: keepPublished ? 'draft' : bundle.signature !== undefined ? 'published' : 'unsigned',
        };
    }

    /**
     * 保存の DB 側。署名を確かめたものは版として公開し、署名なしは下書きにする。公開中の版を残す下書き（keepPublished）では
     * 名前を変えない（公開するときに変わる）。そうでない署名なしの保存は、公開中を外して下書きを署名なしとして配る
     * （0023 より前に、署名なしで上書きして公開されなくなっていたのと同じ）。
     */
    private async _store(
        authorId: string,
        target: WorldRecord | undefined,
        worldName: string,
        input: {
            definition: unknown;
            lock: ModLock | null;
            version: string;
            signature: { value: WorldSignature; contentHash: string } | null;
            keepPublished: boolean;
        },
    ): Promise<PublishOutcome | { status: 'draft'; worldId: string }> {
        if (input.signature) {
            return worldRepository.publish(
                { authorId, worldName, worldId: target?.id },
                {
                    version: input.version,
                    definition: input.definition,
                    lock: input.lock,
                    signature: input.signature.value,
                    contentHash: input.signature.contentHash,
                },
            );
        }
        const worldId = await worldRepository.saveDraft(
            {
                authorId,
                worldName: input.keepPublished && target ? target.worldName : worldName,
                worldId: target?.id,
            },
            { definition: input.definition, lock: input.lock, unpublish: !input.keepPublished },
        );
        return { status: 'draft', worldId };
    }

    /** 残す数を超えた古い版を消す。消せなくても公開は止めない（インスタンスが指す版は、次の公開か定期処理で消し直す）。 */
    private async _pruneVersions(worldId: string, authorId: string): Promise<void> {
        await worldRepository
            .pruneVersions(worldId, limitsFor({ id: authorId }).maxVersionsPerWorld)
            .catch((err: unknown) =>
                console.warn(`⚠ ワールド ${worldId} の古い版を消せませんでした（あとで消し直す）`, err),
            );
    }

    /** 定期処理: どのワールドでも、残す数を超えた古い版を消し直す（インスタンスが無くなって消せるようになった版）。 */
    async pruneAllVersions(): Promise<void> {
        const targets = await worldRepository.findWorldsWithOldVersions();
        for (const { id, authorId } of targets) await this._pruneVersions(id, authorId);
    }

    // NOTE: 外部/リモートのワールドは DB にコピーしない（＝連合は参照のみ）。
    // 単発で入るなら resolveRef(URL)→instance 作成、永続的に見たいならピアをフォローする。

    /** エディタ用: 下書きがあれば下書き、無ければ本体の定義と、公開状態。 */
    async getEditorDefinition(
        worldId: string,
    ): Promise<{ definition: WorldDefinition; hasDraft: boolean; published: boolean } | undefined> {
        const state = await worldRepository.findState(worldId);
        const editor = state ? editorWorldOf(state) : undefined;
        if (!editor) return undefined;
        // 保存したのは作者が送った生の値なので、既定値を補ってから渡す
        const definition = parseStoredDefinition(editor.definition);
        if (!definition) return undefined;
        const world = await this.getWorld(worldId);
        return {
            definition,
            hasDraft: editor.hasDraft,
            published: isPublishable(world?.identity),
        };
    }

    async deleteWorld(worldId: string): Promise<boolean> {
        const success = await worldRepository.delete(worldId);
        if (success) {
            this._resolvedCache.delete(worldId);
            this.events.broadcast({ type: 'world.changed', worldId });
        }
        return success;
    }

    /** 全件リロード（緊急用・SIGUSR2 などから呼ばれる）。ほかの backend にも読み直させる。 */
    async reloadWorlds(): Promise<void> {
        await this._reloadWorldsHere();
        this.events.broadcast({ type: 'worlds.reload' });
    }

    private async _reloadWorldsHere(): Promise<void> {
        this._resolvedCache.clear();
        await this._scanLocal();
        console.log('✅ ワールド定義を全件再読み込みしました');
    }

    /** 特定ワールドのみリロード（API から呼ばれる）。ほかの backend にも読み直させる。 */
    async reloadWorld(worldId: string): Promise<boolean> {
        const found = await this._reloadWorldHere(worldId);
        if (found) this.events.broadcast({ type: 'world.reload', worldId });
        return found;
    }

    private async _reloadWorldHere(worldId: string): Promise<boolean> {
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
        const claimed = claimedAuthorOf(hosted);
        const policy = repositoryWorldPolicy(claimed, selfDomain(), serveUnsignedRepositoryWorlds());
        if (policy === 'skip') return NOT_FOUND;
        if (policy === 'serve-unsigned') {
            const official = await userRepository.findByHandle(OFFICIAL_HANDLE);
            if (!official) return NOT_FOUND;
            // 署名が付いていれば resolveBundle が確かめる（内容と合わなければ配らない）。無ければ「署名なし」として返る
            return this._verify(id, this.selfWorldUrl(OFFICIAL_HANDLE, id), hosted, official.id);
        }
        if (!claimed) return NOT_FOUND;
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
        const state = located?.record ? await worldRepository.findState(located.record.id) : undefined;
        const served = state ? servedWorldOf(state) : undefined;
        if (!served) return undefined;
        if (kind === 'yaml') return { contentType, body: yaml.stringify(served.definition) };
        const value = kind === 'lock.json' ? served.lock : served.signature;
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

    /** DB のワールド → ResolvedWorld。外部のワールドと同じく {@link resolveBundle} で検証する（同じ規則）。 */
    private async _resolveWorld(state: WorldState): Promise<WorldResolution> {
        const { world: record } = state;
        const served = servedWorldOf(state);
        if (!served) return NOT_FOUND;
        const handle = (await userRepository.findById(record.authorId))?.handle;
        if (!handle) return { ok: false, reason: 'not-found', message: '作者のアカウントが見つかりません' };
        const resolution = await this._verify(
            record.id,
            this.selfWorldUrl(handle, record.worldName),
            { definition: served.definition, lock: served.lock, signature: served.signature },
            record.authorId,
        );
        return resolution.ok && served.versionId ? { ...resolution, versionId: served.versionId } : resolution;
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
                    signatureReason: err.reason,
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
        this._dropResolvedHere();
        this.events.broadcast({ type: 'worlds.resolved-stale' });
    }

    private _dropResolvedHere(): void {
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
