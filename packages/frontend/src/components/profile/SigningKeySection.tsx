import { useRef, useState } from 'react';
import { createSigningKey, importSigningKeyBackup, removeSigningKey, useSigningPublicKey } from '@/lib/signing';
import { css, cva } from '@/styled-system/css';

const BACKUP_FILENAME = 'ubichill-signing.key';

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
    },
});

function downloadText(filename: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * 作者署名鍵の管理。鍵はこのブラウザにだけ保存され、サーバーには送らない。
 * 保存したワールドはこの鍵で自動的に署名される。
 */
export function SigningKeySection({ unsignedCount }: { unsignedCount: number }) {
    const publicKey = useSigningPublicKey();
    const fileInput = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

    const run = async (task: () => Promise<string>) => {
        setBusy(true);
        setMessage(null);
        try {
            setMessage({ tone: 'info', text: await task() });
        } catch (e) {
            setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
        } finally {
            setBusy(false);
        }
    };

    const create = () =>
        run(async () => {
            const { backup } = await createSigningKey();
            downloadText(BACKUP_FILENAME, `${backup}\n`);
            return `鍵を作成し ${BACKUP_FILENAME} をダウンロードしました。無くすと別の作者として扱われます。`;
        });

    const importFile = (file: File) =>
        run(async () => {
            await importSigningKeyBackup(await file.text());
            return '鍵を読み込みました。';
        });

    const remove = () => {
        if (!window.confirm('このブラウザから鍵を削除しますか？バックアップファイルが無いと元に戻せません。')) return;
        void run(async () => {
            await removeSigningKey();
            return '鍵を削除しました。';
        });
    };

    if (publicKey === undefined) return null;

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
            <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '1' })}>作者署名の鍵</h2>
            <p className={css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6', mb: '3' })}>
                保存したワールドにこの鍵で署名し、改竄されていないこと・同じ作者であることを他のサーバーでも確認できるようにします。
                鍵はこのブラウザ（このサイト）にだけ保存され、サーバーには送られません。別のサーバーや端末ではバックアップファイルを読み込むと同じ作者として署名できます。
            </p>
            {!publicKey && (
                <p
                    className={css({
                        fontSize: '13px',
                        color: 'errorText',
                        bg: 'errorBg',
                        px: '3',
                        py: '2',
                        borderRadius: '8px',
                        mb: '3',
                    })}
                >
                    このブラウザに鍵がありません。保存したワールドは署名されず、一覧に公開されません。
                    {unsignedCount > 0 && ` 現在 ${unsignedCount} 個のワールドが非公開です。`}
                </p>
            )}
            {publicKey && unsignedCount > 0 && (
                <p className={css({ fontSize: '13px', color: 'textMuted', mb: '3' })}>
                    署名のないワールドが {unsignedCount} 個あります。下の一覧の「署名して公開」で公開できます。
                </p>
            )}
            {publicKey ? (
                <div className={css({ display: 'flex', alignItems: 'center', gap: '3', flexWrap: 'wrap' })}>
                    <code
                        title={publicKey}
                        className={css({
                            fontSize: '12px',
                            color: 'textMuted',
                            bg: 'surfaceAccent',
                            px: '2',
                            py: '1',
                            borderRadius: '6px',
                        })}
                    >
                        {publicKey.slice(0, 16)}…
                    </code>
                    <button type="button" className={button({ tone: 'danger' })} disabled={busy} onClick={remove}>
                        このブラウザから削除
                    </button>
                </div>
            ) : (
                <div className={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}>
                    <button
                        type="button"
                        className={button({ tone: 'primary' })}
                        disabled={busy}
                        onClick={() => void create()}
                    >
                        鍵を作成
                    </button>
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
                </div>
            )}
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
