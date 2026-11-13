/**
 * mod のサムネイル（一覧に並べる mod の見た目）。その版の lock.json と manifest を取り、
 * manifest は lock の hash で、画像は manifest の assetIntegrity で確かめる。
 * 一覧に出すだけで実行はしないので、作者の署名は確かめない（実行・追加のときに確かめる）。
 */
import { type PackageFetch, packageJson, readPackageManifest } from '@ubichill/loader';
import { type ModLockEntry, ModLockEntrySchema } from '@ubichill/shared';
import { type PreviewImageSource, packagePreviewImage } from './previewImage';

export interface ModThumbnailTarget {
    id: string;
    version: string;
    /** 取得元（無ければ本体の mods） */
    baseUrl?: string;
}

export async function modThumbnailSource(
    target: ModThumbnailTarget,
    options: { fallbackBase: string; fetchBytes: PackageFetch; locked?: ModLockEntry },
): Promise<PreviewImageSource | undefined> {
    const { fetchBytes } = options;
    const base = (target.baseUrl ?? options.fallbackBase).replace(/\/$/, '');
    const sameSource = (options.locked?.baseUrl ?? options.fallbackBase).replace(/\/$/, '') === base;
    const entry =
        options.locked && options.locked.id === target.id && options.locked.version === target.version && sameSource
            ? options.locked
            : ModLockEntrySchema.parse(
                  await packageJson(`${base}/${target.id}/v${target.version}/lock.json`, fetchBytes),
              );
    if (entry.id !== target.id || entry.version !== target.version) return undefined;
    const manifest = await readPackageManifest(entry, base, fetchBytes);
    return packagePreviewImage({ entry, manifest }, manifest.thumbnail, base);
}
