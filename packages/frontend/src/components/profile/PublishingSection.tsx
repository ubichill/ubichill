import { displayAuthorAccount } from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import {
    fetchPublishingEnvironments,
    type MyAccount,
    type PublishingEnvironment,
    registerSigningKey,
    revokePublishingEnvironment,
    setMyHandle,
} from '@/lib/account/me';
import { isStaleEnvironment, revokeConfirmMessage, sortEnvironments } from '@/lib/account/publishingEnvironments';
import { useHandleAvailability } from '@/lib/account/useHandleAvailability';
import { importSigningKeyFile, loadSigningKey, useSigningPublicKey } from '@/lib/signing';
import { css, cva } from '@/styled-system/css';

const button = cva({
    base: {
        padding: '8px 14px',
        border: '1px solid',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '600',
        cursor: 'pointer',
        _disabled: { opacity: 0.4, cursor: 'not-allowed' },
    },
    variants: {
        tone: {
            primary: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary', _hover: { opacity: 0.9 } },
            secondary: { bg: 'surface', color: 'text', borderColor: 'border', _hover: { bg: 'surfaceHover' } },
            danger: { bg: 'surface', color: 'errorText', borderColor: 'border', _hover: { bg: 'errorBg' } },
        },
        size: { sm: { padding: '4px 10px', fontSize: '12px' } },
    },
});

const notice = cva({
    base: { fontSize: '13px', px: '3', py: '2', borderRadius: '8px', mb: '3', lineHeight: '1.6' },
    variants: {
        tone: {
            warn: { color: 'errorText', bg: 'errorBg' },
            info: { color: 'textMuted', bg: 'surfaceAccent' },
        },
    },
});

const tag = cva({
    base: { fontSize: '11px', fontWeight: '600', px: '2', py: '0.5', borderRadius: '999px' },
    variants: {
        tone: {
            current: { bg: 'successBg', color: 'successText' },
            stale: { bg: 'errorBg', color: 'errorText' },
            revoked: { bg: 'surfaceAccent', color: 'textMuted' },
        },
    },
});

const row = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' });

const KIND_LABEL: Record<PublishingEnvironment['kind'], string> = {
    browser: 'ブラウザ',
    cli: 'CLI',
    ci: 'CI',
    legacy: '以前の鍵',
};

