import { readPackageManifest } from '@ubichill/loader';
import { type InitialEntity, unpackPrefab, updatePrefabInstance } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { packageButton } from '@/components/mods/PackagePicker';
import { MOD_CDN_URL } from '@/lib/mods/modCdn';
import { type EditorPackage, editorPackageBytes } from '@/lib/mods/packages';
import { css } from '@/styled-system/css';

export function PrefabControls({
    entity,
    packages,
    entities,
    onChange,
}: {
    entity: InitialEntity;
    packages: EditorPackage[];
    entities: InitialEntity[];
    onChange: (next: InitialEntity) => void;
}) {
    const [pendingResult, setPending] = useState<
        (ReturnType<typeof updatePrefabInstance> & { source: InitialEntity }) | null
    >(null);
    const pending = pendingResult?.source === entity ? pendingResult : null;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // biome-ignore lint/correctness/useExhaustiveDependencies: 編集や版の変更後に古い差分を適用させない
    useEffect(() => setPending(null), [entity, packages]);
    const link = entity.prefab;
    if (!link) return null;
    const next = packages.find((p) => p.entry.id === link.modId);
    const changed = next && next.entry.manifestIntegrity !== link.manifestIntegrity;
    const preview = async () => {
        if (!next || busy) return;
        setBusy(true);
        setError('');
        try {
            // 古い版は配置の比較用。lock の hash で照合し、コードは実行しない。
            const oldManifest = await readPackageManifest(
                {
                    id: link.modId,
                    version: link.version,
                    manifestIntegrity: link.manifestIntegrity,
                    baseUrl: link.baseUrl,
                    author: link.author,
                    components: {},
                },
                MOD_CDN_URL,
                editorPackageBytes,
            );
            const before = oldManifest.prefabs?.[link.name];
            const after = next.manifest.prefabs?.[link.name];
            if (!before || !after)
                throw new Error('更新前または更新先にこのプレハブがありません。Unpackして編集を続けられます');
            const result = updatePrefabInstance(
                entity,
                { prefab: before, fields: oldManifest.components },
                { prefab: after, fields: next.manifest.components, entry: next.entry },
                entities,
            );
            setPending({ ...result, source: entity });
        } catch (e) {
            setError(e instanceof Error ? e.message : '差分を取得できません');
        } finally {
            setBusy(false);
        }
    };
    const changes = pending ? prefabChanges(entity.children, pending.entity.children) : [];
    return (
        <section
            className={css({
                p: '3',
                borderBottom: '1px solid',
                borderColor: 'border',
                display: 'flex',
                flexDirection: 'column',
                gap: '2',
                overflowWrap: 'anywhere',
            })}
        >
            <strong>
                プレハブ: {link.modId}/{link.name}
            </strong>
            <span>配置元 {link.version}</span>
            <button type="button" className={packageButton} disabled={!changed || busy} onClick={() => void preview()}>
                {busy ? '差分を確認中…' : 'インストール済みの版との差分を確認'}
            </button>
            {error && <p role="alert">{error}</p>}
            {pending && (
                <>
                    <p>
                        配置側の変更を残して {next?.entry.version} に更新します。競合 {pending.conflicts.length} 件。
                    </p>
                    <ul>
                        {changes.slice(0, 50).map((change) => (
                            <li key={change}>{change}</li>
                        ))}
                    </ul>
                    {pending.conflicts.length > 0 && (
                        <p>次の項目は配置側の値を残します: {pending.conflicts.join('、')}</p>
                    )}
                    <button
                        type="button"
                        className={packageButton}
                        onClick={() => {
                            onChange(pending.entity);
                            setPending(null);
                        }}
                    >
                        この差分を適用
                    </button>
                </>
            )}
            <button type="button" className={packageButton} onClick={() => onChange(unpackPrefab(entity))}>
                Unpack（関連を外す）
            </button>
        </section>
    );
}

function prefabChanges(before: unknown, after: unknown, path = ''): string[] {
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    if (before && after && typeof before === 'object' && typeof after === 'object') {
        const b = before as Record<string, unknown>;
        const a = after as Record<string, unknown>;
        return [...new Set([...Object.keys(b), ...Object.keys(a)])].flatMap((key) =>
            prefabChanges(b[key], a[key], `${path}/${key}`),
        );
    }
    return [
        `${path}: ${JSON.stringify(before)?.slice(0, 80) ?? 'なし'} → ${JSON.stringify(after)?.slice(0, 80) ?? 'なし'}`,
    ];
}
