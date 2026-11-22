import { type Instance, ROOM_PORTAL } from '@ubichill/shared';
import { type ReactNode, useState } from 'react';
import { HudIcon, type HudIconName } from '@/components/hud/HudIcon';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { Dialog } from '@/components/ui/Dialog';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';

export type NewInstanceCreate = (options: { holdEmptyMs?: number }) => Promise<Instance>;

export interface NewInstance {
    busy: boolean;
    /** 作り始める。部屋の中では入るかポータルを置くかを選ぶダイアログを出し、部屋の外ではそのまま作って入る */
    start: () => void;
    /** 選ぶダイアログ（部屋の外では null）。呼び出し側のどこかに置く */
    dialog: ReactNode;
}

/**
 * 新しいインスタンスを作る。部屋の中（ランチパッド）では、作った部屋に入るか、今の部屋にそこへのポータルを置くかを
 * 作る前に選ぶ（作ってから選ぶと、やめたときに空の部屋が残る）。ポータルの先は誰かが通るまで空なので、
 * ポータルがある間は消さないよう頼んで作る。
 */
export function useNewInstance({
    create,
    enter,
}: {
    create: NewInstanceCreate;
    enter: (instance: Instance) => void;
}): NewInstance {
    const portal = useHudNavigation()?.portal ?? null;
    const [choosing, setChoosing] = useState(false);
    const [busy, setBusy] = useState(false);

    const run = async (goal: 'enter' | 'portal') => {
        setChoosing(false);
        setBusy(true);
        try {
            if (goal === 'portal' && portal) {
                const instance = await create({ holdEmptyMs: ROOM_PORTAL.LIFETIME_MS });
                await portal.open(instance.id);
            } else {
                enter(await create({}));
            }
        } catch (e) {
            pushToast(e instanceof Error ? e.message : 'インスタンスの作成に失敗しました', 'error');
        } finally {
            setBusy(false);
        }
    };

    return {
        busy,
        start: () => {
            if (busy) return;
            if (portal) setChoosing(true);
            else void run('enter');
        },
        dialog: portal && (
            <Dialog open={choosing} title="新しいインスタンス" onClose={() => setChoosing(false)} closeButton>
                <div className={choices}>
                    <ChoiceButton
                        icon="enter"
                        label="入る"
                        note="今の部屋を出て移ります"
                        onClick={() => void run('enter')}
                    />
                    <ChoiceButton
                        icon="portal"
                        label="ポータルを置く"
                        note={
                            portal.unavailable ?? `今の部屋に置きます。${ROOM_PORTAL.LIFETIME_MS / 1000} 秒で消えます`
                        }
                        disabled={portal.unavailable !== null}
                        onClick={() => void run('portal')}
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
