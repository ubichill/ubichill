/**
 * danmaku:wall Worker — 自機の可動域（壁）。
 *
 * ロジックは持たない。この Entity の transform（x/y/w/h）がそのまま可動域の矩形になる。
 * danmaku:player の wall（entityRef）にこの Entity を紐付けると、自機の移動が矩形内に制限される。
 * 紐付けなければ自機は自由に移動できる。
 */

import type { ComponentConfig } from '@ubichill/sdk';

export const config: ComponentConfig = {
    description: '自機の可動域（壁）。transform の矩形が移動範囲になる。',
};
