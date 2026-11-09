import { type ReactNode, useEffect, useRef } from 'react';
import { css, cva } from '@/styled-system/css';
import { HudIcon, type HudIconName } from '../HudIcon';

export interface SplitTabItem<T extends string> {
    id: T;
    label: string;
    icon: HudIconName;
    /** 名前の右に出す数（読み込む前は出さない） */
    count?: number;
    /** ほかの欄と色を変えて目立たせる（一覧ではなく操作の欄。ソーシャルのユーザー検索） */
    accent?: boolean;
}

/**
 * 中で切り替えるタブ（ソーシャル・設定）。広い画面では切り替えを左に縦に、狭い画面では上に横に並べる。
 * 中身だけがスクロールする。オーバーレイの中のクリックで閉じないよう伝播を止める。
 */
export function SplitTab<T extends string>({
    label,
    items,
    current,
    onSelect,
    children,
}: {
    label: string;
    items: ReadonlyArray<SplitTabItem<T>>;
    current: T;
    onSelect: (id: T) => void;
    children: ReactNode;
}) {
    const navRef = useRef<HTMLElement>(null);
    // 狭い画面では横にスクロールするので、外から欄を指定して開いたときも選んだものが見えるようにする
    useEffect(() => {
        if (!current) return;
        navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [current]);
    return (
        <div className={split} onClick={(e) => e.stopPropagation()}>
            <nav ref={navRef} aria-label={label} className={sideNav}>
                {items.map((item) => {
                    const active = item.id === current;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            aria-current={active ? 'page' : undefined}
                            className={navItem({ active, accent: !!item.accent })}
                            onClick={() => onSelect(item.id)}
                        >
                            <HudIcon name={item.icon} size={18} />
                            <span className={navLabel}>{item.label}</span>
                            {item.count !== undefined && <span className={navCount({ active })}>{item.count}</span>}
                        </button>
                    );
                })}
            </nav>
            <div className={content}>{children}</div>
        </div>
    );
}

const split = css({
    h: 'full',
    minH: 0,
    display: 'flex',
    flexDirection: { base: 'column', md: 'row' },
    gap: { base: '3', md: '5' },
});

const sideNav = css({
    flexShrink: 0,
    display: 'flex',
    flexDirection: { base: 'row', md: 'column' },
    gap: '1',
    w: { md: '232px' },
    overflowX: { base: 'auto', md: 'visible' },
    overflowY: { md: 'auto' },
    pr: { md: '4' },
    borderRightWidth: { md: '1px' },
    borderRightStyle: 'solid',
    borderRightColor: 'border',
    scrollbarWidth: 'none',
});

const navItem = cva({
    base: {
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '2.5',
        px: '3',
        py: { base: '2', md: '2.5' },
        border: 'none',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '700',
        textAlign: 'left',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease, color 0.16s ease',
    },
    variants: {
        active: {
            true: { bg: 'primary', color: 'textOnPrimary' },
            false: { bg: 'transparent', color: 'textMuted', _hover: { bg: 'surfaceHover', color: 'text' } },
        },
        accent: { true: {}, false: {} },
    },
    compoundVariants: [
        {
            active: false,
            accent: true,
            css: {
                bg: 'primarySubtle',
                color: 'primary',
                _hover: { bg: 'primarySubtle', color: 'primary', opacity: 0.85 },
            },
        },
    ],
});

const navLabel = css({ flex: 1, minW: 0, overflow: 'hidden', textOverflow: 'ellipsis' });

const navCount = cva({
    base: {
        minW: '22px',
        px: '1.5',
        borderRadius: 'full',
        fontSize: '11px',
        fontWeight: '800',
        lineHeight: '20px',
        textAlign: 'center',
        fontVariantNumeric: 'tabular-nums',
    },
    variants: {
        active: {
            true: { bg: 'background', color: 'primary' },
            false: { bg: 'surface', color: 'textMuted' },
        },
    },
});

const content = css({ flex: 1, minW: 0, minH: 0, overflowY: 'auto', pb: '20px' });
