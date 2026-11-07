import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { signOut } from '@/lib/auth-client';
import { decideHomeEntry, readHomeEntryState } from '@/lib/home';
import { ensureHomeInstance } from '@/lib/homeApi';
import { resetHome } from '@/lib/homeStore';
import { css, cva } from '@/styled-system/css';
import { InstanceLoadingScreen } from '@/world/InstanceLoadingScreen';

type Phase =
    | { kind: 'loading' }
    /** 直前に入れなかったホームの部屋がまた返ってきた */
    | { kind: 'blocked' }
    | { kind: 'error'; message: string };

const PREPARING_STAGES = [{ id: 'auth' as const, label: 'ホームを用意しています', status: 'active' as const }];

/**
 * `/`。ロビーは無く、ログインしたらホームの部屋（あれば使い回し、無ければ作る）へそのまま移る。
 * 部屋に入れずに戻ってきたときは、同じ部屋へ自動で戻し続けず、選んでもらう。
 */
export function HomePage() {
    const navigate = useNavigate();
    const location = useLocation();
    // 入ってきたときの状態だけを見る（試し直しで読み直さない）
    const [entry] = useState(() => readHomeEntryState(location.state));
    const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
    const [attempt, setAttempt] = useState<{ useDefault: boolean; ignoreFailure: boolean }>({
        useDefault: false,
        ignoreFailure: false,
    });

    useEffect(() => {
        const ctrl = { cancelled: false };
        setPhase({ kind: 'loading' });
        ensureHomeInstance({ useDefault: attempt.useDefault })
            .then((response) => {
                if (ctrl.cancelled) return;
                const decision = decideHomeEntry(response, entry, { ignoreFailure: attempt.ignoreFailure });
                if (decision.kind === 'blocked') {
                    setPhase({ kind: 'blocked' });
                    return;
                }
                navigate(`/instance/${decision.instanceId}`, { replace: true, state: decision.state });
            })
            .catch((e: unknown) => {
                if (!ctrl.cancelled)
                    setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'ホームを用意できません' });
            });
        return () => {
            ctrl.cancelled = true;
        };
    }, [attempt, entry, navigate]);

    const handleLogout = useCallback(async () => {
        await signOut();
        resetHome();
        navigate('/auth', { replace: true });
    }, [navigate]);

    if (phase.kind === 'loading') {
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
            <p className={css({ color: 'hudTextMuted', fontSize: '14px', textAlign: 'center', maxW: '420px' })}>
                {phase.kind === 'blocked'
                    ? 'ホームの部屋に接続できませんでした。同じアカウントで別のタブ・端末から入っているときは、そちらを使ってください。'
                    : phase.message}
            </p>
            <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '3', justifyContent: 'center' })}>
                <button
                    type="button"
                    className={action({ tone: 'primary' })}
                    onClick={() => setAttempt({ useDefault: false, ignoreFailure: true })}
                >
                    もう一度試す
                </button>
                <button
                    type="button"
                    className={action()}
                    onClick={() => setAttempt({ useDefault: true, ignoreFailure: true })}
                >
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
