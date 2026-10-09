/**
 * mod の作者署名の確認（frontend アダプタ）。
 *
 * 署名の照合と作者の確認はサーバー（`POST /api/v1/mods/signature/verify`）が行う。他サーバーの作者の鍵一覧の取得・保存・
 * 取り消しの反映はワールドの署名と同じ仕組みを使うため。ここは依頼の組み立てと、開発用の例外の判定だけを持つ。
 */
import {
    MOD_SIGNATURE_FILE,
    type ModLockEntry,
    ModLockEntrySchema,
    type ModSignatureRejectReason,
    type ModSignatureVerdict,
} from '@ubichill/shared';
import { API_BASE } from '@/lib/api';

export type VerifyModSignature = (entry: ModLockEntry, signature: unknown) => Promise<ModSignatureVerdict>;

/**
 * 署名ファイルの無い mod を「署名なし（開発）」として動かしてよいか。
 * 開発用の Host（`pnpm dev`・プレビュー）が、自分のオリジンから配る mod にだけ許す。本番の Host は例外なし。
 */
export function isUnsignedModAllowed(args: { devHost: boolean; baseUrl: string; origin: string }): boolean {
    if (!args.devHost) return false;
    const url = URL.parse(args.baseUrl, args.origin);
    return url !== null && url.origin === args.origin;
}

const isVerdict = (value: unknown): value is ModSignatureVerdict =>
    typeof value === 'object' &&
    value !== null &&
    ((value as { status?: unknown }).status === 'verified' || (value as { status?: unknown }).status === 'rejected');

export interface SignatureVerifierDeps {
    /** サーバーへ確認を依頼する。応答を確認結果として読めなければ throw。 */
    request: VerifyModSignature;
    sleep: (ms: number) => Promise<void>;
    /** 「いまは確認できない」ときに確認し直す間隔（ミリ秒）。この回数だけ待って確認し直す。 */
    retryDelays?: readonly number[];
}

/**
 * 「いまは確認できない」（サーバーが作者のサーバーへの問い合わせを見送った・サーバーに届かない）ときだけ、間をあけて確認し直す。
 * それ以外の拒否は確定なので繰り返さない。
 */
export function createSignatureVerifier(deps: SignatureVerifierDeps): VerifyModSignature {
    const delays = deps.retryDelays ?? [1000, 3000];
    const attempt = async (entry: ModLockEntry, signature: unknown, remaining: readonly number[]) => {
        const verdict = await deps
            .request(entry, signature)
            .catch((): ModSignatureVerdict => ({ status: 'rejected', reason: 'author-pending' }));
        const [delay, ...rest] = remaining;
        if (verdict.status !== 'rejected' || verdict.reason !== 'author-pending' || delay === undefined) {
            return verdict;
        }
        await deps.sleep(delay);
        return attempt(entry, signature, rest);
    };
    return (entry, signature) => attempt(entry, signature, delays);
}

const requestVerdict: VerifyModSignature = async (entry, signature) => {
    const res = await fetch(`${API_BASE}/api/v1/mods/signature/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entry, signature }),
    });
    const body: unknown = res.ok ? await res.json() : undefined;
    if (!isVerdict(body)) throw new Error(`mod の署名を確認できませんでした (${res.status})`);
    return body;
};

export const verifyModSignatureViaApi: VerifyModSignature = createSignatureVerifier({
    request: requestVerdict,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

/**
 * 配布されている版の作者の確認結果（World Editor の一覧用）。
 * - verified: 署名で作者を確認できた
 * - unsigned: 署名ファイルが無い
 * - rejected: 署名はあるが通らない（改ざん・取り消された鍵など。確定）
 * - data-only: 実行するコードが無い（署名の対象が無い）
 * - unavailable: 通信の失敗などで、いまは確認できない（確認し直せば変わり得る）
 */
export type ModAuthorCheck =
    | { status: 'verified'; author: string }
    | { status: 'unsigned' }
    | { status: 'rejected'; reason: ModSignatureRejectReason }
    | { status: 'data-only' }
    | { status: 'unavailable' };

/** 取得結果。`missing` は「そのファイルは無い」と確定したとき。通信の失敗・サーバーエラーは throw する。 */
export type FetchedJson = { found: true; value: unknown } | { found: false };

export interface ModAuthorCheckDeps {
    fetchJson: (url: string) => Promise<FetchedJson>;
    verify: VerifyModSignature;
}

/** 「無い」と「取得できない」を分けて確認する（通信の失敗を「署名なし」と表示しない）。 */
export async function checkModAuthor(
    deps: ModAuthorCheckDeps,
    baseUrl: string,
    modId: string,
    version: string,
): Promise<ModAuthorCheck> {
    const versionedBase = `${baseUrl}/${modId}/v${version}`;
    try {
        const [lock, signature] = await Promise.all([
            deps.fetchJson(`${versionedBase}/lock.json`),
            deps.fetchJson(`${versionedBase}/${MOD_SIGNATURE_FILE}`),
        ]);
        if (!lock.found) {
            const manifest = await deps.fetchJson(`${versionedBase}/manifest.json`);
            if (!manifest.found || typeof manifest.value !== 'object' || manifest.value === null)
                return { status: 'unavailable' };
            const value = manifest.value as {
                id?: unknown;
                version?: unknown;
                components?: Record<string, { workerUrl?: unknown }>;
            };
            if (
                value.id !== modId ||
                value.version !== version ||
                !value.components ||
                Object.values(value.components).some((component) => component?.workerUrl)
            )
                return { status: 'unavailable' };
            return { status: 'data-only' };
        }
        const entry = ModLockEntrySchema.safeParse(lock.value);
        if (!entry.success) return { status: 'unavailable' };
        if (entry.data.id !== modId || entry.data.version !== version)
            return { status: 'rejected', reason: 'signature-mod-mismatch' };
        if (!signature.found) return { status: 'unsigned' };
        const verdict = await deps.verify(entry.data, signature.value);
        if (verdict.status === 'verified') return { status: 'verified', author: verdict.author };
        return verdict.reason === 'author-pending'
            ? { status: 'unavailable' }
            : { status: 'rejected', reason: verdict.reason };
    } catch {
        return { status: 'unavailable' };
    }
}

/** 404・SPA の HTML fallback は「無い」。通信エラー・壊れた JSON は確認失敗。 */
const fetchJson = async (url: string): Promise<FetchedJson> => {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return { found: false };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.headers.get('content-type')?.includes('text/html')) return { found: false };
    return { found: true, value: JSON.parse(await res.text()) as unknown };
};

export const fetchModAuthor = (baseUrl: string, modId: string, version: string): Promise<ModAuthorCheck> =>
    checkModAuthor({ fetchJson, verify: verifyModSignatureViaApi }, baseUrl, modId, version);
