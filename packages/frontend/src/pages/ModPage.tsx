import { loadPackageRelease } from '@ubichill/loader';
import { PackageDescriptorSchema } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PackageSummary, packageButton } from '@/components/mods/PackagePicker';
import { API_BASE } from '@/lib/api';
import { HOST_MOD_SOURCE } from '@/lib/mods/modCdn';
import type { EditorPackage } from '@/lib/mods/packages';
import { css } from '@/styled-system/css';
import { browserSignatureVerifier } from '@/world/modSignature';

export function ModPage() {
    const { at = '', name = '', version } = useParams();
    const [pkg, setPackage] = useState<EditorPackage | null>(null);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const [worlds, setWorlds] = useState<Array<{ id: string; displayName: string }>>([]);
    const [target, setTarget] = useState('new');
    const navigate = useNavigate();
    useEffect(() => {
        let cancelled = false;
        setPackage(null);
        setError('');
        void (async () => {
            if (!at.startsWith('@')) throw new Error('作者のURLが不正です');
            const response = await fetch(
                `${API_BASE}/api/v1/authors/${encodeURIComponent(at.slice(1))}/mods/${encodeURIComponent(name)}`,
            );
            if (!response.ok) throw new Error('公開されているmodが見つかりません');
            const descriptor = PackageDescriptorSchema.parse(await response.json());
            const resolved = await loadPackageRelease(
                { ...descriptor, ...(version ? { version } : {}) },
                { verify: browserSignatureVerifier(HOST_MOD_SOURCE.devHost) },
            );
            if (!cancelled) setPackage(resolved);
        })().catch((e: unknown) => {
            if (!cancelled) setError(e instanceof Error ? e.message : '取得できません');
        });
        return () => {
            cancelled = true;
        };
    }, [at, name, version]);
    useEffect(() => {
        const abort = new AbortController();
        void fetch(`${API_BASE}/api/v1/users/me/worlds`, { credentials: 'include', signal: abort.signal })
            .then(async (r) => {
                if (!r.ok) return;
                const data = (await r.json()) as {
                    worlds: Array<{ id: string; displayName: string; managedBy?: string }>;
                };
                if (!abort.signal.aborted) setWorlds(data.worlds.filter((w) => !w.managedBy));
            })
            .catch(() => {});
        return () => abort.abort();
    }, []);
    const ref = pkg ? `@${pkg.entry.author}/${pkg.entry.id}@${pkg.entry.version}` : '';
    return (
        <main
            className={css({
                maxW: '800px',
                mx: 'auto',
                p: { base: '4', md: '8' },
                display: 'flex',
                flexDirection: 'column',
                gap: '4',
            })}
        >
            <Link to={`/${at}`}>作者のプロフィール</Link>
            <h1 className={css({ fontSize: '2xl', fontWeight: 'bold', overflowWrap: 'anywhere' })}>{name}</h1>
            {error ? (
                <p role="alert">{error}</p>
            ) : !pkg ? (
                <p role="status">作者と内容を確認中…</p>
            ) : (
                <>
                    <PackageSummary pkg={pkg} />
                    <code className={css({ overflowWrap: 'anywhere' })}>ubichill install {ref}</code>
                    <button
                        type="button"
                        className={packageButton}
                        onClick={() =>
                            void navigator.clipboard
                                .writeText(`ubichill install ${ref}`)
                                .then(() => setCopied(true))
                                .catch(() => setError('コピーできませんでした'))
                        }
                    >
                        {copied ? 'コピーしました' : 'インストールコマンドをコピー'}
                    </button>
                    <label htmlFor="package-world">追加先のワールド</label>
                    <select
                        id="package-world"
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                        className={packageButton}
                    >
                        <option value="new">新しいワールド</option>
                        {worlds.map((w) => (
                            <option key={w.id} value={w.id}>
                                {w.displayName}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className={packageButton}
                        onClick={() =>
                            navigate(
                                `${target === 'new' ? '/worlds/new' : `/world/${target}/edit`}?addMod=${encodeURIComponent(ref)}`,
                            )
                        }
                    >
                        編集画面で追加する
                    </button>
                </>
            )}
        </main>
    );
}
