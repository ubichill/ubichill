import { useEffect, useMemo, useRef, useState } from 'react';
import {
    CONSOLE_LEVELS,
    type ConsoleEntry,
    type ConsoleLevel,
    type ConsoleView,
    consoleCounts,
    DEFAULT_CONSOLE_VIEW,
    formatConsole,
    formatConsoleCount,
    formatConsoleEntry,
    formatConsoleTime,
    visibleConsole,
} from '@/lib/console/console';
import { css, cva } from '@/styled-system/css';
import { ConsoleLevelIcon } from './ConsoleLevelIcon';

const LEVEL_NAME: Record<ConsoleLevel, string> = { error: 'エラー', warning: '警告', info: '情報' };

/**
 * Unity の Console を手本にしたコンソール。上のツールバーで種類ごとに出す・隠す（件数つき）、同じ内容をまとめる、検索する。
 * 行を選ぶと、横（スマホは下）に詳細と操作（再試行・許可）を出す。
 * 一番下を見ている間は新しい行に付いていき、上へ戻して読んでいる間は動かさない。
 */
export function ConsolePanel({ entries, onClear }: { entries: readonly ConsoleEntry[]; onClear: () => void }) {
    const [view, setView] = useState<ConsoleView>(DEFAULT_CONSOLE_VIEW);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const rows = useMemo(() => visibleConsole(entries, view), [entries, view]);
    const counts = useMemo(() => consoleCounts(entries), [entries]);
    const selected = rows.find((entry) => entry.id === selectedId) ?? null;

    const listRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);
    const last = rows.at(-1);
    // biome-ignore lint/correctness/useExhaustiveDependencies: 最後の行が増えた・回数が増えたときだけ追う
    useEffect(() => {
        const list = listRef.current;
        if (list && followRef.current) list.scrollTop = list.scrollHeight;
    }, [last?.id, last?.count, rows.length]);

    const toggleLevel = (level: ConsoleLevel) =>
        setView((v) => ({ ...v, levels: { ...v.levels, [level]: !v.levels[level] } }));

    return (
        <div className={panel}>
            <div role="toolbar" aria-label="コンソールの操作" className={toolbar}>
                <button type="button" className={tool()} onClick={onClear} disabled={entries.length === 0}>
                    クリア
                </button>
                <button
                    type="button"
                    className={tool(view.collapse ? { on: true } : {})}
                    aria-pressed={view.collapse}
                    onClick={() => setView((v) => ({ ...v, collapse: !v.collapse }))}
                >
                    まとめる
                </button>
                <input
                    type="search"
                    value={view.query}
                    onChange={(e) => setView((v) => ({ ...v, query: e.target.value }))}
                    placeholder="検索"
                    aria-label="コンソールを検索"
                    className={search}
                />
                <div className={levelGroup}>
                    {CONSOLE_LEVELS.map((level) => (
                        <button
                            key={level}
                            type="button"
                            className={tool({ on: view.levels[level] })}
                            aria-pressed={view.levels[level]}
                            aria-label={`${LEVEL_NAME[level]} ${counts[level]} 件を表示`}
                            onClick={() => toggleLevel(level)}
                        >
                            <ConsoleLevelIcon level={level} />
                            {formatConsoleCount(counts[level])}
                        </button>
                    ))}
                </div>
                <CopyButton text={formatConsole(rows)} disabled={rows.length === 0} label="表示中の記録をコピー" />
            </div>
            <div className={body}>
                <div
                    ref={listRef}
                    role="log"
                    aria-label="コンソール"
                    className={list}
                    onScroll={(e) => {
                        const el = e.currentTarget;
                        followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
                    }}
                >
                    {rows.length === 0 ? (
                        <p className={empty}>
                            {entries.length === 0 ? 'エラーや警告はありません' : '条件に合う記録はありません'}
                        </p>
                    ) : (
                        rows.map((entry) => (
                            <ConsoleRow
                                key={entry.id}
                                entry={entry}
                                selected={entry.id === selected?.id}
                                onSelect={() => setSelectedId(entry.id === selected?.id ? null : entry.id)}
                            />
                        ))
                    )}
                </div>
                {selected && <ConsoleDetail entry={selected} onClose={() => setSelectedId(null)} />}
            </div>
        </div>
    );
}

function ConsoleRow({ entry, selected, onSelect }: { entry: ConsoleEntry; selected: boolean; onSelect: () => void }) {
    return (
        <button type="button" aria-pressed={selected} onClick={onSelect} className={row({ level: entry.level })}>
            <ConsoleLevelIcon level={entry.level} className={rowIcon} />
            <span className={rowText}>
                <span className={rowMessage}>{entry.message}</span>
                <span className={rowMeta}>
                    {formatConsoleTime(entry.at)} · {entry.source}
                </span>
            </span>
            {entry.count > 1 && <span className={countBadge}>{formatConsoleCount(entry.count)}</span>}
        </button>
    );
}

function ConsoleDetail({ entry, onClose }: { entry: ConsoleEntry; onClose: () => void }) {
    return (
        <section aria-label="選んだ記録の詳細" className={detail}>
            <div className={detailHead}>
                <ConsoleLevelIcon level={entry.level} />
                <span className={css({ fontWeight: '700', color: 'text', minW: 0, overflowWrap: 'anywhere' })}>
                    {entry.source}
                </span>
                <span className={css({ color: 'textSubtle', flexShrink: 0 })}>
                    {formatConsoleTime(entry.at)}
                    {entry.count > 1 && ` · ${entry.count} 回`}
                </span>
                <button type="button" aria-label="詳細を閉じる" className={closeButton} onClick={onClose}>
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        aria-hidden="true"
                    >
                        <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>
            <p className={detailMessage}>{entry.message}</p>
            {entry.detail && <p className={detailText}>{entry.detail}</p>}
            <div className={css({ display: 'flex', gap: '6px', flexWrap: 'wrap', mt: 'auto' })}>
                {entry.action && (
                    <button type="button" className={tool({ intent: 'primary' })} onClick={entry.action.run}>
                        {entry.action.label}
                    </button>
                )}
                <CopyButton text={formatConsoleEntry(entry)} label="この記録をコピー" />
            </div>
        </section>
    );
}

