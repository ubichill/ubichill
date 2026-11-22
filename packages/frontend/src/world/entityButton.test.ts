import type { ComponentInstance } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    type EntityScript,
    entityScripts,
    hasUiButton,
    idleButtonScripts,
    planButtonPress,
    uiButtonLabel,
} from './entityButton';

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

const warp = (id: string): EntityScript => ({ kind: 'warp', id, label: '', target: 'back' });
const sw = (id: string): EntityScript => ({ kind: 'switch', id, label: '', ready: true });
const portal = (id: string): EntityScript => ({
    kind: 'portal',
    id,
    label: '',
    target: { kind: 'share', path: `@alice/${id}` },
});
const ids = (scripts: readonly EntityScript[]) => scripts.map((script) => script.id);

describe('planButtonPress', () => {
    it('ポータルが 2 つあっても、動くのは並びの最初の 1 つだけ', () => {
        expect(ids(planButtonPress([portal('cafe'), portal('library')]))).toEqual(['cafe']);
    });

    it('ポータルがワープより前に並んでいても、ワープを先に動かしてポータルを最後にする', () => {
        expect(ids(planButtonPress([portal('cafe'), warp('w1'), portal('library'), sw('s1')]))).toEqual([
            'w1',
            's1',
            'cafe',
        ]);
    });

    it('部屋の中で済むものだけなら、並び順のまま全部動かす（同じ種類が続いても減らさない）', () => {
        expect(ids(planButtonPress([sw('s1'), sw('s2'), warp('w1'), sw('s3')]))).toEqual(['s1', 's2', 'w1', 's3']);
    });

    it('スクリプトが無ければ何も動かさない', () => {
        expect(planButtonPress([])).toEqual([]);
    });

    it('行き先が読めないポータルでも最初の 1 つとして数える（押せない 1 つ目の代わりに 2 つ目へ移らない）', () => {
        const broken: EntityScript = { kind: 'portal', id: 'broken', label: '', target: null };
        expect(ids(planButtonPress([broken, portal('cafe')]))).toEqual(['broken']);
    });

    it('渡した並びを書き換えない', () => {
        const scripts = [portal('cafe'), warp('w1')];
        planButtonPress(scripts);
        expect(ids(scripts)).toEqual(['cafe', 'w1']);
    });

    it('知らない部品（この版より新しい本体の部品・mod）は間に挟まっても数えず、並びも崩さない', () => {
        const parts = [
            part('door', 0, 'core:ui', { button: true }),
            part('door', 1, 'core:portal', { world: '@alice/cafe' }),
            part('door', 2, 'core:teleport', { world: '@alice/elsewhere' }),
            part('door', 3, 'pen:pen', { kind: 'portal' }),
            part('door', 4, 'core:warp', { target: 'back' }),
            part('door', 5, 'core:portal', { world: '@alice/library' }),
        ];
        expect(ids(planButtonPress(entityScripts(parts, 'door')))).toEqual(['door::4', 'door::1']);
    });
});

describe('idleButtonScripts', () => {
    it('ボタンにした UI がある Entity の、2 つ目からのポータルを挙げる', () => {
        const parts = [
            part('door', 0, 'core:ui', { button: true }),
            part('door', 1, 'core:portal', { world: '@alice/cafe' }),
            part('door', 2, 'core:switch', { targets: ['lamp'] }),
            part('door', 3, 'core:portal', { world: '@alice/library' }),
            part('door', 4, 'core:portal', {}),
        ];
        expect(idleButtonScripts(parts, 'door')).toEqual(['door::3', 'door::4']);
    });

    it('ボタンにした UI が無ければ、ポータルはそれぞれ自分のボタンを出すので挙げない', () => {
        const parts = [
            part('door', 0, 'core:ui', { text: '看板' }),
            part('door', 1, 'core:portal', { world: '@alice/cafe' }),
            part('door', 2, 'core:portal', { world: '@alice/library' }),
        ];
        expect(idleButtonScripts(parts, 'door')).toEqual([]);
    });

    it('ほかの Entity のポータルは数えない', () => {
        const parts = [
            part('door', 0, 'core:ui', { button: true }),
            part('door', 1, 'core:portal', { world: '@alice/cafe' }),
            part('gate', 0, 'core:portal', { world: '@alice/library' }),
        ];
        expect(idleButtonScripts(parts, 'door')).toEqual([]);
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
