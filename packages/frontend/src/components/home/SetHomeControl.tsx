import { type AccessType, DEFAULT_HOME_ACCESS_TYPE } from '@ubichill/shared';
import { useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { AccessTypeSelect } from '@/components/worlds/AccessTypeSelect';
import { isHomeWorld } from '@/lib/home';
import { saveHome, useHome } from '@/lib/homeStore';
import { useSession } from '@/lib/session';
import { pushToast } from '@/lib/toast';
import { css, cva } from '@/styled-system/css';

interface SetHomeControlProps {
    /** ワールドの id と正規 URL（URL があれば URL で設定する。外部のワールドは id では解決できない） */
    world: { id: string; url?: string };
}

/** ワールドの詳細の「ホームに設定」。ログインしていなければ出さない。 */
export function SetHomeControl({ world }: SetHomeControlProps) {
    const { data: session } = useSession();
    if (!session) return null;
    return <SetHomeForm world={world} />;
}

function SetHomeForm({ world }: SetHomeControlProps) {
    const { home, error } = useHome();
    const [editing, setEditing] = useState(false);
    const [accessType, setAccessType] = useState<AccessType | null>(null);
    const [saving, setSaving] = useState(false);

    // 読み込み中は出さない。読めなかったとき（通信の失敗など）は、設定はできるのでボタンを出す
    if (!home && !error) return null;
    if (isHomeWorld(world, home)) {
        return (
            <p className={statusRow}>
                <HudIcon name="home" size={16} />
                このワールドがホームです
            </p>
        );
    }

    const chosen = accessType ?? home?.accessType ?? DEFAULT_HOME_ACCESS_TYPE;
    const handleSave = async () => {
        setSaving(true);
        try {
            await saveHome({ worldRef: world.url ?? world.id, accessType: chosen });
            pushToast('ホームに設定しました。次にホームへ移動したときから使われます');
            setEditing(false);
        } catch (e: unknown) {
            pushToast(e instanceof Error ? e.message : 'ホームに設定できませんでした', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (!editing) {
        return (
            <button type="button" className={button({ tone: 'outline' })} onClick={() => setEditing(true)}>
                <HudIcon name="home" size={16} />
                ホームに設定
            </button>
        );
    }

    return (
        <div className={panel}>
            <AccessTypeSelect value={chosen} onChange={setAccessType} />
            <div className={css({ display: 'flex', gap: '2' })}>
                <button
                    type="button"
                    className={button({ tone: 'primary' })}
                    disabled={saving}
                    onClick={() => void handleSave()}
                >
                    {saving ? '設定中...' : 'ホームにする'}
                </button>
                <button type="button" className={button({ tone: 'quiet' })} onClick={() => setEditing(false)}>
                    やめる
                </button>
            </div>
        </div>
    );
}

const statusRow = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2',
    fontSize: '13px',
    fontWeight: '700',
    color: 'successText',
});

const panel = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '3',
    p: '3',
    bg: 'background',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '12px',
});

const button = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2',
        py: '2',
        px: '4',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '700',
        cursor: 'pointer',
        _disabled: { opacity: 0.6, cursor: 'wait' },
    },
    variants: {
        tone: {
            primary: { bg: 'primary', color: 'textOnPrimary', border: 'none', _hover: { bg: 'primaryHover' } },
            outline: {
                alignSelf: 'flex-start',
                bg: 'surface',
                color: 'text',
                border: '1px solid',
                borderColor: 'border',
                _hover: { borderColor: 'borderStrong' },
            },
            quiet: { bg: 'transparent', color: 'textMuted', border: 'none' },
        },
    },
});
