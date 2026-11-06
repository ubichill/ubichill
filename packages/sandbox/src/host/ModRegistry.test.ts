import type { ResolvedRef } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { type EmitCandidate, selectEmitTargets } from './ModRegistry';

const worker = (
    componentInstanceId: string,
    entityId: string,
    componentType: string,
    options: { parent?: string; refs?: ResolvedRef[] } = {},
): EmitCandidate => ({
    componentInstanceId,
    entityId,
    parentEntityId: options.parent,
    componentType,
    refs: () => options.refs ?? [],
});

const ids = (workers: readonly EmitCandidate[]) => workers.map((w) => w.componentInstanceId);

describe('selectEmitTargets: ref', () => {
    // controls が screen と playlist を参照する。screen は別の木の奥、playlist は controls と同じ Entity。
    const controls = worker('controls', 'player', 'vp:controls', {
        refs: [
            { field: 'screen', entityIds: ['tv'], component: 'vp:screen' },
            { field: 'playlist', entityIds: ['player'], component: 'vp:playlist' },
            { field: 'anything', entityIds: ['tv'] },
            { field: 'empty', entityIds: [] },
        ],
    });
    const screen = worker('screen', 'tv', 'vp:screen', { parent: 'room' });
    const tvLabel = worker('label', 'tv', 'm:label', { parent: 'room' });
    const playlist = worker('playlist', 'player', 'vp:playlist');
    const otherScreen = worker('screen-2', 'tv-2', 'vp:screen');
    const all = [controls, screen, tvLabel, playlist, otherScreen];

    it('参照先の Entity の、宣言した型の Component にだけ届く（階層の形は問わない）', () => {
        expect(ids(selectEmitTargets(controls, all, { ref: 'screen' }, undefined))).toEqual(['screen']);
    });

    it('同じ Entity を指す参照も届く（自分自身には届かない）', () => {
        expect(ids(selectEmitTargets(controls, all, { ref: 'playlist' }, undefined))).toEqual(['playlist']);
    });

    it('型を宣言しない参照は参照先の全 Component に届き、targetType で絞れる', () => {
        expect(ids(selectEmitTargets(controls, all, { ref: 'anything' }, undefined))).toEqual(['screen', 'label']);
        expect(ids(selectEmitTargets(controls, all, { ref: 'anything' }, 'm:label'))).toEqual(['label']);
    });

    it('宣言した型と targetType が食い違えば誰にも届かない（targetType で参照の型を広げられない）', () => {
        expect(selectEmitTargets(controls, all, { ref: 'screen' }, 'm:label')).toEqual([]);
    });

    it('未設定・宣言の無いフィールド・登録されていない送り手には誰にも届かない', () => {
        expect(selectEmitTargets(controls, all, { ref: 'empty' }, undefined)).toEqual([]);
        expect(selectEmitTargets(controls, all, { ref: 'nope' }, undefined)).toEqual([]);
        expect(selectEmitTargets(controls, all, { ref: '__proto__' }, undefined)).toEqual([]);
        expect(selectEmitTargets(undefined, all, { ref: 'screen' }, undefined)).toEqual([]);
    });
});

describe('selectEmitTargets: referrers', () => {
    const controls = worker('controls', 'player', 'vp:controls', {
        refs: [{ field: 'screen', entityIds: ['tv'], component: 'vp:screen' }],
    });
    const remote = worker('remote', 'remote', 'm:remote', { refs: [{ field: 'target', entityIds: ['tv'] }] });
    const stranger = worker('stranger', 'x', 'm:stranger', { refs: [{ field: 'target', entityIds: ['other'] }] });
    const screen = worker('screen', 'tv', 'vp:screen');
    const label = worker('label', 'tv', 'm:label');
    const all = [controls, remote, stranger, screen, label];

    it('自分の Entity を参照している Component に返す', () => {
        expect(ids(selectEmitTargets(screen, all, { scope: 'referrers' }, undefined))).toEqual(['controls', 'remote']);
    });

    it('相手の参照が別の型を宣言していれば、同じ Entity でも返さない', () => {
        expect(ids(selectEmitTargets(label, all, { scope: 'referrers' }, undefined))).toEqual(['remote']);
    });

    it('targetType で返す相手の型を絞れる', () => {
        expect(ids(selectEmitTargets(screen, all, { scope: 'referrers' }, 'vp:controls'))).toEqual(['controls']);
    });

    it('誰からも参照されていなければ誰にも届かない', () => {
        expect(selectEmitTargets(controls, all, { scope: 'referrers' }, undefined)).toEqual([]);
    });

    it('自分で自分の Entity を参照していても、自分には返さない', () => {
        const self = worker('self', 'e', 'm:self', { refs: [{ field: 'me', entityIds: ['e'] }] });
        expect(selectEmitTargets(self, [self], { scope: 'referrers' }, undefined)).toEqual([]);
    });
});

describe('selectEmitTargets: 階層の scope', () => {
    // root ─┬─ a (Component 2 つ) ── a-child
    //       └─ b
    const a1 = worker('a1', 'a', 'm:x', { parent: 'root' });
    const a2 = worker('a2', 'a', 'm:y', { parent: 'root' });
    const aChild = worker('a-child', 'a-child', 'm:x', { parent: 'a' });
    const b = worker('b', 'b', 'm:x', { parent: 'root' });
    const root = worker('root', 'root', 'm:x');
    const all = [a1, a2, aChild, b, root];

    it('siblings は同じ親を持つ「別の」Entity だけ（同じ Entity の別 Component は含まない）', () => {
        expect(ids(selectEmitTargets(a1, all, { scope: 'siblings' }, undefined))).toEqual(['b']);
    });

    it('siblings は親の無い送り手からは誰にも届かない', () => {
        expect(selectEmitTargets(root, all, { scope: 'siblings' }, undefined)).toEqual([]);
    });

    it('subtree は同じ Entity の別 Component と子孫に届く', () => {
        expect(ids(selectEmitTargets(a1, all, { scope: 'subtree' }, undefined))).toEqual(['a2', 'a-child']);
    });

    it('parent / children / world', () => {
        expect(ids(selectEmitTargets(aChild, all, { scope: 'parent' }, undefined))).toEqual(['a1', 'a2']);
        expect(ids(selectEmitTargets(root, all, { scope: 'children' }, undefined))).toEqual(['a1', 'a2', 'b']);
        expect(ids(selectEmitTargets(root, all, { scope: 'world' }, 'm:y'))).toEqual(['a2']);
    });

    it('知らない scope（信頼しない Worker から来た値）には誰にも届かない', () => {
        expect(selectEmitTargets(root, all, { scope: 'everyone' as 'world' }, undefined)).toEqual([]);
    });
});
