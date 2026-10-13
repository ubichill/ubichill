/**
 * 外部の作品（作者が GitHub Pages などに置いたワールド・mod）の登録と、表示する前の確認（DB・ネットワークは注入）。
 *
 * - 登録: `ubichill publish` が署名した内容と URL を送る。署名の作者がログイン中の本人だと確かめたものだけを登録する。
 *   URL はまだ公開前のことがあるので、登録のときには取りに行かない。
 * - 表示: その URL が本人の署名付きの作品をいま配っているかを確かめ、確かめられたものだけを出す
 *   （登録だけして別の物を置いた URL・取り消した鍵で署名した作品は出さない）。
 */
import {
    type AuthorKeyCheck,
    authorWorldIdOf,
    type ExternalWorkRegistration,
    type ExternalWorkStatus,
    MOD_SIGNATURE_FILE,
    ModLockEntrySchema,
    type PublishedMod,
    verifyModSignature,
    verifyWorldSignature,
    type WorldCrypto,
    worldNameOf,
} from '@ubichill/shared';

export interface VerifiedRegistration {
    kind: 'world' | 'mod';
    url: string;
    name: string;
    version: string | null;
}

export type RegistrationVerdict =
    | { ok: true; work: VerifiedRegistration }
    | { ok: false; status: 400 | 403 | 503; code: string; error: string };

export interface RegistrationDeps {
    /** ログイン中の本人の作者アカウント（`handle@domain`）。 */
    account: string;
    crypto: WorldCrypto;
    isAuthorKey: AuthorKeyCheck;
    parseYaml: (text: string) => unknown;
    /** このサーバーのオリジン。本体に置いたワールドは外部の作品として登録しない（すでに出ている）。 */
    selfOrigin: string;
    /**
     * API トークン（CLI・CI）で送られたときは、そのトークンの公開環境の鍵。署名はこの鍵のものに限る
     * （ワールドの公開と同じ制限。盗まれたトークンで、同じ作者の別の公開環境の署名を登録させない）。
     */
    tokenPublicKey?: string;
}

const rejectedBy = (status: 400 | 403 | 503, code: string, error: string): RegistrationVerdict => ({
    ok: false,
    status,
    code,
    error,
});

const notAuthor = rejectedBy(403, 'not-author', '署名の作者がログイン中のアカウントではありません');

/** 送られた署名を確かめ、本人の作品なら登録する値を返す。 */
export async function verifyRegistration(
    registration: ExternalWorkRegistration,
    deps: RegistrationDeps,
): Promise<RegistrationVerdict> {
    if (URL.parse(registration.url)?.origin === deps.selfOrigin) {
        return rejectedBy(400, 'self-hosted', 'このサーバーに置いた作品は、外部の作品として登録しなくても表示されます');
    }
    const signedKey = (registration.signature as { publicKey?: unknown } | null | undefined)?.publicKey;
    if (deps.tokenPublicKey !== undefined && signedKey !== deps.tokenPublicKey) {
        return rejectedBy(
            403,
            'environment-key-mismatch',
            'API トークンで送る署名は、そのトークンの公開環境の鍵で署名してください',
        );
    }
    if (registration.kind === 'mod') {
        const verdict = await verifyModSignature(
            registration.entry,
            registration.signature,
            deps.crypto,
            deps.isAuthorKey,
        );
        if (verdict.status === 'rejected') {
            return verdict.reason === 'author-pending'
                ? rejectedBy(503, verdict.reason, 'いまは作者を確認できません。時間をおいて試してください')
                : rejectedBy(403, verdict.reason, 'mod の署名を確認できません');
        }
        if (verdict.author !== deps.account) return notAuthor;
        return {
            ok: true,
            work: {
                kind: 'mod',
                url: registration.url,
                name: registration.entry.id,
                version: registration.entry.version,
            },
        };
    }

    const definition = (() => {
        try {
            return deps.parseYaml(registration.yaml);
        } catch {
            return undefined;
        }
    })();
    const name = worldNameOf(definition);
    if (!name) return rejectedBy(400, 'malformed', 'world.yaml を読めません');
    const verdict = await verifyWorldSignature(
        { definition, lock: registration.lock ?? null },
        registration.signature,
        deps.crypto,
        deps.isAuthorKey,
    );
    if (verdict.status !== 'verified') {
        return rejectedBy(
            403,
            verdict.status === 'invalid' ? verdict.reason : 'unsigned',
            'ワールドの署名を確認できません',
        );
    }
    if (verdict.authorPending) {
        return rejectedBy(503, 'author-pending', 'いまは作者を確認できません。時間をおいて試してください');
    }
    if (verdict.author !== deps.account) return notAuthor;
    return { ok: true, work: { kind: 'world', url: registration.url, name, version: null } };
}

