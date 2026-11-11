import { type PackageFetch, readPackageManifest } from '@ubichill/loader';
import { MOD_SIGNATURE_FILE, type ModLockEntry } from '@ubichill/shared';
import { browserSignatureVerifier, isUnsignedModAllowed } from '@/world/modSignature';
import { HOST_MOD_SOURCE, MOD_CDN_URL } from './modCdn';

export const editorPackageBytes: PackageFetch = async (url) => {
    const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`取得できません (${res.status})`);
    if (Number(res.headers.get('content-length')) > 1024 * 1024) throw new Error('manifest が大きすぎます');
    if (!res.body) throw new Error('manifest を取得できません');
    const reader = res.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 1024 * 1024) throw new Error('manifest が大きすぎます');
            chunks.push(value);
        }
    } finally {
        await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
    }
    return bytes;
};
export async function editorPackage(entry: ModLockEntry) {
    const base = entry.baseUrl ?? MOD_CDN_URL;
    const manifest = await readPackageManifest(entry, base, editorPackageBytes);
    const res = await fetch(`${base}/${entry.id}/v${entry.version}/${MOD_SIGNATURE_FILE}`, {
        credentials: 'omit',
        signal: AbortSignal.timeout(8000),
    });
    if (
        !(res.status === 404 || res.status === 204) ||
        entry.author ||
        !isUnsignedModAllowed({ devHost: HOST_MOD_SOURCE.devHost, baseUrl: base, origin: window.location.origin })
    ) {
        const result = await browserSignatureVerifier(HOST_MOD_SOURCE.devHost)(
            entry,
            res.ok ? await res.json() : undefined,
        );
        if (result.status !== 'verified') throw new Error('package の作者を確認できません');
    }
    return { entry, manifest };
}
export type EditorPackage = Awaited<ReturnType<typeof editorPackage>>;
