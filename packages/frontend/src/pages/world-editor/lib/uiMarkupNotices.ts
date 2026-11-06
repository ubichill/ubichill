import { analyzeUiMarkup, MARKUP_LIMITS } from '@ubichill/ui-renderer';

/**
 * core:ui の UI データのうち、作者が書いたとおりには描かれないもの。
 * core:ui は看板・説明・リンクまでで、押したときの動き（操作の配送）はまだ無い。
 */
export function uiMarkupNotices(markup: string): string[] {
    const { droppedTags, droppedHandlers, interactiveTags, unwrappedTags, droppedUrls, truncated } =
        analyzeUiMarkup(markup);
    return [
        ...(interactiveTags.size > 0
            ? [
                  `${[...interactiveTags].join('・')} は描きますが、押しても何も起きません（未対応）。core:ui で使えるのは看板・説明・リンクまでです`,
              ]
            : []),
        ...(droppedHandlers ? ['onclick などの on* 属性は動きません（描くときに捨てます）'] : []),
        ...(droppedTags.size > 0 ? [`${[...droppedTags].join('・')} は中身ごと描きません`] : []),
        ...(unwrappedTags.size > 0
            ? [`${[...unwrappedTags].join('・')} は使えないため、タグを外して中身だけを描きます`]
            : []),
        ...(droppedUrls
            ? [
                  'https 以外の URL（http・相対パスなど）のリンクと画像は描きません。画像は参照元（部屋の URL）を送らずに読み込みます',
              ]
            : []),
        ...(truncated
            ? [
                  `入れ子が ${MARKUP_LIMITS.maxDepth} 段を超えた部分と、${MARKUP_LIMITS.maxElements} 個を超えた要素は描きません`,
              ]
            : []),
    ];
}
