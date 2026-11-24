import { ROOM_PORTAL, roomPortalCenter } from '@ubichill/shared';

export interface Point {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

/**
 * 画面に見えているワールド。left・top はスクロールする要素の画面での位置、width・height はその中の見える大きさ
 * （ワールドの px）、scale はその要素が CSS で拡大・縮小されている倍率（ふだんは 1）。
 */
export interface WorldViewport {
    left: number;
    top: number;
    width: number;
    height: number;
    scrollLeft: number;
    scrollTop: number;
    scale: number;
}

/** 矢印キー 1 回で動かす量（ワールドの px）。Shift を押していると大きく動かす。 */
export const PLACEMENT_STEP = { NORMAL: 20, LARGE: 100 } as const;

/** 押してから離すまでにこれより動かなければ、押した所に置く（クリック・タップ）。動かしたら場所を変えただけ。 */
export const PLACEMENT_TAP_SLOP = 8;

/** 画面の座標（clientX・clientY）をワールドの座標にする。 */
export function pointerToWorld(client: Point, view: WorldViewport): Point {
    return {
        x: (client.x - view.left) / view.scale + view.scrollLeft,
        y: (client.y - view.top) / view.scale + view.scrollTop,
    };
}

/** ワールドの座標を画面の座標にする（pointerToWorld の逆）。 */
export function worldToScreen(point: Point, view: WorldViewport): Point {
    return {
        x: view.left + (point.x - view.scrollLeft) * view.scale,
        y: view.top + (point.y - view.scrollTop) * view.scale,
    };
}

/** 置く場所（ポータルの真ん中）。ワールドからはみ出さないよう寄せる（サーバーの範囲の外に出さない）。 */
export function placementAt(point: Point, world: Size): Point {
    return roomPortalCenter(point, world);
}

/** 置き始めの場所。見ている所の真ん中。 */
export function initialPlacement(view: WorldViewport, world: Size): Point {
    return placementAt({ x: view.scrollLeft + view.width / 2, y: view.scrollTop + view.height / 2 }, world);
}

const ARROWS: Readonly<Record<string, Point>> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
};

/** 矢印キーで動かした先。矢印キーでなければ null。 */
export function movedByKey(current: Point, key: string, large: boolean, world: Size): Point | null {
    const direction = ARROWS[key];
    if (!direction) return null;
    const step = large ? PLACEMENT_STEP.LARGE : PLACEMENT_STEP.NORMAL;
    return placementAt({ x: current.x + direction.x * step, y: current.y + direction.y * step }, world);
}

/** 押してから離すまでがクリック・タップか（画面の px で比べる）。 */
export function isTap(down: Point, up: Point): boolean {
    return Math.hypot(up.x - down.x, up.y - down.y) < PLACEMENT_TAP_SLOP;
}

/**
 * ポータルが見える範囲に収まるスクロールの位置。収まっていれば null。キーで見える範囲の外へ動かしたときに追いかける。
 * 見える範囲がポータルより小さい向きは、ポータルの真ん中を見える範囲の真ん中に合わせる。
 */
export function revealScroll(center: Point, view: WorldViewport): { left: number; top: number } | null {
    const along = (value: number, scroll: number, size: number, extent: number) => {
        if (size <= extent) return value - size / 2;
        const start = value - extent / 2;
        const end = value + extent / 2;
        if (start < scroll) return start;
        if (end > scroll + size) return end - size;
        return scroll;
    };
    const left = along(center.x, view.scrollLeft, view.width, ROOM_PORTAL.WIDTH);
    const top = along(center.y, view.scrollTop, view.height, ROOM_PORTAL.HEIGHT);
    return left === view.scrollLeft && top === view.scrollTop ? null : { left, top };
}

/** 押されたキーの扱い。 */
export type PlacementKeyAction =
    /** そのまま通す（Ctrl・Alt・Meta との組み合わせ。ブラウザ・OS のショートカット） */
    | 'pass'
    /** やめる */
    | 'cancel'
    /** 今のゴーストの所に置く */
    | 'place'
    /** 矢印キーでゴーストを動かす */
    | 'move'
    /** 置く画面の中でフォーカスを回す（閉じ込める） */
    | 'focus-next'
    | 'focus-previous'
    /** フォーカスのあるボタンを押す（ブラウザに任せ、mod には渡さない） */
    | 'button'
    /** 何もしない（mod には渡さない） */
    | 'swallow';

export interface KeyLike {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
}

/** 置く場所を選んでいる間のキーの扱い。onButton は置く画面のボタンにフォーカスがあるか。 */
export function placementKeyAction(e: KeyLike, onButton: boolean): PlacementKeyAction {
    if (e.ctrlKey || e.altKey || e.metaKey) return 'pass';
    if (e.key === 'Escape') return 'cancel';
    if (e.key === 'Tab') return e.shiftKey ? 'focus-previous' : 'focus-next';
    if (e.key === 'Enter' || e.key === ' ') return onButton ? 'button' : e.key === 'Enter' ? 'place' : 'swallow';
    if (e.key in ARROWS) return 'move';
    return 'swallow';
}

/** フォーカスを回した先（current は今の位置、-1 は置く画面そのもの）。端で反対の端に回る。 */
export function nextFocusIndex(current: number, count: number, backwards: boolean): number {
    if (count <= 0) return -1;
    if (current < 0 || current >= count) return backwards ? count - 1 : 0;
    return (current + (backwards ? count - 1 : 1)) % count;
}
