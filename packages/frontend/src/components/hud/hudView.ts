/**
 * ランチパッド（インスタンスの中の HUD）の表示状態。タブは 2 列に分ける:
 * - 下: その場のこと（ランチパッド・現在地・音声）と通知
 * - 左: 探すもの・人・自分（プロフィール・ワールド・ソーシャル・設定）。ワールド・ソーシャル・設定は中でさらに左で切り替える
 * タブの画面の上に画面を重ねて進み（招待・ほかの人のプロフィール）、戻ると 1 枚ずつ外す。タブを押すと重ねた画面は忘れる。
 */

export const PLACE_TABS = ['launchpad', 'instance', 'audio', 'notifications'] as const;
export const PERSON_TABS = ['profile', 'worlds', 'social', 'settings'] as const;
export type HudTab = (typeof PLACE_TABS)[number] | (typeof PERSON_TABS)[number];

/** タブの画面の上に重ねて開く画面。 */
export type HudPage = { kind: 'invite' } | { kind: 'user'; userId: string };

export interface HudView {
    tab: HudTab;
    /** 重ねた画面（最後が手前）。空ならタブの画面 */
    pages: readonly HudPage[];
}

export const INITIAL_HUD_VIEW: HudView = { tab: 'launchpad', pages: [] };

export function selectTab(tab: HudTab): HudView {
    return { tab, pages: [] };
}

const samePage = (a: HudPage, b: HudPage): boolean =>
    a.kind === b.kind && (a.kind !== 'user' || (b.kind === 'user' && a.userId === b.userId));

/** 画面を重ねる。いま手前にあるのと同じ画面なら重ねない（同じ人を続けて開いても戻るのが 1 回で済む）。 */
export function openPage(view: HudView, page: HudPage): HudView {
    const top = view.pages.at(-1);
    if (top && samePage(top, page)) return view;
    return { ...view, pages: [...view.pages, page] };
}

/** 人を開く。自分ならプロフィールのタブへ、ほかの人なら今の画面に重ねる（戻ると元の画面）。 */
export function openUser(view: HudView, userId: string, selfId: string | undefined): HudView {
    return userId === selfId ? selectTab('profile') : openPage(view, { kind: 'user', userId });
}

export function goBack(view: HudView): HudView {
    return { ...view, pages: view.pages.slice(0, -1) };
}

export function currentPage(view: HudView): HudPage | undefined {
    return view.pages.at(-1);
}

/** 重ねた画面の見出し。プロフィールは本文に名前が大きく出るので見出しを付けない。 */
export function pageTitle(page: HudPage): string | null {
    return page.kind === 'invite' ? '招待' : null;
}
