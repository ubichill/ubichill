import { analyzeUiMarkup } from '@ubichill/ui-renderer';

/**
 * core:ui の UI データのうち、作者が「動く」と思いそうで動かないもの。
 * core:ui は看板・説明・リンクまでで、押したときの動き（操作の配送）はまだ無い。
 */
export function uiMarkupNotices(markup: string): string[] {
    const { droppedTags, droppedHandlers, interactiveTags } = analyzeUiMarkup(markup);
    return [
        ...(interactiveTags.size > 0
            ? [
                  `${[...interactiveTags].join('・')} は描きますが、押しても何も起きません（未対応）。core:ui で使えるのは看板・説明・リンクまでです`,
              ]
            : []),
        ...(droppedHandlers ? ['onclick などの on* 属性は動きません（描くときに捨てます）'] : []),
        ...(droppedTags.size > 0 ? [`${[...droppedTags].join('・')} は中身ごと描きません`] : []),
    ];
}
