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
    px: { base: '2', md: '0' },
    display: 'flex',
    flexDirection: 'column',
    gap: '6',
    h: 'full',
    overflowY: 'auto',
    pb: '20px',
});

export const cardBase = {
    bg: 'surfaceAccent',
    borderRadius: '24px',
    p: { base: '4', md: '6' },
    boxShadow: 'card',
};

export const cardStyle = css(cardBase);

export const sectionHeading = css({ fontSize: 'xl', fontWeight: 'bold', mb: '4', color: 'text' });
