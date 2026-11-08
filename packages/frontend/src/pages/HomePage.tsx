import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { signOut } from '@/lib/auth-client';
import { homeInstanceEntry, readHomeEntryState } from '@/lib/home';
import { ensureHomeInstance } from '@/lib/homeApi';
import { resetHome } from '@/lib/homeStore';
import { css, cva } from '@/styled-system/css';
import { InstanceLoadingScreen } from '@/world/InstanceLoadingScreen';

const PREPARING_STAGES = [{ id: 'auth' as const, label: 'ホームを用意しています', status: 'active' as const }];

/**
 * `/`。ロビーは無く、ログインしたらホームの部屋を新しく作ってそのまま移る。
 * ホームの部屋に入れずに戻ってきたときは、自動ではもう作らず選んでもらう（作っては失敗するのを繰り返さない）。
 */
export function HomePage() {
    const navigate = useNavigate();
    const location = useLocation();
    // null は選んでもらうのを待っている
    const [attempt, setAttempt] = useState<{ useDefault: boolean } | null>(() =>
        readHomeEntryState(location.state).homeFailed ? null : { useDefault: false },
    );
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!attempt) return;
        const ctrl = { cancelled: false };
        setError(null);
        ensureHomeInstance(attempt)
            .then((response) => {
                if (!ctrl.cancelled)
                    navigate(`/instance/${response.instance.id}`, {
                        replace: true,
                        state: homeInstanceEntry(response),
                    });
            })
            .catch((e: unknown) => {
                if (ctrl.cancelled) return;
                setError(e instanceof Error ? e.message : 'ホームを用意できません');
                setAttempt(null);
            });
        return () => {
            ctrl.cancelled = true;
        };
    }, [attempt, navigate]);

    const handleLogout = useCallback(async () => {
        await signOut();
        resetHome();
        navigate('/auth', { replace: true });
    }, [navigate]);

    if (attempt) {
        return (
            <InstanceLoadingScreen
                progress={5}
                stages={PREPARING_STAGES}
                fadingOut={false}
                failed={false}
                failureMessage={null}
                recoveryLabel=""
                onRecover={() => undefined}
            />
        );
    }

    return (
        <main className={screen}>
            <h1 className={css({ fontSize: '22px', fontWeight: 'bold', textAlign: 'center' })}>
                ホームに入れませんでした
            </h1>
            {error && (
                <p className={css({ color: 'hudTextMuted', fontSize: '14px', textAlign: 'center', maxW: '420px' })}>
                    {error}
                </p>
            )}
            <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '3', justifyContent: 'center' })}>
                <button
                    type="button"
                    className={action({ tone: 'primary' })}
                    onClick={() => setAttempt({ useDefault: false })}
                >
                    もう一度試す
                </button>
                <button type="button" className={action()} onClick={() => setAttempt({ useDefault: true })}>
                    既定のワールドで入る
                </button>
                <button type="button" className={action({ tone: 'quiet' })} onClick={() => void handleLogout()}>
                    ログアウト
                </button>
            </div>
        </main>
    );
}

const screen = css({
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '5',
    p: '6',
    bg: 'primary',
    color: 'hudText',
});

const action = cva({
    base: {
        px: '5',
        py: '3',
        borderRadius: '12px',
        border: '1px solid',
        borderColor: 'hudBorder',
        fontSize: '14px',
        fontWeight: '700',
        cursor: 'pointer',
        bg: 'hudActionHover',
        color: 'hudText',
        _hover: { bg: 'hudBg' },
    },
    variants: {
        tone: {
            primary: { bg: 'surface', color: 'text', borderColor: 'surface', _hover: { bg: 'surfaceHover' } },
            default: {},
            quiet: { bg: 'transparent', color: 'hudTextMuted' },
        },
    },
    defaultVariants: { tone: 'default' },
});
