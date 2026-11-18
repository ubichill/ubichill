import { css } from '@/styled-system/css';

/** 画面全体が描けなくなったときに出す（ルートの ErrorBoundary の代わりの表示）。 */
export function AppCrashFallback() {
    return (
        <div
            role="alert"
            className={css({
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                bg: 'background',
                color: 'text',
            })}
        >
            <p>表示できなくなりました</p>
            <button
                type="button"
                onClick={() => window.location.reload()}
                className={css({
                    padding: '10px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: 'primary',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    _hover: { backgroundColor: 'primaryHover' },
                })}
            >
                読み込み直す
            </button>
        </div>
    );
}
