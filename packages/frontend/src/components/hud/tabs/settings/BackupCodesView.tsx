import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { settingsNote, settingsOutlineButton } from './settingsStyles';

/** バックアップコードを見せる（この 1 回だけ。コピーかファイルで保存してもらう）。 */
export function BackupCodesView({ codes }: { codes: readonly string[] }) {
    const text = codes.join('\n');

    const copy = () => {
        navigator.clipboard
            .writeText(text)
            .then(() => pushToast('バックアップコードをコピーしました', 'info'))
            .catch(() => pushToast('コピーできませんでした。ファイルに保存してください', 'error'));
    };

    const save = () => {
        const url = URL.createObjectURL(
            new Blob([`Ubichill のバックアップコード\n\n${text}\n`], { type: 'text/plain' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = 'ubichill-backup-codes.txt';
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <p className={settingsNote}>
                認証アプリを使えなくなったときに、1 つずつ代わりに使えます。この画面を閉じると二度と表示しないので、
                パスワードマネージャーなど安全な場所に保存してください。
            </p>
            <ul className={grid} aria-label="バックアップコード">
                {codes.map((code) => (
                    <li key={code} className={codeStyle}>
                        {code}
                    </li>
                ))}
            </ul>
            <div className={css({ display: 'flex', gap: '2' })}>
                <button type="button" className={settingsOutlineButton} onClick={copy}>
                    コピー
                </button>
                <button type="button" className={settingsOutlineButton} onClick={save}>
                    ファイルに保存
                </button>
            </div>
        </div>
    );
}

const grid = css({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '2',
    p: '3',
    bg: 'background',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
});

const codeStyle = css({
    fontFamily: 'mono',
    fontSize: '14px',
    color: 'text',
    textAlign: 'center',
    letterSpacing: '0.05em',
});