/** 取得の結果。`found: false` は「無い」と確定したとき（404 など）。通信の失敗・サーバーの障害は throw。 */
export type FetchedJson = { found: true; value: unknown } | { found: false };

export type ModConfirmation =
    | { status: 'published'; mod: PublishedMod }
    | { status: Exclude<ExternalWorkStatus, 'published'> };

/**
 * 登録された mod が、その URL で本人の署名付きのまま配られているかを確かめる。
 * 取るのは `<url>/<modId>/v<版>/` の lock.json と lock.sig.json（Host が読み込むのと同じ場所）。
 */
export async function confirmPublishedMod(
    work: { url: string; name: string; version: string },
    deps: {
        account: string;
        crypto: WorldCrypto;
        isAuthorKey: AuthorKeyCheck;
        fetchJson: (url: string) => Promise<FetchedJson>;
    },
): Promise<ModConfirmation> {
    const base = `${work.url}/${encodeURIComponent(work.name)}/v${encodeURIComponent(work.version)}`;
    const fetched = await Promise.all([
        deps.fetchJson(`${base}/lock.json`),
        deps.fetchJson(`${base}/${MOD_SIGNATURE_FILE}`),
    ]).catch(() => undefined);
    if (!fetched) return { status: 'unreachable' };
    const [lock, signature] = fetched;
    if (!lock.found || !signature.found) return { status: 'not-found' };
    const entry = ModLockEntrySchema.safeParse(lock.value);
    if (!entry.success || entry.data.id !== work.name || entry.data.version !== work.version)
        return { status: 'invalid' };
    const verdict = await verifyModSignature(entry.data, signature.value, deps.crypto, deps.isAuthorKey);
    if (verdict.status === 'rejected' && verdict.reason === 'author-pending') return { status: 'unreachable' };
    if (verdict.status !== 'verified' || verdict.author !== deps.account) return { status: 'invalid' };
    return { status: 'published', mod: { id: work.name, name: work.name, version: work.version, url: work.url } };
}

/**
 * 外部のワールドを解決した結果から、登録した作品が本人の署名付きで配られているかを決める（純粋）。
 * 作品の ID（`acct:作者/名前`）まで照合するので、同じ URL で名前を変えて公開し直したとき、以前の名前の登録は出ない。
 */
export function worldConfirmation<
    W extends { identity?: { status: string; worldId?: string; author?: string; authorPending?: true } },
>(
    resolution: { ok: true; world: W } | { ok: false; reason: 'not-found' | 'integrity' },
    expected: { account: string; name: string },
): { status: 'published'; world: W } | { status: Exclude<ExternalWorkStatus, 'published'> } {
    if (!resolution.ok) return { status: resolution.reason === 'integrity' ? 'invalid' : 'not-found' };
    const identity = resolution.world.identity;
    if (identity?.status === 'verified' && identity.authorPending) return { status: 'unreachable' };
    const published =
        identity?.status === 'verified' &&
        identity.author === expected.account &&
        identity.worldId === authorWorldIdOf(expected.account, expected.name);
    return published ? { status: 'published', world: resolution.world } : { status: 'invalid' };
}
