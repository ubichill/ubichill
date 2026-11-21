import type { BotCheckAction, BotProtectionProvider } from '@ubichill/shared';
import { useEffect, useRef, useState } from 'react';
import { type BotWidgetApi, botWidgetOptions, loadBotWidget } from '@/lib/account/botProtection';
import { css, cva } from '@/styled-system/css';

/**
 * ボットでないことを確かめるウィジェット（Turnstile・hCaptcha）。確かめ終わると onToken にトークンを渡し、
 * 期限切れ・失敗・作り直しでは null を渡す。トークンは 1 回しか使えないので、送った後は key を変えて作り直す。
 * `onToken` は変わらない関数（useState の set など）を渡す。
 */
export function BotCheck({
    provider,
    siteKey,
    action,
    onToken,
    failureHint,
}: {
    provider: BotProtectionProvider;
    siteKey: string;
    action: BotCheckAction;
    onToken: (token: string | null) => void;
    /** 読み込めない・ウィジェットが失敗したときに添える説明 */
    failureHint?: string;
}) {
    const container = useRef<HTMLDivElement>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    // biome-ignore lint/correctness/useExhaustiveDependencies: attempt は「もう一度」で作り直すためだけに見る
    useEffect(() => {
        const element = container.current;
        if (!element) return;
        const widget: { cancelled: boolean; api: BotWidgetApi | null; id: string | null } = {
            cancelled: false,
            api: null,
            id: null,
        };
        setFailed(false);
        const handlers = {
            onToken: (token: string | null) => {
                if (token) setFailed(false);
                onToken(token);
            },
            onError: () => setFailed(true),
        };
        loadBotWidget(provider)
            .then((api) => {
                if (widget.cancelled) return;
                widget.api = api;
                widget.id = api.render(element, botWidgetOptions({ provider, siteKey }, action, handlers));
            })
            .catch(() => {
                if (!widget.cancelled) setFailed(true);
            });
        return () => {
            widget.cancelled = true;
            onToken(null);
            if (widget.api && widget.id !== null) widget.api.remove(widget.id);
        };
    }, [provider, siteKey, action, onToken, attempt]);

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5', w: 'full' })}>
            <div ref={container} className={widgetBox({ provider })} />
            {failed && (
                <div role="alert" className={css({ display: 'flex', flexDirection: 'column', gap: '1', w: 'full' })}>
                    <p className={css({ fontSize: '13px', color: 'errorText' })}>
                        ボット対策を読み込めませんでした。{failureHint ?? '広告ブロッカーなどを止めてお試しください。'}
                    </p>
                    <button
                        type="button"
                        className={css({
                            alignSelf: 'flex-start',
                            fontSize: '13px',
                            color: 'primary',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                        })}
                        onClick={() => setAttempt((n) => n + 1)}
                    >
                        もう一度読み込む
                    </button>
                </div>
            )}
        </div>
    );
}

/**
 * 読み込む前から場所を取っておく（届いた後に画面がずれない）。高さはサービスのウィジェットに合わせる。
 * Turnstile は幅いっぱいに広がる（size: flexible）。hCaptcha は幅が決まっているので真ん中に置く
 */
const widgetBox = cva({
    base: { w: 'full' },
    variants: {
        provider: {
            turnstile: { display: 'block', minH: '65px' },
            hcaptcha: { display: 'flex', justifyContent: 'center', minH: '78px' },
        },
    },
});
