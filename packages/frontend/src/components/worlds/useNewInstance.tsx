import { canStartInstance, type Instance, ROOM_PORTAL, type WorldVisibility } from '@ubichill/shared';
import { type ReactNode, useState } from 'react';
import { HudIcon, type HudIconName } from '@/components/hud/HudIcon';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { Dialog } from '@/components/ui/Dialog';
import { useSession } from '@/lib/session';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';

/** signal は作るのを取りやめる合図（ポータルを置いている途中でやめた・時間切れ） */
export type NewInstanceCreate = (options: { holdEmptyMs?: number }, signal?: AbortSignal) => Promise<Instance>;

export const PRIVATE_WORLD_START_MESSAGE = 'プライベートのワールドです。インスタンスを作れるのは作者だけです';

export interface NewInstance {
    busy: boolean;
    /** 作れない理由（プライベートのワールドで作者でない）。作れるなら null。ボタンを押せなくして title に出す */
    blocked: string | null;
    /** 作り始める。部屋の中では入るかポータルを置くかを選ぶダイアログを出し、部屋の外ではそのまま作って入る */
    start: () => void;
    /** 選ぶダイアログ（部屋の外では null）。呼び出し側のどこかに置く */
    dialog: ReactNode;
}

/**
 * 新しいインスタンスを作る。部屋の中（ランチパッド）では、作った部屋に入るか、今の部屋にそこへのポータルを置くかを
 * 作る前に選ぶ（作ってから選ぶと、やめたときに空の部屋が残る）。ポータルは置く場所を選んでから作る（選ぶのをやめたら作らない）。
 * ポータルの先は誰かが通るまで空なので、ポータルがある間は消さないよう頼んで作る。
 */
export function useNewInstance({
    world,
    create,
    enter,
}: {
    /** 公開範囲を見るワールド（読み込む前は null。作れるかは作るときに backend も確かめる）。名前とサムネイルはポータルの見た目 */
    world: { visibility?: WorldVisibility; authorId?: string; displayName?: string; thumbnail?: string } | null;
    create: NewInstanceCreate;
    enter: (instance: Instance) => void;
}): NewInstance {
    const portal = useHudNavigation()?.portal ?? null;
    const viewerId = useSession().data?.user.id ?? null;
    const blocked = world && !canStartInstance(world, viewerId) ? PRIVATE_WORLD_START_MESSAGE : null;
    const [choosing, setChoosing] = useState(false);
    const [busy, setBusy] = useState(false);

    const enterNew = async () => {
        setChoosing(false);
        setBusy(true);
        try {
            enter(await create({}));
        } catch (e) {
            pushToast(e instanceof Error ? e.message : 'インスタンスの作成に失敗しました', 'error');
        } finally {
            setBusy(false);
        }
    };

    const placePortal = () => {
        setChoosing(false);
        portal?.place({
            look: { name: world?.displayName || 'ポータル', thumbnail: world?.thumbnail },
            room: (signal) => create({ holdEmptyMs: ROOM_PORTAL.LIFETIME_MS }, signal).then((instance) => instance.id),
        });
    };

    return {
        busy,
        blocked,
        start: () => {
            if (busy || blocked) return;
            if (portal) setChoosing(true);
            else void enterNew();
        },
        dialog: portal && (
            <Dialog open={choosing} title="新しいインスタンス" onClose={() => setChoosing(false)} closeButton>
                <div className={choices}>
                    <ChoiceButton
                        icon="enter"
                        label="入る"
                        note="今のインスタンスを出て移ります"
                        onClick={() => void enterNew()}
                    />
                    <ChoiceButton
                        icon="portal"
                        label="ポータルを置く"
                        note={
                            portal.unavailable ??
                            `今のインスタンスの好きな所に置きます。${ROOM_PORTAL.LIFETIME_MS / 1000} 秒で消えます`
                        }
                        disabled={portal.unavailable !== null}
                        onClick={placePortal}
                    />
                </div>
            </Dialog>
        ),
    };
}

function ChoiceButton({
    icon,
    label,
    note,
    disabled,
    onClick,
}: {
    icon: HudIconName;
    label: string;
    note: string;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button type="button" className={choice} disabled={disabled} onClick={onClick}>
            <span className={choiceIcon}>
                <HudIcon name={icon} size={20} />
            </span>
            <span className={css({ display: 'flex', flexDirection: 'column', gap: '0.5', minW: 0 })}>
                <span className={css({ fontSize: 'md', fontWeight: '700', color: 'text' })}>{label}</span>
                <span className={css({ fontSize: 'xs', color: 'textMuted' })}>{note}</span>
            </span>
        </button>
    );
}

const choices = css({ display: 'flex', flexDirection: 'column', gap: '2' });

const choice = css({
    display: 'flex',
    alignItems: 'center',
    gap: '3',
    w: 'full',
    p: '3',
    textAlign: 'left',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '12px',
    cursor: 'pointer',
    _hover: { borderColor: 'borderStrong', bg: 'surfaceHover' },
    _focusVisible: { outline: '3px solid', outlineColor: 'primaryHighlight' },
    _disabled: { opacity: 0.5, cursor: 'not-allowed', _hover: { borderColor: 'border', bg: 'surface' } },
});

const choiceIcon = css({
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '40px',
    h: '40px',
    borderRadius: 'full',
    bg: 'primarySubtle',
    color: 'primary',
});