function KindIcon({ kind }: { kind: PublishingEnvironment['kind'] }) {
    const common = {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        'aria-hidden': true,
    };
    if (kind === 'browser') {
        return (
            <svg {...common}>
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18" />
            </svg>
        );
    }
    if (kind === 'cli') {
        return (
            <svg {...common}>
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M7 10l3 2-3 2M12 15h5" />
            </svg>
        );
    }
    if (kind === 'ci') {
        return (
            <svg {...common}>
                <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                <path d="M20 4v4h-4" />
            </svg>
        );
    }
    return (
        <svg {...common}>
            <circle cx="8" cy="15" r="4" />
            <path d="M11 12l9-9M17 6l3 3" />
        </svg>
    );
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('ja-JP');

interface PublishingSectionProps {
    account: MyAccount;
    onAccountChange: (next: MyAccount) => void;
    unsignedCount: number;
    /** ワールドの公開などで公開環境が増えたときに一覧を取り直すためのキー */
    refreshKey: number;
}

/**
 * 公開の設定。作者アカウントの ID と、公開できるブラウザ・CLI・CI（公開環境）の一覧と取り消し。
 * 鍵は公開するときに自動で用意・登録されるので、ここで鍵を作らせない。
 */
export function PublishingSection({ account, onAccountChange, unsignedCount, refreshKey }: PublishingSectionProps) {
    const localKey = useSigningPublicKey();
    const confirm = useConfirm();
    const fileInput = useRef<HTMLInputElement>(null);
    const [environments, setEnvironments] = useState<PublishingEnvironment[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
    const [handleInput, setHandleInput] = useState('');
    const handleStatus = useHandleAvailability(handleInput, !account.handle);

    const reload = useCallback(async () => {
        const list = await fetchPublishingEnvironments();
        setEnvironments(list);
        return list;
    }, []);

    useEffect(() => {
        void refreshKey;
        reload().catch((e: unknown) =>
            setMessage({ tone: 'error', text: e instanceof Error ? e.message : '公開環境を取得できませんでした' }),
        );
    }, [reload, refreshKey]);

    const run = async (task: () => Promise<string | null>) => {
        setBusy(true);
        setMessage(null);
        try {
            const text = await task();
            if (text) setMessage({ tone: 'info', text });
        } catch (e) {
            setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
        } finally {
            setBusy(false);
        }
    };

    const syncAccountKeys = (list: readonly PublishingEnvironment[]) =>
        onAccountChange({ ...account, signingKeys: list.filter((e) => !e.revokedAt).map((e) => e.publicKey) });

    const saveHandle = () =>
        run(async () => {
            const ok = await confirm(
                `ID を「${handleInput.trim()}」にします。あとから変更できません。よろしいですか？`,
            );
            if (!ok) return null;
            const result = await setMyHandle(handleInput.trim());
            onAccountChange({ ...account, handle: result.handle, author: result.author });
            return 'ID を設定しました。';
        });

    const revoke = async (env: PublishingEnvironment) => {
        if (!(await confirm(revokeConfirmMessage(env, env.publicKey === localKey)))) return;
        await run(async () => {
            await revokePublishingEnvironment(env.id);
            syncAccountKeys(await reload());
            return `「${env.name}」を取り消しました。`;
        });
    };

    const importFile = (file: File) =>
        run(async () => {
            if (
                localKey &&
                !(await confirm('このブラウザの鍵を、読み込むファイルの鍵に置き換えます。よろしいですか？'))
            ) {
                return null;
            }
            await importSigningKeyFile((await file.text()).trim());
            const key = await loadSigningKey();
            if (!key) throw new Error('鍵を読み込めませんでした');
            if ((await registerSigningKey(account.id, key)) === 'revoked') {
                throw new Error('この鍵は取り消し済みのため使えません');
            }
            syncAccountKeys(await reload());
            return '鍵を読み込み、このブラウザを公開環境として登録しました。';
        });

    const now = Date.now();
    const sorted = environments ? sortEnvironments(environments) : [];

    return (
        <section
            className={css({
                mb: '6',
                p: '4',
                bg: 'surface',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '12px',
            })}
        >
            <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '1' })}>公開</h2>
            <p className={css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6', mb: '3' })}>
                公開するワールドには作者アカウントで署名し、改竄されていないこと・あなたが作ったことをほかのサーバーでも確認できるようにします。
                ログインしたブラウザで「公開する」を押すと、そのブラウザが公開環境として自動で登録されます。
            </p>

            {account.author ? (
                <p className={css({ fontSize: '14px', color: 'text', mb: '3' })}>
                    作者アカウント: <strong>{displayAuthorAccount(account.author)}</strong>
                </p>
            ) : (
                <div className={css({ mb: '4' })}>
                    <p className={notice({ tone: 'warn' })}>
                        ID が未設定です。公開するには ID（英小文字・数字・_ の 3〜30 文字、変更不可）を決めてください。
                    </p>
                    <div className={row}>
                        <input
                            value={handleInput}
                            onChange={(e) => setHandleInput(e.target.value.toLowerCase().slice(0, 30))}
                            placeholder="youkan"
                            aria-label="ID"
                            autoCapitalize="none"
                            spellCheck={false}
                            className={css({
                                px: '3',
                                py: '2',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: '8px',
                                fontSize: '14px',
                                bg: 'background',
                                color: 'text',
                            })}
                        />
                        <button
                            type="button"
                            className={button({ tone: 'primary' })}
                            disabled={busy || handleStatus.state !== 'available'}
                            onClick={() => void saveHandle()}
                        >
                            ID を設定
                        </button>
                    </div>
                    {'error' in handleStatus && (
                        <p className={css({ mt: '1', fontSize: '12px', color: 'errorText' })}>{handleStatus.error}</p>
                    )}
                </div>
            )}

            {unsignedCount > 0 && (
                <p className={notice({ tone: 'info' })}>
                    作者アカウントで署名されていないワールドが {unsignedCount}
                    個あり、一覧に出ていません。下の一覧の「署名して公開」で公開できます。
                </p>
            )}

            <h3 className={css({ fontSize: '14px', fontWeight: '700', color: 'text', mt: '4', mb: '2' })}>
                公開できるブラウザ・CLI・CI
            </h3>
            {environments === null ? (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>
            ) : sorted.length === 0 ? (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                    まだありません。ワールドを公開すると、このブラウザが追加されます。
                </p>
            ) : (
                <ul className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                    {sorted.map((env) => {
                        const isThisBrowser = env.publicKey === localKey;
                        const stale = isStaleEnvironment(env, now);
                        return (
                            <li
                                key={env.id}
                                className={css({
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3',
                                    px: '3',
                                    py: '2',
                                    border: '1px solid',
                                    borderColor: stale ? 'error' : 'border',
                                    borderRadius: '8px',
                                    bg: 'background',
                                    opacity: env.revokedAt ? 0.6 : 1,
                                })}
                            >
                                <span
                                    className={css({ color: 'textMuted', display: 'flex' })}
                                    title={KIND_LABEL[env.kind]}
                                >
                                    <KindIcon kind={env.kind} />
                                </span>
                                <div className={css({ flex: 1, minWidth: 0 })}>
                                    <div className={row}>
                                        <span className={css({ fontSize: '14px', color: 'text', fontWeight: '600' })}>
                                            {env.name}
                                        </span>
                                        {isThisBrowser && !env.revokedAt && (
                                            <span className={tag({ tone: 'current' })}>このブラウザ</span>
                                        )}
                                        {stale && <span className={tag({ tone: 'stale' })}>長く使われていません</span>}
                                        {env.revokedAt && (
                                            <span className={tag({ tone: 'revoked' })}>取り消し済み</span>
                                        )}
                                    </div>
                                    <p className={css({ fontSize: '12px', color: 'textMuted', mt: '0.5' })}>
                                        {KIND_LABEL[env.kind]} ・ 追加 {formatDate(env.createdAt)} ・{' '}
                                        {env.lastUsedAt ? `最終利用 ${formatDate(env.lastUsedAt)}` : '未使用'}
                                        {env.revokedAt && ` ・ 取り消し ${formatDate(env.revokedAt)}`}
                                    </p>
                                </div>
                                {!env.revokedAt && (
                                    <button
                                        type="button"
                                        className={button({ tone: 'danger', size: 'sm' })}
                                        disabled={busy}
                                        onClick={() => void revoke(env)}
                                    >
                                        取り消す
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <details className={css({ mt: '4', fontSize: '13px', color: 'textMuted' })}>
                <summary className={css({ cursor: 'pointer' })}>上級者向け: CLI の鍵ファイルを読み込む</summary>
                <p className={css({ mt: '2', mb: '2', lineHeight: '1.6' })}>
                    <code>ubichill keygen</code> で作った鍵ファイルを読み込み、このブラウザの公開環境として登録します。
                </p>
                <button
                    type="button"
                    className={button({ tone: 'secondary' })}
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                >
                    鍵ファイルを読み込む
                </button>
                <input
                    ref={fileInput}
                    type="file"
                    accept=".key,text/plain"
                    className={css({ display: 'none' })}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void importFile(file);
                    }}
                />
            </details>

            {message && (
                <p
                    className={css({
                        mt: '3',
                        fontSize: '13px',
                        color: message.tone === 'error' ? 'errorText' : 'textMuted',
                    })}
                >
                    {message.text}
                </p>
            )}
        </section>
    );
}
