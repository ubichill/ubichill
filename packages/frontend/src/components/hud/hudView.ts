/**
 * ランチパッド（インスタンスの中の HUD）の表示状態。下のドックで切り替え、ランチパッドのタイルからは 1 段だけ中へ進む。
 * ドックを押すと中の画面は忘れる（ランチパッドを押し直せばトップに戻る）。
 */

export type DockTab = 'launchpad' | 'notifications' | 'instance' | 'audio' | 'settings';

/** ランチパッドのタイルから開く画面。 */
export type LaunchpadPage = 'worlds' | 'instances' | 'social' | 'profile';

export interface HudView {
    dock: DockTab;
    /** dock が launchpad のときだけ意味を持つ。無ければランチパッドのトップ */
    page?: LaunchpadPage;
}

export const LAUNCHPAD_PAGE_TITLES: Record<LaunchpadPage, string> = {
    worlds: 'ワールド',
    instances: 'インスタンス',
    social: 'ソーシャル',
    profile: 'マイページ',
};
