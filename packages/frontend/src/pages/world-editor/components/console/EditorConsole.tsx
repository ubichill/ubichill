import { useEffect, useRef, useState } from 'react';
import { css } from '@/styled-system/css';
import { type ConsoleEntry, formatConsole, formatConsoleTime } from '../../lib/editorConsole';
import { editorButton } from '../../recipes/button';
import { StatusIcon } from '../statusIcons';

/** 下のドックのコンソール。文字はそのまま選んでコピーできる。 */
export function EditorConsole({ entries }: { entries: readonly ConsoleEntry[] }) {
    const listRef = useRef<HTMLDivElement>(null);
    const lastId = entries.at(-1)?.id;
    const lastCount = entries.at(-1)?.count;

    // 新しい行・回数が増えたら一番下を見せる
    useEffect(() => {
        if (lastId === undefined || lastCount === undefined) return;
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, [lastId, lastCount]);

    return (
        <div
            ref={listRef}
            role="log"
            className={css({
                flex: 1,
                minH: 0,
                overflowY: 'auto',
                fontFamily: 'mono',
                fontSize: '11px',
                lineHeight: '1.5',
                userSelect: 'text',
                bg: 'background',
            })}
        >
            {entries.length === 0 ? (
                <p className={css({ padding: '12px', color: 'textSubtle', textAlign: 'center' })}>
                    エラーや警告はありません
                </p>
            ) : (
                entries.map((entry) => <ConsoleRow key={entry.id} entry={entry} />)
            )}
        </div>
    );
}

/** コンソールのまとめてコピー・クリア。下のドックのタブの右に置く。 */
export function ConsoleActions({ entries, onClear }: { entries: readonly ConsoleEntry[]; onClear: () => void }) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
    }, [copied]);

    const copyAll = () => {
        void navigator.clipboard.writeText(formatConsole(entries)).then(() => setCopied(true));
    };

    return (
        <>
            <button
                type="button"
                onClick={copyAll}
                disabled={entries.length === 0}
                className={editorButton({ intent: 'secondary', size: 'sm' })}
            >
                {copied ? 'コピーしました' : 'すべてコピー'}
            </button>
            <button
                type="button"
                onClick={onClear}
                disabled={entries.length === 0}
                className={editorButton({ intent: 'secondary', size: 'sm' })}
            >
                クリア
            </button>
        </>
    );
}

function ConsoleRow({ entry }: { entry: ConsoleEntry }) {
    return (
        <div
            className={css({
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-start',
                padding: '4px 12px',
                borderBottom: '1px solid',
                borderColor: 'border',
                bg: entry.level === 'error' ? 'errorSubtle' : 'transparent',
            })}
        >
            <StatusIcon level={entry.level} />
            <span className={css({ color: 'textSubtle', flexShrink: 0 })}>{formatConsoleTime(entry.at)}</span>
            <span className={css({ color: 'textMuted', flexShrink: 0 })}>{entry.source}</span>
            <span className={css({ color: 'text', flex: 1, minW: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' })}>
                {entry.message}
            </span>
            {entry.count > 1 && <span className={css({ flexShrink: 0, color: 'textMuted' })}>x{entry.count}</span>}
        </div>
    );
}
