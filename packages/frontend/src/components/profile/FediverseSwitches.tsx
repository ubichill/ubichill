import type { FediverseOverview, FediverseSettingsUpdate } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/Switch';
import { fetchFediverse, updateFediverseSettings } from '@/lib/fediverseApi';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';

const note = css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.6' });

/** フェディバースの設定（フォローを承認制にするか・おすすめや検索に出すか）。フォロワーの管理は「フェディバース」のタブ。 */
export function FediverseSwitches() {
    const [overview, setOverview] = useState<Pick<FediverseOverview, 'enabled' | 'settings'> | null>(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const ctrl = { cancelled: false };
        fetchFediverse()
            .then((data) => !ctrl.cancelled && setOverview(data))
            .catch((e: unknown) => !ctrl.cancelled && setError(e instanceof Error ? e.message : '読み込めません'));
        return () => {
            ctrl.cancelled = true;
        };
    }, []);

    if (!overview) return error ? <p className={css({ fontSize: '13px', color: 'errorText' })}>{error}</p> : null;
    if (!overview.enabled) return <p className={note}>このサーバーはほかのサーバーとつながっていません。</p>;

    const change = async (update: FediverseSettingsUpdate) => {
        setSaving(true);
        try {
            const settings = await updateFediverseSettings(update);
            setOverview((current) => current && { ...current, settings });
        } catch (e) {
            pushToast(e instanceof Error ? e.message : '変更できませんでした', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <Switch
                title="フォローを承認制にする"
                description="オンにすると、フォローされる前にあなたが承認します。オフにすると、承認待ちはまとめて承認されます。"
                on={overview.settings.manuallyApprovesFollowers}
                disabled={saving}
                onChange={(next) => void change({ manuallyApprovesFollowers: next })}
            />
            <Switch
                title="おすすめや検索に出す"
                description="オフにしても、アカウントを直接検索すれば見つかります。"
                on={overview.settings.discoverable}
                disabled={saving}
                onChange={(next) => void change({ discoverable: next })}
            />
        </div>
    );
}