function CopyButton({ text, label, disabled }: { text: string; label: string; disabled?: boolean }) {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
    }, [copied]);
    return (
        <button
            type="button"
            className={tool()}
            aria-label={label}
            disabled={disabled}
            onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
        >
            <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                {copied ? (
                    <path d="M20 6 9 17l-5-5" />
                ) : (
                    <>
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </>
                )}
            </svg>
            <span className={css({ display: { base: 'none', md: 'inline' } })}>
                {copied ? 'コピーしました' : 'コピー'}
            </span>
        </button>
    );
}

const panel = css({
    flex: 1,
    minH: 0,
    display: 'flex',
    flexDirection: 'column',
    bg: 'background',
    fontSize: '12px',
});

const toolbar = css({
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    px: '6px',
    py: '4px',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'border',
    bg: 'surface',
    flexShrink: 0,
});

const tool = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        flexShrink: 0,
        h: '26px',
        px: '8px',
        borderRadius: '6px',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'transparent',
        bg: 'transparent',
        color: 'textMuted',
        fontSize: '12px',
        fontWeight: '600',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        _hover: { bg: 'surfaceHover', color: 'text' },
        _disabled: { opacity: 0.5, cursor: 'not-allowed', _hover: { bg: 'transparent', color: 'textMuted' } },
        _focusVisible: { outline: '2px solid', outlineColor: 'primary', outlineOffset: '1px' },
    },
    variants: {
        on: {
            true: { bg: 'surfaceAccent', borderColor: 'border', color: 'text' },
            false: { opacity: 0.55 },
        },
        intent: {
            primary: {
                bg: 'primary',
                borderColor: 'primary',
                color: 'textOnPrimary',
                _hover: { bg: 'primaryHover', color: 'textOnPrimary' },
            },
        },
    },
});

const search = css({
    flex: 1,
    minW: '64px',
    maxW: '240px',
    h: '26px',
    px: '8px',
    borderRadius: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'border',
    bg: 'background',
    color: 'text',
    fontSize: '12px',
    _focusVisible: { outline: '2px solid', outlineColor: 'primary', outlineOffset: '-1px' },
});

const levelGroup = css({ display: 'flex', gap: '2px', ml: 'auto' });

const body = css({
    flex: 1,
    minH: 0,
    display: 'flex',
    flexDirection: { base: 'column', md: 'row' },
});

const list = css({ flex: 1, minH: 0, minW: 0, overflowY: 'auto' });

const empty = css({ p: '12px', color: 'textSubtle', textAlign: 'center' });

const row = cva({
    base: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        w: 'full',
        minH: '32px',
        px: '10px',
        py: '4px',
        textAlign: 'left',
        border: 'none',
        borderBottomWidth: '1px',
        borderBottomStyle: 'solid',
        borderBottomColor: 'border',
        bg: 'transparent',
        color: 'text',
        cursor: 'pointer',
        _hover: { bg: 'surfaceHover' },
        _pressed: { bg: 'primarySubtle', _hover: { bg: 'primarySubtle' } },
        _focusVisible: { outline: '2px solid', outlineColor: 'primary', outlineOffset: '-2px' },
    },
    variants: {
        level: {
            error: { bg: 'errorSubtle' },
            warning: {},
            info: {},
        },
    },
});

const rowIcon = css({ mt: '2px' });

const rowText = css({ flex: 1, minW: 0, display: 'flex', flexDirection: 'column', gap: '1px' });

const rowMessage = css({ lineClamp: 2, overflowWrap: 'anywhere', lineHeight: '1.45' });

const rowMeta = css({ color: 'textSubtle', fontSize: '11px', fontVariantNumeric: 'tabular-nums' });

const countBadge = css({
    flexShrink: 0,
    alignSelf: 'center',
    minW: '20px',
    px: '6px',
    borderRadius: 'full',
    bg: 'chipBg',
    color: 'textMuted',
    fontSize: '11px',
    fontWeight: '700',
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
});

const detail = css({
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    w: { base: 'full', md: '40%' },
    maxW: { md: '420px' },
    maxH: { base: '50%', md: 'none' },
    p: '8px 10px',
    overflowY: 'auto',
    borderTopWidth: { base: '1px', md: '0' },
    borderLeftWidth: { base: '0', md: '1px' },
    borderStyle: 'solid',
    borderColor: 'border',
    bg: 'surface',
});

const detailHead = css({ display: 'flex', alignItems: 'center', gap: '6px' });

const closeButton = css({
    ml: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '24px',
    h: '24px',
    flexShrink: 0,
    border: 'none',
    borderRadius: '6px',
    bg: 'transparent',
    color: 'textMuted',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover', color: 'text' },
    _focusVisible: { outline: '2px solid', outlineColor: 'primary' },
});

const detailMessage = css({
    color: 'text',
    lineHeight: '1.55',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
});

const detailText = css({
    color: 'textMuted',
    fontFamily: 'mono',
    fontSize: '11px',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
});
