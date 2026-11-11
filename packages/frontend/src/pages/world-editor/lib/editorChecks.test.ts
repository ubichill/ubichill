import { describe, expect, it } from 'vitest';
import { blockingChecks, controlPanelAlert, type EditorCheckInput, editorChecks } from './editorChecks';

const ok: EditorCheckInput = {
    displayName: 'ぼくのワールド',
    worldName: 'my-world',
    yamlError: '',
    referenceProblems: [],
    packagesError: '',
};

describe('editorChecks', () => {
    it('問題が無ければ空', () => {
        expect(editorChecks(ok)).toEqual([]);
    });

    it('空白だけの表示名は未入力として止める', () => {
        const checks = editorChecks({ ...ok, displayName: '  \n ' });
        expect(blockingChecks(checks).map((c) => c.id)).toEqual(['displayName']);
        expect(checks[0].target).toEqual({ kind: 'tab', tab: 'info' });
    });

    it('名前（URL）が空なら止める', () => {
        expect(blockingChecks(editorChecks({ ...ok, worldName: '' })).map((c) => c.id)).toEqual(['worldName']);
    });

    it('mod の取得失敗と参照の問題は止めずに知らせる', () => {
        const checks = editorChecks({
            ...ok,
            packagesError: 'hash が合いません',
            referenceProblems: [{ entityId: 'door', message: 'Entity「key」がありません' }],
        });
        expect(blockingChecks(checks)).toEqual([]);
        expect(checks.map((c) => c.severity)).toEqual(['warning', 'warning']);
        expect(checks[1].target).toEqual({ kind: 'entity', entityId: 'door' });
    });

    it('警告が先に入っていても error を前に並べる', () => {
        const checks = editorChecks({
            ...ok,
            displayName: '',
            yamlError: 'bad indent',
            referenceProblems: [{ entityId: 'a', message: 'x' }],
        });
        expect(checks.map((c) => c.id)).toEqual(['yaml', 'displayName', 'ref:0:a']);
    });

    it('同じ Entity に同じ文の問題が 2 つあっても ID が重ならない', () => {
        const checks = editorChecks({
            ...ok,
            referenceProblems: [
                { entityId: 'a', message: 'x' },
                { entityId: 'a', message: 'x' },
            ],
        });
        expect(new Set(checks.map((c) => c.id)).size).toBe(2);
    });
});

describe('controlPanelAlert', () => {
    const warning = editorChecks({ ...ok, packagesError: 'x' });

    it('何も無ければ印を出さない', () => {
        expect(controlPanelAlert(null, [])).toBeNull();
    });

    it('警告だけなら warning、数は項目の数', () => {
        expect(controlPanelAlert(null, warning)).toEqual({ level: 'warning', count: 1, summary: warning[0].message });
    });

    it('失敗は警告しか無くても error にし、要約に出し、数にも入れる', () => {
        expect(controlPanelAlert('公開に失敗しました: 403', warning)).toEqual({
            level: 'error',
            count: 2,
            summary: '公開に失敗しました: 403',
        });
    });

    it('止める項目があれば error', () => {
        expect(controlPanelAlert(null, editorChecks({ ...ok, displayName: '' }))?.level).toBe('error');
    });
});
