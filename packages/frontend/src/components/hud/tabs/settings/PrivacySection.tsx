import type { FavoritesVisibility, PresenceVisibility, PrivacySettings } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { FavoritesVisibilityPicker } from '@/components/profile/FavoritesVisibilityPicker';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { fetchMyPrivacy, setMyFavoritesVisibility, setMyPresenceVisibility } from '@/lib/account/me';
import { PRESENCE_VISIBILITY_OPTIONS } from '@/lib/account/presenceVisibility';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { BlockedUsersSection } from './BlockedUsersSection';
import { settingsGroup, settingsHeading } from './settingsStyles';

/**
 * 設定の「プライバシー」: フレンドやほかの人に何を見せるか（オンライン状態・お気に入り）と、ブロックした人。選んだらすぐ保存する。
 * フェディバースのフォローの受け方は「フェディバース」の欄。
 */
export function PrivacySection() {
    const [settings, setSettings] = useState<PrivacySettings | null>(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const ctrl = { cancelled: false };
        fetchMyPrivacy()
            .then((data) => !ctrl.cancelled && setSettings(data))
            .catch((e: unknown) => !ctrl.cancelled && setError(e instanceof Error ? e.message : '読み込めません'));
        return () => {
            ctrl.cancelled = true;
        };
    }, []);

    const save = async (change: () => Promise<Partial<PrivacySettings>>) => {
        setSaving(true);
        try {
            const saved = await change();
            setSettings((current) => current && { ...current, ...saved });
        } catch (e) {
            pushToast(e instanceof Error ? e.message : '変更できませんでした', 'error');
        } finally {
            setSaving(false);
        }
    };
    const changePresence = (next: PresenceVisibility) =>
        void save(async () => ({ presenceVisibility: await setMyPresenceVisibility(next) }));
    const changeFavorites = (next: FavoritesVisibility) =>
        void save(async () => ({ favoritesVisibility: await setMyFavoritesVisibility(next) }));

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '6' })}>
            {error && <p className={css({ fontSize: '13px', color: 'errorText' })}>{error}</p>}
            {settings && (
                <>
                    <section className={settingsGroup}>
                        <h3 className={settingsHeading}>オンライン状態</h3>
                        <ChoiceGroup
                            label="オンライン状態をフレンドにどこまで見せるか"
                            choices={PRESENCE_VISIBILITY_OPTIONS}
                            value={settings.presenceVisibility}
                            description={
                                PRESENCE_VISIBILITY_OPTIONS.find((o) => o.value === settings.presenceVisibility)
                                    ?.description
                            }
                            disabled={saving}
                            onChange={changePresence}
                        />
                    </section>
                    <section className={settingsGroup}>
                        <h3 className={settingsHeading}>お気に入りの公開範囲</h3>
                        <FavoritesVisibilityPicker
                            value={settings.favoritesVisibility}
                            disabled={saving}
                            onChange={changeFavorites}
                        />
                    </section>
                </>
            )}
            <BlockedUsersSection />
        </div>
    );
}
