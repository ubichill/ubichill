/** 答えを待つダイアログ（確認・権限の確認など）。置く画面より上に出るので、出ている間はフォーカスもキーも取らない。 */
const DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';
/** mod の描く面。mod の UI がダイアログを名乗っても、置く画面より下にあるので譲らない。 */
const MOD_SURFACE = '[data-ubi-mod-surface]';

/**
 * 置く場所を選んでいる間、キーとフォーカスをどうするか。
 * - dialog: ほかのダイアログが出ている。フォーカスもキーもそちらに任せる
 * - layer: フォーカスは置く画面の中。キーを置く画面で扱う
 * - reclaim: フォーカスが外（トースト・body など）に出た。置く画面に戻し、キーを置く画面で扱う
 */
export type PlacementFocus = 'dialog' | 'layer' | 'reclaim';

export function placementFocus(layer: Element, doc: Document): PlacementFocus {
    const dialogAbove = [...doc.querySelectorAll(DIALOG)].some(
        (dialog) =>
            dialog !== layer && !dialog.contains(layer) && !layer.contains(dialog) && !dialog.closest(MOD_SURFACE),
    );
    if (dialogAbove) return 'dialog';
    return layer.contains(doc.activeElement) ? 'layer' : 'reclaim';
}
