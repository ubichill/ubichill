import { css } from '@/styled-system/css';
import { WarningIcon } from '../hierarchy/hierarchyIcons';

/** 作者に知らせること（参照の問題・未対応の書き方など）。無ければ何も描かない。 */
export function EditorNotices({ messages }: { messages: readonly string[] }) {
    if (messages.length === 0) return null;
    return (
        <div
            role="status"
            className={css({
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid',
                borderColor: 'warning',
                bg: 'backgroundSubtle',
            })}
        >
            {messages.map((message) => (
                <div
                    key={message}
                    className={css({ display: 'flex', gap: '6px', fontSize: '11px', color: 'text', lineHeight: '1.5' })}
                >
                    <span className={css({ color: 'warning', flexShrink: 0, display: 'inline-flex', pt: '1px' })}>
                        <WarningIcon />
                    </span>
                    <span>{message}</span>
                </div>
            ))}
        </div>
    );
}
