import type { AccessType } from '@ubichill/shared';
import { useState } from 'react';
import { AccessTypeSelect } from '@/components/worlds/AccessTypeSelect';
import { saveHome, useHome } from '@/lib/homeStore';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';

/** 設定の「ホーム」。ホームのワールドの確認・公開範囲の変更・既定のワールドに戻す。 */
export function HomeSettingsSection() {
    const { home, loading, error } = useHome();
    const [saving, setSaving] = useState(false);

    const save = async (update: { accessType?: AccessType; worldRef?: null }, message: string) => {
        setSaving(true);
        try {
            await saveHome(update);
            pushToast(message);
        } catch (e: unknown) {
            pushToast(e instanceof Error ? e.message : '変更できませんでした', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (!home) {
        return (
            <p className={css({ fontSize: '13px', color: error ? 'errorText' : 'textMuted' })}>
                {error ?? (loading ? '読み込み中...' : '')}
            </p>
        );
    }

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
            <p className={css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.7' })}>
                ログインしたときと、ランチパッドの「ホーム」で入る部屋です。ワールドはワールドの詳細の「ホームに設定」で変えられます。
            </p>
            <div className={worldRow}>
                {home.world?.thumbnail ? (
                    <img src={home.world.thumbnail} alt="" className={thumbnail} />
                ) : (
                    <span className={thumbnail} />
                )}
                <div className={css({ minW: 0, display: 'flex', flexDirection: 'column', gap: '1' })}>
                    <span className={css({ fontSize: '12px', color: 'textMuted', fontWeight: '700' })}>
                        {home.worldRef === null ? '既定のワールド' : 'ホームのワールド'}
                    </span>
                    <span className={css({ fontSize: '16px', fontWeight: '700', color: 'text' })}>
                        {home.world?.displayName ?? '開けないワールド'}
                    </span>
                    {!home.world && (
                        <span className={css({ fontSize: '12px', color: 'errorText' })}>
                            開けないときは既定のワールドに入ります
                        </span>
                    )}
                </div>
            </div>
            <AccessTypeSelect
                value={home.accessType}
                onChange={(accessType) => void save({ accessType }, 'ホームの公開範囲を変えました')}
            />
            {home.worldRef !== null && (
                <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save({ worldRef: null }, 'ホームを既定のワールドに戻しました')}
                    className={css({
                        alignSelf: 'flex-start',
                        px: '4',
                        py: '2',
                        bg: 'secondary',
                        color: 'text',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '13px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        _disabled: { opacity: 0.6, cursor: 'wait' },
                    })}
                >
                    既定のワールドに戻す
                </button>
            )}
        </div>
    );
}

const worldRow = css({
    display: 'flex',
    alignItems: 'center',
    gap: '4',
    p: '3',
    bg: 'background',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '12px',
});

const thumbnail = css({
    w: '96px',
    h: '64px',
    flexShrink: 0,
    borderRadius: '8px',
    objectFit: 'cover',
    bg: 'surfaceAccent',
});
