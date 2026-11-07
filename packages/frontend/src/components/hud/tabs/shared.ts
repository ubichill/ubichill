import { css } from '@/styled-system/css';

export type JoinInstanceHandler = (
    instanceId: string,
    worldId: string,
    worldData?: { thumbnail?: string; displayName?: string },
) => void;

/** 各タブのスクロール領域。オーバーレイ表示時にカード内クリックで閉じないよう伝播を止める。 */
export const tabPanel = css({
    width: 'full',
    maxWidth: '730px',
    mx: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '6',
    h: 'full',
    overflowY: 'auto',
    pb: '20px',
});

/**
 * タブの中の 1 まとまり。ランチパッドの面にそのまま置き、枠では囲まない（ランチパッド自体がパネルなので二重になる）。
 * まとまりの間は細い線で区切る。
 */
export const tabSection = css({
    display: 'flex',
    flexDirection: 'column',
    '& + &': { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'border', pt: '6' },
});

export const sectionHeading = css({
    fontSize: '15px',
    fontWeight: '800',
    mb: '3',
    color: 'text',
    wordBreak: 'auto-phrase',
    overflowWrap: 'anywhere',
});
