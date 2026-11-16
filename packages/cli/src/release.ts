import {
    fetchPackageBytes,
    type PackageFetch,
    packageJson,
    readPackageManifest,
    sriOf,
    webWorldCrypto,
} from '@ubichill/loader';
import { type ModLockEntry, ModLockEntrySchema, modContentHash } from '@ubichill/shared';

/**
 * 一時的なサーバーエラー（5xx・通信の失敗）だけをやり直す。GitHub Pages は反映中に 503 を返すことがあり、
 * 1 回で諦めると公開が止まる。404 などはそのまま返す（「まだ公開していない」も答えのうち）。
 */
export async function fetchRetryingServerErrors(
    request: () => Promise<Response>,
    options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Response> {
    const { attempts = 4, delayMs = 3000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = options;
    const response = await request().catch((error: unknown) => {
        if (attempts <= 1) throw error;
        return undefined;
    });
    if (response && (response.status < 500 || attempts <= 1)) return response;
    await sleep(delayMs);
    return fetchRetryingServerErrors(request, { attempts: attempts - 1, delayMs: delayMs * 2, sleep });
}

/** 配置前の検査。同じ版を異なる内容で上書きして既存ワールドを壊さない。 */
export async function assertReleaseUnchanged(
    entry: ModLockEntry,
    baseUrl: string,
    read: (url: string) => Promise<unknown | undefined>,
) {
    const previous = await read(`${baseUrl}/${entry.id}/v${entry.version}/lock.json`);
    if (previous === undefined) return;
    const old = ModLockEntrySchema.parse(previous);
    if ((await modContentHash(old, webWorldCrypto)) !== (await modContentHash(entry, webWorldCrypto)))
        throw new Error(`${entry.id}@${entry.version} は既に別の内容で公開されています。版を上げてください`);
}

/** 配置後の検査。カタログ登録の前に、実際の配布先から同じバイト列を取得できるかを確認する。 */
export async function checkPublicRelease(
    entry: ModLockEntry,
    baseUrl: string,
    fetchBytes: PackageFetch = fetchPackageBytes,
) {
    const manifest = await readPackageManifest({ ...entry, baseUrl }, baseUrl, fetchBytes);
    const root = `${baseUrl}/${entry.id}/v${entry.version}/`;
    const files = [
        ...Object.values(entry.components).map((c) => [c.workerUrl, c.integrity] as const),
        ...Object.entries(manifest.assetIntegrity ?? {}),
    ];
    let total = 0;
    for (const [path, expected] of files) {
        const url = new URL(path, root);
        if (!url.href.startsWith(root) || path.startsWith('/') || path.includes('\\'))
            throw new Error('配布物のパスが package の外を指しています');
        const bytes = await (fetchBytes === fetchPackageBytes
            ? fetchPackageBytes(url.href, 32 * 1024 * 1024)
            : fetchBytes(url.href));
        total += bytes.byteLength;
        if (total > 32 * 1024 * 1024) throw new Error('公開先の検査は合計32 MiBまでです');
        if (
            (await sriOf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)) !==
            expected
        )
            throw new Error(`配布先の内容が一致しません: ${path}`);
    }
    const served = ModLockEntrySchema.parse(await packageJson(`${root}lock.json`, fetchBytes));
    if ((await modContentHash(served, webWorldCrypto)) !== (await modContentHash(entry, webWorldCrypto)))
        throw new Error('配布先の lock が一致しません');
}
