/**
 * ランチパッド（インスタンスの中の HUD）の表示状態。下のドックで画面を切り替え、その上に画面を重ねて進む
 * （ワールド一覧・ソーシャル・プロフィール）。戻ると 1 枚ずつ外し、ドックを押すと重ねた画面は忘れる。
 */

export type DockTab = 'launchpad' | 'notifications' | 'instance' | 'audio' | 'settings';

/** ドックの画面の上に重ねて開く画面。 */
export type HudPage = { kind: 'worlds' } | { kind: 'social' } | { kind: 'profile' } | { kind: 'user'; userId: string };

export interface HudView {
    dock: DockTab;
    /** 重ねた画面（最後が手前）。空ならドックの画面 */
    pages: readonly HudPage[];
}

export const INITIAL_HUD_VIEW: HudView = { dock: 'launchpad', pages: [] };

export function selectDock(dock: DockTab): HudView {
    return { dock, pages: [] };
}

const samePage = (a: HudPage, b: HudPage): boolean =>
    a.kind === b.kind && (a.kind !== 'user' || (b.kind === 'user' && a.userId === b.userId));

/** 画面を重ねる。いま手前にあるのと同じ画面なら重ねない（同じ人を続けて開いても戻るのが 1 回で済む）。 */
export function openPage(view: HudView, page: HudPage): HudView {
    const top = view.pages.at(-1);
    if (top && samePage(top, page)) return view;
    return { ...view, pages: [...view.pages, page] };
}

export function goBack(view: HudView): HudView {
    return { ...view, pages: view.pages.slice(0, -1) };
}

export function currentPage(view: HudView): HudPage | undefined {
    return view.pages.at(-1);
}

/** 重ねた画面の見出し。プロフィールは本文に名前が大きく出るので見出しを付けない。 */
export function pageTitle(page: HudPage): string | null {
    switch (page.kind) {
        case 'worlds':
            return 'ワールド';
        case 'social':
            return 'ソーシャル';
        default:
            return null;
    }
}
