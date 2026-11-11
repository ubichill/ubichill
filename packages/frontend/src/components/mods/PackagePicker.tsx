import { loadPackageRelease, resolvePackage } from '@ubichill/loader';
import { formatPackageRef, type PackageDescriptor, PackageDescriptorSchema, parsePackageRef } from '@ubichill/shared';
import { useState } from 'react';
import { API_BASE } from '@/lib/api';
import { HOST_MOD_SOURCE } from '@/lib/mods/modCdn';
import type { EditorPackage } from '@/lib/mods/packages';
import { css } from '@/styled-system/css';
import { browserSignatureVerifier } from '@/world/modSignature';

export const packageButton = css({
    px: '3',
    py: '2',
    minH: '44px',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    bg: 'surface',
    color: 'text',
    cursor: 'pointer',
    _disabled: { opacity: 0.5, cursor: 'default' },
    _focusVisible: { outline: '2px solid', outlineColor: 'primary' },
});
const inputStyle = css({
    minH: '44px',
    p: '2',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    bg: 'background',
    color: 'text',
    width: 'full',
});

/** 名前の検索は自サーバーだけ。完全な作者参照は作者のホームへ直接解決する。 */
export function PackagePicker({
    onInstall,
    initialRef = '',
}: {
    onInstall: (pkg: EditorPackage) => boolean | Promise<boolean>;
    initialRef?: string;
}) {
    const [query, setQuery] = useState(initialRef);
    const [results, setResults] = useState<PackageDescriptor[] | null>(null);
    const [selected, setSelected] = useState<EditorPackage | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const verify = browserSignatureVerifier(HOST_MOD_SOURCE.devHost);
    const run = async (task: () => Promise<void>) => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            await task();
        } catch (e) {
            setError(e instanceof Error ? e.message : '取得できません');
        } finally {
            setBusy(false);
        }
    };
    const search = () =>
        run(async () => {
            setSelected(null);
            const ref = parsePackageRef(query);
            if (ref) {
                setSelected(await resolvePackage(ref, { verify }));
                return;
            }
            const response = await fetch(`${API_BASE}/api/v1/mods?q=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('検索できませんでした');
            const data = (await response.json()) as { items: unknown[] };
            setResults(data.items.map((item) => PackageDescriptorSchema.parse(item)));
        });
    return (
        <section className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    void search();
                }}
                className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}
            >
                <label htmlFor="package-query">modを探す</label>
                <input
                    id="package-query"
                    className={inputStyle}
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setSelected(null);
                        setResults(null);
                    }}
                    disabled={busy}
                    placeholder="名前、@作者@サーバー/mod、または作品URL"
                    maxLength={2048}
                />
                <button type="submit" className={packageButton} disabled={busy}>
                    {busy ? '作者と内容を確認中…' : '検索・確認'}
                </button>
            </form>
            {error && <p role="alert">{error}</p>}
            {!selected &&
                results?.map((p) => (
                    <button
                        key={`${p.author}/${p.id}`}
                        type="button"
                        disabled={busy}
                        className={packageButton}
                        onClick={() =>
                            void run(async () => {
                                setSelected(await loadPackageRelease(p, { verify }));
                            })
                        }
                    >
                        {formatPackageRef(p)}
                    </button>
                ))}
            {!selected && results?.length === 0 && !busy && (
                <p role="status">見つかりませんでした。完全な作者参照や作品URLでも追加できます。</p>
            )}
            {selected && (
                <>
                    <PackageSummary pkg={selected} />
                    <button
                        type="button"
                        className={packageButton}
                        disabled={busy}
                        onClick={() =>
                            void run(async () => {
                                if ((await onInstall(selected)) === false) return;
                                setSelected(null);
                            })
                        }
                    >
                        この版をワールドに追加
                    </button>
                </>
            )}
        </section>
    );
}

export function PackageSummary({ pkg }: { pkg: EditorPackage }) {
    const capabilities = [...new Set(Object.values(pkg.entry.components).flatMap((c) => c.capabilities))];
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2', overflowWrap: 'anywhere' })}>
            <strong>
                {pkg.manifest.name ?? pkg.entry.id} — {pkg.entry.version}
            </strong>
            <p>作者: @{pkg.entry.author}</p>
            <p>
                Component {Object.keys(pkg.manifest.components).length} 個・プレハブ{' '}
                {Object.keys(pkg.manifest.prefabs ?? {}).length} 個
            </p>
            <p>使用する権限: {capabilities.join('、') || 'なし'}</p>
            <p>追加後、アセットからComponentやプレハブを配置できます。実行時の権限は利用者ごとに確認します。</p>
        </div>
    );
}
