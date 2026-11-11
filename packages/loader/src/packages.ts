/** 作者のホームは取得先の案内だけ。配布物の検証は CLI とブラウザで同じ処理を使う。 */
import {
    createAuthorKeyDirectory,
    formatAuthorAccount,
    MOD_CATALOG_REL,
    MOD_SIGNATURE_FILE,
    type ModLockEntry,
    ModLockEntrySchema,
    ModVersionedManifestSchema,
    type PackageDescriptor,
    PackageDescriptorSchema,
    type PackageRef,
    PublicPackageUrlSchema,
    parseAuthorAccount,
    type StoredAuthorBinding,
    validatePackagePrefabs,
    verifyModSignature,
} from '@ubichill/shared';
import { sriOf } from './integrity.ts';
import { webWorldCrypto } from './worldCrypto.ts';

export type PackageFetch = (url: string) => Promise<Uint8Array>;
/** 上限はメモリへ読み込む前に適用。リダイレクトでも https と認証情報なしを守る。 */
export async function fetchPackageBytes(url: string, maxBytes = 1024 * 1024): Promise<Uint8Array> {
    if (!PublicPackageUrlSchema.safeParse(url).success) throw new Error('公開 package は https の URL が必要です');
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.body) throw new Error(`取得できません: ${url} (${response.status})`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > maxBytes) throw new Error(`配布物は ${maxBytes} bytes までです`);
            chunks.push(value);
        }
    } finally {
        await reader.cancel();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}
export const packageJson = async (url: string, fetchBytes: PackageFetch = fetchPackageBytes): Promise<unknown> =>
    JSON.parse(new TextDecoder().decode(await fetchBytes(url)));

/** 永続キャッシュは作らない。1 回の解決内の有効な鍵一覧だけを共有する。 */
export function packageSignatureVerifier(fetchBytes: PackageFetch = fetchPackageBytes) {
    const bindings = new Map<string, StoredAuthorBinding>();
    const directory = createAuthorKeyDirectory({
        bindings: {
            find: async (a) => bindings.get(a),
            save: async (a, p) => {
                bindings.set(a, { ...p, fetchedAt: new Date() });
            },
        },
        confirmedContents: { record: async () => {}, has: async () => false },
        fetchJson: (url) => packageJson(url, fetchBytes).catch(() => undefined),
        allowHttp: false,
    });
    return (entry: ModLockEntry, signature: unknown) =>
        verifyModSignature(entry, signature, webWorldCrypto, directory.isAuthorKey);
}

export async function readPackageManifest(
    entry: ModLockEntry,
    fallbackBase: string,
    fetchBytes: PackageFetch = fetchPackageBytes,
) {
    const base = `${entry.baseUrl ?? fallbackBase}/${entry.id}/v${entry.version}`;
    const bytes = await fetchBytes(`${base}/manifest.json`);
    if (
        (await sriOf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)) !==
        entry.manifestIntegrity
    )
        throw new Error('manifest の内容が固定した版と一致しません');
    const manifest = ModVersionedManifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (manifest.id !== entry.id || manifest.version !== entry.version)
        throw new Error('別の package の manifest です');
    validatePackagePrefabs(entry.id, manifest.prefabs ?? {}, manifest.components);
    return manifest;
}

export async function resolvePackage(
    ref: PackageRef,
    options: { fetchBytes?: PackageFetch; verify?: ReturnType<typeof packageSignatureVerifier> } = {},
) {
    const fetchBytes = options.fetchBytes ?? fetchPackageBytes;
    const account = parseAuthorAccount(ref.author);
    if (!account) throw new Error('作者アカウントを読めません');
    const origin = `https://${account.domain}`;
    const finger = (await packageJson(
        `${origin}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${formatAuthorAccount(account)}`)}`,
        fetchBytes,
    )) as { subject?: unknown; links?: Array<{ rel?: string; href?: string }> };
    if (finger.subject !== `acct:${ref.author}` || !Array.isArray(finger.links))
        throw new Error('作者の WebFinger が一致しません');
    const href = finger.links.find((l) => l?.rel === MOD_CATALOG_REL)?.href;
    if (typeof href !== 'string') throw new Error('作者のサーバーが mod の取得先を案内していません');
    const catalog = new URL(href, origin);
    if (catalog.origin !== origin || catalog.username || catalog.password || catalog.search || catalog.hash)
        throw new Error('mod カタログは作者と同じサーバーが必要です');
    const descriptor = PackageDescriptorSchema.parse(
        await packageJson(`${catalog.href.replace(/\/$/, '')}/${ref.id}`, fetchBytes),
    );
    if (descriptor.author !== ref.author || descriptor.id !== ref.id)
        throw new Error('カタログの作者・package が一致しません');
    return loadPackageRelease({ ...descriptor, version: ref.version ?? descriptor.version }, options);
}

export async function loadPackageRelease(
    descriptor: PackageDescriptor,
    options: { fetchBytes?: PackageFetch; verify?: ReturnType<typeof packageSignatureVerifier> } = {},
) {
    const fetchBytes = options.fetchBytes ?? fetchPackageBytes;
    descriptor = PackageDescriptorSchema.parse(descriptor);
    const ref = { author: descriptor.author, id: descriptor.id };
    const version = descriptor.version;
    const baseUrl = PublicPackageUrlSchema.parse(descriptor.baseUrl).replace(/\/$/, '');
    const base = `${baseUrl}/${ref.id}/v${version}`;
    const entry = ModLockEntrySchema.parse(await packageJson(`${base}/lock.json`, fetchBytes));
    if (entry.id !== ref.id || entry.version !== version) throw new Error('配布物の ID・版が一致しません');
    const locked = { ...entry, baseUrl, author: ref.author };
    const signature = await packageJson(`${base}/${MOD_SIGNATURE_FILE}`, fetchBytes);
    const verdict = await (options.verify ?? packageSignatureVerifier(fetchBytes))(locked, signature);
    if (verdict.status !== 'verified' || verdict.author !== ref.author)
        throw new Error('指定した作者の署名を確認できません');
    const manifest = await readPackageManifest(locked, baseUrl, fetchBytes);
    return { entry: locked, manifest, signature, descriptor: { ...descriptor, version } };
}
