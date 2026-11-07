import { describe, expect, it } from 'vitest';
import { currentPage, goBack, INITIAL_HUD_VIEW, openPage, pageTitle, selectDock } from './hudView';

describe('hudView', () => {
    it('重ねた画面は戻ると 1 枚ずつ外れ、最後はドックの画面に戻る', () => {
        const social = openPage(INITIAL_HUD_VIEW, { kind: 'social' });
        const friend = openPage(social, { kind: 'user', userId: 'u1' });
        expect(currentPage(friend)).toEqual({ kind: 'user', userId: 'u1' });
        expect(currentPage(goBack(friend))).toEqual({ kind: 'social' });
        expect(currentPage(goBack(goBack(friend)))).toBeUndefined();
        // 空で戻っても壊れない
        expect(goBack(INITIAL_HUD_VIEW)).toEqual(INITIAL_HUD_VIEW);
    });

    it('通知から人を開くと、通知のドックのまま重ね、戻ると通知に帰る', () => {
        const view = openPage(selectDock('notifications'), { kind: 'user', userId: 'u1' });
        expect(view.dock).toBe('notifications');
        expect(goBack(view)).toEqual({ dock: 'notifications', pages: [] });
    });

    it('手前と同じ画面は重ねない（同じ人を続けて押しても戻るのは 1 回）。別の人なら重ねる', () => {
        const once = openPage(INITIAL_HUD_VIEW, { kind: 'user', userId: 'u1' });
        expect(openPage(once, { kind: 'user', userId: 'u1' })).toBe(once);
        expect(openPage(once, { kind: 'user', userId: 'u2' }).pages).toHaveLength(2);
    });

    it('ドックを押すと重ねた画面は忘れる', () => {
        const deep = openPage(openPage(INITIAL_HUD_VIEW, { kind: 'worlds' }), { kind: 'profile' });
        expect(selectDock('launchpad')).toEqual({ dock: 'launchpad', pages: [] });
        expect(deep.pages).toHaveLength(2);
    });

    it('プロフィールには見出しを付けない（名前が本文に大きく出る）', () => {
        expect(pageTitle({ kind: 'worlds' })).toBe('ワールド');
        expect(pageTitle({ kind: 'profile' })).toBeNull();
        expect(pageTitle({ kind: 'user', userId: 'u1' })).toBeNull();
    });
});
