import { css } from '@/styled-system/css';

/** 設定の欄の中の 1 まとまり（見出しと中身）。 */
export const settingsGroup = css({ display: 'flex', flexDirection: 'column', gap: '2' });
export const settingsHeading = css({ fontSize: '13px', fontWeight: '700', color: 'text' });
export const settingsNote = css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.6' });
