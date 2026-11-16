import { MOD_CDN_URL } from '@/lib/mods/modCdn';
import type { EditorPackage } from '@/lib/mods/packages';
import { packagePreviewImage } from '@/lib/mods/previewImage';
import { css } from '@/styled-system/css';
import { PreviewImage } from './PreviewImage';

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

export function PackageSummary({ pkg }: { pkg: EditorPackage }) {
    const capabilities = [...new Set(Object.values(pkg.entry.components).flatMap((c) => c.capabilities))];
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2', overflowWrap: 'anywhere' })}>
            <div className={css({ display: 'flex', alignItems: 'center', gap: '12px' })}>
                <span
                    className={css({
                        width: '64px',
                        height: '64px',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        borderRadius: '8px',
                        bg: 'surface',
                    })}
                >
                    <PreviewImage
                        source={packagePreviewImage(pkg, pkg.manifest.thumbnail, MOD_CDN_URL)}
                        alt=""
                        fallback={null}
                    />
                </span>
                <div>
                    <strong>
                        {pkg.manifest.name ?? pkg.entry.id} — {pkg.entry.version}
                    </strong>
                    <p>作者: @{pkg.entry.author}</p>
                </div>
            </div>
            {pkg.manifest.description && (
                <p className={css({ whiteSpace: 'pre-line', lineHeight: '1.7' })}>{pkg.manifest.description}</p>
            )}
            <p>
                Component {Object.keys(pkg.manifest.components).length} 個・プレハブ{' '}
                {Object.keys(pkg.manifest.prefabs ?? {}).length} 個
            </p>
            <p>使用する権限: {capabilities.join('、') || 'なし'}</p>
            <p>追加後、アセットからComponentやプレハブを配置できます。実行時の権限は利用者ごとに確認します。</p>
        </div>
    );
}
