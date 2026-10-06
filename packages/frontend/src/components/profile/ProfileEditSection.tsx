import type { FavoritesVisibility } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { setMyFavoritesVisibility } from '@/lib/account/me';
import { API_BASE } from '@/lib/api';
import { css } from '@/styled-system/css';
import { BioSection } from './BioSection';
import { DisplayNameEditor } from './DisplayNameEditor';
import { FavoritesVisibilityPicker } from './FavoritesVisibilityPicker';
import type { MyAccountState } from './useMyAccount';

const label = css({ fontSize: '13px', fontWeight: '700', color: 'text', mb: '1' });

/** 設定の「プロフィール」: 表示名・自己紹介・お気に入りの公開範囲。 */
export function ProfileEditSection({ account }: { account: MyAccountState }) {
    const { profile, setProfile } = account;
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
            <div>
                <p className={label}>表示名</p>
                <p className={css({ fontSize: '15px', color: 'text', mb: '1' })}>{profile.name}</p>
                <DisplayNameEditor
                    name={profile.name}
                    conflict={!!profile.displayNameConflict}
                    onChanged={(name) => setProfile({ ...profile, name, displayNameConflict: false })}
                />
            </div>
            <div>
                <p className={label}>自己紹介</p>
                <BioSection bio={profile.bio ?? null} editable onChanged={(bio) => setProfile({ ...profile, bio })} />
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
        </div>
    );
}
