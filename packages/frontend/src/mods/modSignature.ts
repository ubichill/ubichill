/**
 * mod の作者署名の確認（frontend アダプタ）。
 *
 * 署名の照合と作者の確認はサーバー（`POST /api/v1/mods/signature/verify`）が行う。他サーバーの作者の鍵一覧の取得・保存・
 * 取り消しの反映はワールドの署名と同じ仕組みを使うため。ここは依頼の組み立てと、開発用の例外の判定だけを持つ。
 */
import { MOD_SIGNATURE_FILE, type ModLockEntry, ModLockEntrySchema, type ModSignatureVerdict } from '@ubichill/shared';
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

const fetchJson = async (url: string): Promise<unknown> => {
    try {
        const res = await fetch(url, { cache: 'no-store' });
        return res.ok ? (JSON.parse(await res.text()) as unknown) : undefined;
    } catch {
        return undefined;
    }
};

/** 配布されている版の作者を確認する（World Editor の一覧用）。確認できなければ undefined。 */
export async function fetchModAuthor(baseUrl: string, modId: string, version: string): Promise<string | undefined> {
    const versionedBase = `${baseUrl}/${modId}/v${version}`;
    const [lock, signature] = await Promise.all([
        fetchJson(`${versionedBase}/lock.json`),
        fetchJson(`${versionedBase}/${MOD_SIGNATURE_FILE}`),
    ]);
    const entry = ModLockEntrySchema.safeParse(lock);
    if (!entry.success || signature === undefined) return undefined;
    const verdict = await verifyModSignatureViaApi(entry.data, signature);
    return verdict.status === 'verified' ? verdict.author : undefined;
}
