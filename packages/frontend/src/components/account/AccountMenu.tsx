import { useSocket } from '@ubichill/react';
import { useEffect, useId, useRef, useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import {
    ADD_ACCOUNT_PATH,
    type BrowserAccount,
    listBrowserAccounts,
    signOutThisAccount,
    switchAccount,
} from '@/lib/account/accountSwitch';
import { pushToast } from '@/lib/toast';
import { css, cva } from '@/styled-system/css';

/**
 * プロフィールのアイコンの横の「…」。このブラウザーでログインしたアカウントへの切り替え・アカウントの追加・
 * このアカウントのログアウト。切り替えた後は持ち主ごとの状態を残さないよう、画面を読み直す。
 */
export function AccountMenu() {
    const { leaveWorld } = useSocket();
    const [open, setOpen] = useState(false);
    const [accounts, setAccounts] = useState<BrowserAccount[] | null>(null);
    const [busy, setBusy] = useState(false);
    const menuId = useId();
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        listBrowserAccounts()
            .then(setAccounts)
            .catch(() => setAccounts([]));
        const onPointer = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
            }
        };
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [open]);

    const run = async (action: () => Promise<string>) => {
        setBusy(true);
        try {
            await leaveWorld().catch(() => undefined);
            window.location.assign(await action());
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'うまくいきませんでした', 'error');
            setBusy(false);
        }
    };

    const others = (accounts ?? []).filter((a) => !a.active);

    return (
        <div ref={rootRef} className={css({ position: 'relative' })}>
            <button
                type="button"
                className={moreButton}
                aria-label="アカウント"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={menuId}
                onClick={() => setOpen((v) => !v)}
            >
                <HudIcon name="more" size={12} />
            </button>
            {open && (
                <div id={menuId} role="menu" className={menu}>
                    {others.map((account) => (
                        <button
                            key={account.userId}
                            type="button"
                            role="menuitem"
                            className={item()}
                            disabled={busy}
                            onClick={() =>
                                void run(async () => {
                                    await switchAccount(account.userId);
                                    return '/';
                                })
                            }
                        >
                            <Avatar account={account} />
                            <span className={css({ display: 'flex', flexDirection: 'column', minW: 0 })}>
                                <span className={name}>{account.name}</span>
                                <span className={handle}>@{account.handle}</span>
                            </span>
                        </button>
                    ))}
                    <button
                        type="button"
                        role="menuitem"
                        className={item()}
                        disabled={busy}
                        onClick={() => void run(async () => ADD_ACCOUNT_PATH)}
                    >
                        <HudIcon name="userPlus" size={18} />
                        アカウントを追加
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={item({ danger: true })}
                        disabled={busy}
                        onClick={() => void run(async () => ((await signOutThisAccount()) ? '/' : '/auth'))}
                    >
                        <HudIcon name="logout" size={18} />
                        ログアウト
                    </button>
                </div>
            )}
        </div>
    );
}

function Avatar({ account }: { account: BrowserAccount }) {
    const [failed, setFailed] = useState(false);
    if (account.image && !failed) {
        return <img src={account.image} alt="" className={avatar} onError={() => setFailed(true)} />;
    }
    return (
        <span className={avatar} aria-hidden="true">
            {Array.from(account.name)[0] ?? '?'}
        </span>
    );
}

const moreButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '18px',
    h: '18px',
    // アイコンに重ねるので、縁取りでアイコンと切り分ける
    border: '2px solid',
    borderColor: 'primary',
    borderRadius: 'full',
    bg: 'hudAvatar',
    color: 'hudText',
    cursor: 'pointer',
    _hover: { bg: 'hudActionHover', color: 'hudText' },
    _focusVisible: { outline: '2px solid token(colors.hudText)', outlineOffset: '1px' },
});

// プロフィールはレールの先頭（スマホでは左端・PC では上端）なので、スマホでは下へ左揃え、PC では右へ出す
const menu = css({
    position: 'absolute',
    zIndex: 50,
    top: { base: 'calc(100% + 6px)', md: '0' },
    left: { base: '0', md: 'calc(100% + 8px)' },
    minW: '220px',
    display: 'flex',
    flexDirection: 'column',
    p: '1.5',
    // 下の画面が透けて読みにくくならないよう、不透明にする
    bg: 'primary',
    border: '1px solid',
    borderColor: 'hudBorder',
    borderRadius: '10px',
    boxShadow: 'modal',
});

const item = cva({
    base: {
        display: 'flex',
        alignItems: 'center',
        gap: '2.5',
        w: 'full',
        px: '2.5',
        py: '2',
        border: 'none',
        borderRadius: '6px',
        bg: 'transparent',
        color: 'hudText',
        fontSize: '13px',
        textAlign: 'left',
        cursor: 'pointer',
        _hover: { bg: 'hudActionHover' },
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
    variants: { danger: { true: { color: 'errorLight' } } },
});

const avatar = css({
    w: '28px',
    h: '28px',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'full',
    objectFit: 'cover',
    bg: 'hudAvatar',
    color: 'hudText',
    fontSize: '12px',
    fontWeight: '800',
});

const name = css({ fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const handle = css({ fontSize: '11px', color: 'hudTextMuted', overflow: 'hidden', textOverflow: 'ellipsis' });
