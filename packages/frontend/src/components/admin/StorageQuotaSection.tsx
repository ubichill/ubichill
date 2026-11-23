import { formatBytes, type StorageQuotaSettings } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { fetchStorageQuota, updateStorageQuota } from '@/lib/admin/storageApi';
import { quotaChoices } from '@/lib/admin/storageQuota';
import { css } from '@/styled-system/css';
import { adminError } from './adminStyles';

/** 1 人あたりの容量（管理者）。選んだらすぐ保存する。 */
export function StorageQuotaSection() {
    const [settings, setSettings] = useState<StorageQuotaSettings | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchStorageQuota()
            .then(setSettings)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : '読み込めませんでした'));
    }, []);

    const change = async (value: string) => {
        setBusy(true);
        setError(null);
        try {
            setSettings(await updateStorageQuota({ worldAssetQuotaBytes: Number(value) }));
        } catch (e) {
            setError(e instanceof Error ? e.message : '保存できませんでした');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className={section}>
            <h2 className={heading}>1 人あたりの容量</h2>
            {settings && (
                <>
                    <p className={lead}>
                        ワールドの画像を置ける合計です。サーバー全体で {formatBytes(settings.totalBytes)} 使っています。
                    </p>
                    <ChoiceGroup
                        label="1 人あたりの容量"
                        choices={quotaChoices(settings.worldAssetQuotaBytes)}
                        value={String(settings.worldAssetQuotaBytes)}
                        description="下げても置いてある画像は消しません。越えている人は、減らすまで新しく上げられません。"
                        disabled={busy}
                        onChange={(next) => void change(next)}
                    />
                </>
            )}
            {error && (
                <p className={adminError} role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}

const section = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '3',
    p: '4',
    bg: 'surface',
    borderRadius: '12px',
});
const heading = css({ fontSize: 'lg', fontWeight: '700', color: 'text' });
const lead = css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6' });
