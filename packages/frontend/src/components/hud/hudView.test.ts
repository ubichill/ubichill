import { describe, expect, it } from 'vitest';
import {
    currentPage,
    goBack,
    INITIAL_HUD_VIEW,
    openPage,
    openUser,
    PERSON_TABS,
    PLACE_TABS,
    pageTitle,
    selectTab,
} from './hudView';

describe('hudView', () => {
    it('重ねた画面は戻ると 1 枚ずつ外れ、最後はタブの画面に戻る', () => {
        const invite = openPage(INITIAL_HUD_VIEW, { kind: 'invite' });
        const friend = openPage(invite, { kind: 'user', userId: 'u1' });
        expect(currentPage(friend)).toEqual({ kind: 'user', userId: 'u1' });
        expect(currentPage(goBack(friend))).toEqual({ kind: 'invite' });
        expect(currentPage(goBack(goBack(friend)))).toBeUndefined();
        // 空で戻っても壊れない
        expect(goBack(INITIAL_HUD_VIEW)).toEqual(INITIAL_HUD_VIEW);
    });

    it('通知から人を開くと、通知のタブのまま重ね、戻ると通知に帰る', () => {
        const view = openUser(selectTab('notifications'), 'u1', 'me');
        expect(view.tab).toBe('notifications');
        expect(goBack(view)).toEqual({ tab: 'notifications', pages: [] });
    });

    it('自分を開くとプロフィールのタブに移る（自分のプロフィールを重ねない）', () => {
        const fromSearch = openUser(openUser(selectTab('social'), 'u1', 'me'), 'me', 'me');
        expect(fromSearch).toEqual({ tab: 'profile', pages: [] });
        // ログインを確かめる前（selfId が無い）は、ほかの人として重ねる
        expect(openUser(INITIAL_HUD_VIEW, 'me', undefined).pages).toHaveLength(1);
    });

    it('手前と同じ画面は重ねない（同じ人を続けて押しても戻るのは 1 回）。別の人なら重ねる', () => {
        const once = openPage(INITIAL_HUD_VIEW, { kind: 'user', userId: 'u1' });
        expect(openPage(once, { kind: 'user', userId: 'u1' })).toBe(once);
        expect(openPage(once, { kind: 'user', userId: 'u2' }).pages).toHaveLength(2);
    });

    it('タブを押すと重ねた画面は忘れる', () => {
        const deep = openPage(openPage(INITIAL_HUD_VIEW, { kind: 'invite' }), { kind: 'user', userId: 'u1' });
        expect(deep.pages).toHaveLength(2);
        expect(selectTab('launchpad')).toEqual({ tab: 'launchpad', pages: [] });
    });

    it('タブは下（いる場所）と左（自分と人）で重ならない', () => {
        const place: readonly string[] = PLACE_TABS;
        expect(PERSON_TABS.filter((t) => place.includes(t))).toEqual([]);
    });

    it('プロフィールには見出しを付けない（名前が本文に大きく出る）', () => {
        expect(pageTitle({ kind: 'invite' })).toBe('招待');
        expect(pageTitle({ kind: 'user', userId: 'u1' })).toBeNull();
    });
});
