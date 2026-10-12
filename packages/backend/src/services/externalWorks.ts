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
    type ExternalWorkRegistration,
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

/**
 * 登録された mod が、その URL で本人の署名付きのまま配られているかを確かめる。確かめられなければ undefined。
 * 取るのは `<url>/<modId>/v<版>/` の lock.json と lock.sig.json（Host が読み込むのと同じ場所）。
 */
export async function confirmPublishedMod(
    work: { url: string; name: string; version: string },
    deps: {
        account: string;
        crypto: WorldCrypto;
        isAuthorKey: AuthorKeyCheck;
        /** 失敗・非 2xx は undefined。 */
        fetchJson: (url: string) => Promise<unknown>;
    },
): Promise<PublishedMod | undefined> {
    const base = `${work.url}/${encodeURIComponent(work.name)}/v${encodeURIComponent(work.version)}`;
    const [lock, signature] = await Promise.all([
        deps.fetchJson(`${base}/lock.json`).catch(() => undefined),
        deps.fetchJson(`${base}/${MOD_SIGNATURE_FILE}`).catch(() => undefined),
    ]);
    const entry = ModLockEntrySchema.safeParse(lock);
    if (!entry.success || entry.data.id !== work.name || entry.data.version !== work.version) return undefined;
    const verdict = await verifyModSignature(entry.data, signature, deps.crypto, deps.isAuthorKey);
    if (verdict.status !== 'verified' || verdict.author !== deps.account) return undefined;
    return { id: work.name, name: work.name, version: work.version, url: work.url };
}
