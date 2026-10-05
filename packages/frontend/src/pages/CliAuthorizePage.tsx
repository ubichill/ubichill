import { normalizeUserCode } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { approveCliAuthRequest, type CliAuthRequestView, fetchCliAuthRequest, keyFingerprint } from '@/lib/cliAuthApi';
import { useSession } from '@/lib/session';
import { css, cva } from '@/styled-system/css';

const page = css({
    minH: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    p: '4',
    bg: 'background',
});
const card = css({
    w: '100%',
    maxW: '520px',
    p: '6',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '16px',
});
const button = cva({
    base: {
        px: '4',
        py: '2',
        borderRadius: '10px',
        fontSize: '14px',
        fontWeight: '700',
        cursor: 'pointer',
        border: '1px solid',
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
    variants: {
        tone: {
            primary: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary' },
            secondary: { bg: 'surface', color: 'text', borderColor: 'border' },
        },
    },
});
const row = css({
    display: 'flex',
    justifyContent: 'space-between',
    gap: '3',
    py: '2',
    borderTop: '1px solid',
    borderColor: 'border',
    fontSize: '13px',
});

type State =
    | { status: 'enter-code'; error?: string }
    | { status: 'loading' }
    | { status: 'ready'; request: CliAuthRequestView }
    | { status: 'done'; request: CliAuthRequestView }
    | { status: 'error'; message: string };

/**
 * CLI・CI（`ubichill login` / `ubichill ci create`）を公開環境として追加する承認画面。
 * 承認すると、その端末・CI はあなたの作者アカウントでワールドを公開できるようになる（鍵はその端末・CI の手元だけ）。
 */
export function CliAuthorizePage() {
    const [params] = useSearchParams();
    const { data: session } = useSession();
    const requestId = params.get('request');
    const codeParam = params.get('code');
    const state = params.get('state');
    const [codeInput, setCodeInput] = useState(codeParam ?? '');
    const [view, setView] = useState<State>(requestId || codeParam ? { status: 'loading' } : { status: 'enter-code' });
    const [busy, setBusy] = useState(false);
    const [confirmedCode, setConfirmedCode] = useState(false);

    const load = useCallback(async (query: { requestId: string } | { userCode: string }) => {
        setView({ status: 'loading' });
        try {
            setView({ status: 'ready', request: await fetchCliAuthRequest(query) });
        } catch (e) {
            setView({ status: 'error', message: e instanceof Error ? e.message : '要求を取得できませんでした' });
        }
    }, []);

    useEffect(() => {
        if (requestId) void load({ requestId });
        else if (codeParam) {
            const code = normalizeUserCode(codeParam);
            if (code) void load({ userCode: code });
            else setView({ status: 'enter-code', error: 'コードの形式が不正です（XXXX-XXXX）' });
        }
    }, [requestId, codeParam, load]);

    const approve = async (request: CliAuthRequestView) => {
        setBusy(true);
        try {
            const { redirect } = await approveCliAuthRequest(request.id, state);
            if (redirect) {
                window.location.assign(redirect);
                return;
            }
            setView({ status: 'done', request });
        } catch (e) {
            setView({ status: 'error', message: e instanceof Error ? e.message : '承認できませんでした' });
        } finally {
            setBusy(false);
        }
    };

    const kindLabel = (kind: string) => (kind === 'ci' ? 'CI（自動公開）' : 'CLI');

    return (
        <div className={page}>
            <div className={card}>
                <h1 className={css({ fontSize: 'xl', fontWeight: '700', color: 'text', mb: '2' })}>
                    公開環境の追加を承認
                </h1>
                {view.status === 'enter-code' && (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            const code = normalizeUserCode(codeInput);
                            if (code) void load({ userCode: code });
                            else setView({ status: 'enter-code', error: 'コードの形式が不正です（XXXX-XXXX）' });
                        }}
                    >
                        <p className={css({ fontSize: '13px', color: 'textMuted', mb: '3', lineHeight: '1.6' })}>
                            CLI に表示されたコードを入力してください。
                        </p>
                        <input
                            value={codeInput}
                            onChange={(e) => setCodeInput(e.target.value.toUpperCase().slice(0, 9))}
                            aria-label="コード"
                            autoCapitalize="characters"
                            spellCheck={false}
                            className={css({
                                w: '100%',
                                px: '3',
                                py: '2',
                                mb: '3',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: '8px',
                                fontSize: '18px',
                                letterSpacing: '0.1em',
                                fontFamily: 'monospace',
                                bg: 'background',
                                color: 'text',
                            })}
                        />
                        {view.error && (
                            <p className={css({ fontSize: '13px', color: 'errorText', mb: '3' })}>{view.error}</p>
                        )}
                        <button type="submit" className={button({ tone: 'primary' })}>
                            次へ
                        </button>
                    </form>
                )}
                {view.status === 'loading' && (
                    <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>
                )}
                {view.status === 'error' && (
                    <>
                        <p className={css({ fontSize: '13px', color: 'errorText', mb: '3' })}>{view.message}</p>
                        <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                            CLI でもう一度 <code>ubichill login</code> を実行してください。
                        </p>
                    </>
                )}
                {view.status === 'ready' && (
                    <>
                        <p className={css({ fontSize: '13px', color: 'textMuted', mb: '3', lineHeight: '1.6' })}>
                            承認すると、この{kindLabel(view.request.kind)}は
                            <strong>{session?.user.name ?? 'あなた'}</strong>
                            の作者アカウントでワールドを公開できるようになります。自分で実行したものでなければ承認しないでください。
                        </p>
                        <div className={css({ mb: '4' })}>
                            <div className={row}>
                                <span className={css({ color: 'textMuted' })}>種類</span>
                                <span>{kindLabel(view.request.kind)}</span>
                            </div>
                            <div className={row}>
                                <span className={css({ color: 'textMuted' })}>名前</span>
                                <span>{view.request.name}</span>
                            </div>
                            <div className={row}>
                                <span className={css({ color: 'textMuted' })}>鍵の指紋</span>
                                <code>{keyFingerprint(view.request.publicKey)}</code>
                            </div>
                            {view.request.redirectHost && (
                                <div className={row}>
                                    <span className={css({ color: 'textMuted' })}>戻り先</span>
                                    <code>{view.request.redirectHost}</code>
                                </div>
                            )}
                        </div>
                        {view.request.flow === 'device' && view.request.userCode && (
                            <label
                                className={css({
                                    display: 'flex',
                                    gap: '2',
                                    alignItems: 'flex-start',
                                    fontSize: '13px',
                                    color: 'text',
                                    mb: '4',
                                    p: '3',
                                    bg: 'surfaceAccent',
                                    borderRadius: '8px',
                                })}
                            >
                                <input
                                    type="checkbox"
                                    checked={confirmedCode}
                                    onChange={(e) => setConfirmedCode(e.target.checked)}
                                />
                                <span>
                                    CLI に表示されているコードが{' '}
                                    <code className={css({ fontWeight: '700' })}>{view.request.userCode}</code>{' '}
                                    と同じことを確かめました（他人から送られたリンクで承認すると、その人があなたの名前で公開できてしまいます）
                                </span>
                            </label>
                        )}
                        <div className={css({ display: 'flex', gap: '2' })}>
                            <button
                                type="button"
                                className={button({ tone: 'primary' })}
                                disabled={busy || (view.request.flow === 'device' && !confirmedCode)}
                                onClick={() => void approve(view.request)}
                            >
                                承認する
                            </button>
                            <Link to="/" className={button({ tone: 'secondary' })}>
                                承認しない
                            </Link>
                        </div>
                    </>
                )}
                {view.status === 'done' && (
                    <p className={css({ fontSize: '14px', color: 'successText', lineHeight: '1.6' })}>
                        承認しました。CLI
                        に戻ってください。追加した公開環境は設定の「公開」（公開できるブラウザ・CLI・CI）で確認・取り消しできます。
                    </p>
                )}
            </div>
        </div>
    );
}
