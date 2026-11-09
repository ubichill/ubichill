import type { FavoritesVisibility } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { setMyFavoritesVisibility } from '@/lib/account/me';
import { API_BASE } from '@/lib/api';
import { css } from '@/styled-system/css';
import { FavoritesVisibilityPicker } from './FavoritesVisibilityPicker';
import { FediverseSection } from './FediverseSection';
import type { MyAccountState } from './useMyAccount';

const label = css({ fontSize: '13px', fontWeight: '700', color: 'text', mb: '1' });
const openButton = css({
    alignSelf: 'flex-start',
    px: '4',
    py: '2',
    borderRadius: '8px',
    border: '1px solid',
    borderColor: 'border',
    bg: 'surface',
    color: 'text',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover' },
});

/**
 * 設定の「プロフィール」: お気に入りの公開範囲・フェディバース（フォローの承認制など）。表示名・ひとこと・自己紹介・リンク・画像は、プロフィールのページで
 * 見た目を確かめながら編集する（編集の場所を 1 つにする）。
 */
export function ProfileEditSection({ account, onNavigate }: { account: MyAccountState; onNavigate?: () => void }) {
    const { profile } = account;
    const navigate = useNavigate();
    const confirm = useConfirm();
    const [visibility, setVisibility] = useState<FavoritesVisibility | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!profile) return;
        const ctrl = { cancelled: false };
        fetch(`${API_BASE}/api/v1/users/${encodeURIComponent(profile.id)}/favorites`, { credentials: 'include' })
            .then(async (res) => (res.ok ? ((await res.json()) as { visibility?: FavoritesVisibility }) : {}))
            .then((data) => !ctrl.cancelled && setVisibility(data.visibility ?? 'private'))
            .catch(() => undefined);
        return () => {
            ctrl.cancelled = true;
        };
    }, [profile]);

    if (!profile) return null;

    const changeVisibility = async (next: FavoritesVisibility) => {
        setSaving(true);
        setError('');
        try {
            setVisibility(await setMyFavoritesVisibility(next));
        } catch (e) {
            setError(e instanceof Error ? e.message : '公開範囲を変更できませんでした');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '5' })}>
            <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                <p className={label}>表示名・ひとこと・自己紹介・リンク・画像</p>
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                    {profile.displayNameConflict
                        ? 'ほかの人と同じ表示名になっています。プロフィールのページで表示名を変えてください。'
                        : 'プロフィールのページで、見た目を確かめながら編集できます。'}
                </p>
                <button
                    type="button"
                    className={openButton}
                    onClick={async () => {
                        if (!(await confirm('プロフィールのページに移動しますか？'))) return;
                        onNavigate?.();
                        navigate(`/@${profile.handle}`);
                    }}
                >
                    プロフィールを開く
                </button>
            </div>
            <div>
                <p className={label}>お気に入りの公開範囲</p>
                {visibility && (
                    <FavoritesVisibilityPicker
                        value={visibility}
                        disabled={saving}
                        onChange={(v) => void changeVisibility(v)}
                    />
                )}
                {error && <p className={css({ fontSize: '13px', color: 'errorText' })}>{error}</p>}
            </div>
            <FediverseSection />
        </div>
    );
}
