import type { ComponentInstance } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { entityScripts, hasUiButton, uiButtonLabel } from './entityButton';

const part = (entityId: string, index: number, type: string, data: Record<string, unknown>) =>
    ({ id: `${entityId}::${index}`, entityId, type, data }) as Pick<
        ComponentInstance,
        'id' | 'type' | 'data' | 'entityId'
    >;

describe('hasUiButton', () => {
    it('同じ Entity にボタンにした UI があるときだけ true', () => {
        const parts = [
            part('door', 0, 'core:ui', { text: '扉', button: true }),
            part('door', 1, 'core:warp', { target: 'back' }),
            part('sign', 0, 'core:ui', { text: '案内' }),
            part('sign', 1, 'core:warp', { target: 'back' }),
        ];
        expect(hasUiButton(parts, 'door')).toBe(true);
        // ボタンにしていない UI（看板）は、ワープの標準のボタンを消さない
        expect(hasUiButton(parts, 'sign')).toBe(false);
        // ほかの Entity のボタンは数えない
        expect(hasUiButton(parts, 'back')).toBe(false);
    });

    it('UI の設定が読めない・ボタンが真偽値でないときはボタンとみなさない（スクリプトが押せなくならない）', () => {
        expect(hasUiButton([part('door', 0, 'core:ui', { button: 'yes' })], 'door')).toBe(false);
        expect(hasUiButton([part('door', 0, 'core:ui', { radius: -5, button: true })], 'door')).toBe(false);
        // mod の部品が button を持っていても関係ない
        expect(hasUiButton([part('door', 0, 'pen:pen', { button: true })], 'door')).toBe(false);
    });
});

describe('entityScripts', () => {
    it('その Entity のワープ・スイッチ・ポータルを並び順で返し、ほかの部品と読めない設定は入れない', () => {
        const parts = [
            part('door', 0, 'core:ui', { button: true }),
            part('door', 1, 'core:switch', { targets: ['lamp'], label: ' 明かり ' }),
            part('door', 2, 'core:warp', { target: 'Bad ID' }),
            part('door', 3, 'core:portal', { world: '@alice/cafe' }),
            part('other', 0, 'core:warp', { target: 'back' }),
        ];
        expect(entityScripts(parts, 'door')).toEqual([
            { kind: 'switch', id: 'door::1', label: '明かり', ready: true },
            {
                kind: 'portal',
                id: 'door::3',
                label: '',
                target: { kind: 'share', path: '@alice/cafe' },
            },
        ]);
    });

    it('対象の無いスイッチ・行き先の無いポータルは動かせないものとして返す', () => {
        const [sw, portal] = entityScripts([part('d', 0, 'core:switch', {}), part('d', 1, 'core:portal', {})], 'd');
        expect(sw).toMatchObject({ kind: 'switch', ready: false });
        expect(portal).toMatchObject({ kind: 'portal', target: null });
    });
});

describe('uiButtonLabel', () => {
    it('UI のテキスト（改行や空白はまとめる）、無ければスクリプトの名前を並べ、どちらも無ければ「ボタン」', () => {
        expect(uiButtonLabel(' 奥へ\n行く ', [])).toBe('奥へ 行く');
        expect(
            uiButtonLabel('', [
                { kind: 'warp', id: 'a', label: '奥へ', target: 'back' },
                { kind: 'switch', id: 'b', label: '', ready: true },
                { kind: 'switch', id: 'c', label: '明かり', ready: true },
            ]),
        ).toBe('奥へ・明かり');
        expect(uiButtonLabel('  ', [])).toBe('ボタン');
    });
});
