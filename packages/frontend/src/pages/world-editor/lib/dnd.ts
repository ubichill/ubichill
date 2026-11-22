/** アセットパネルから Component カードを drag したときに使う MIME type。 */
export const COMPONENT_DRAG_MIME = 'application/x-ubichill-component';

/** ヒエラルキー内で Entity 行を drag するときの MIME type (path key を運ぶ)。 */
export const ENTITY_DRAG_MIME = 'application/x-ubichill-entity-path';

/** ヒエラルキー余白 (= ルートへの drop) を識別する dragOverKey の特別値。 */
export const ROOT_DROP_KEY = '__root__';

/** アセットパネルからプレハブを drag したときの MIME type（`<modId>/<プレハブの名前>` を運ぶ）。 */
export const PREFAB_DRAG_MIME = 'application/x-ubichill-prefab';

export interface PrefabDragRef {
    modId: string;
    name: string;
}

export const encodePrefabDrag = (ref: PrefabDragRef): string => `${ref.modId}/${ref.name}`;

/** 運ばれた値を読む。ほかのページから落とされた文字列などは null。 */
export function decodePrefabDrag(value: string): PrefabDragRef | null {
    const match = /^([a-z0-9-]{1,50})\/([a-z0-9-]{1,50})$/.exec(value);
    return match ? { modId: match[1], name: match[2] } : null;
}
