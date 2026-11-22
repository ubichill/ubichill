import {
    CORE_COMPONENT_TYPES,
    PortalDataSchema,
    type PortalTarget,
    parsePortalTarget,
    readCoreData,
    SwitchDataSchema,
    UiDataSchema,
    WarpDataSchema,
} from '@ubichill/core-components';
import type { ComponentInstance } from '@ubichill/shared';
import type { PortalLookup } from './portalNavigation';

type Part = Pick<ComponentInstance, 'id' | 'type' | 'data' | 'entityId'>;

/** UI のボタンで動かすスクリプト。id は Component の ID（スイッチはこれで押したことをインスタンスへ送る） */
export type EntityScript =
    | { kind: 'warp'; id: string; label: string; target: string }
    | { kind: 'switch'; id: string; label: string; ready: boolean }
    | { kind: 'portal'; id: string; label: string; target: PortalTarget | null };

const entityOf = (part: Part): string => part.entityId ?? part.id;

/**
 * Entity に「ボタンにした UI」（`core:ui` の `button: true`）があるか。あれば、同じ Entity のスクリプトは
 * 自分のボタンを描かず、その UI を押したときに動く。
 */
export function hasUiButton(parts: Iterable<Part>, entityId: string): boolean {
    return [...parts].some(
        (part) =>
            entityOf(part) === entityId &&
            part.type === CORE_COMPONENT_TYPES.ui &&
            readCoreData(UiDataSchema, part.data ?? {}).data?.button === true,
    );
}

/**
 * Entity のスクリプト（ワープ・スイッチ・ポータル）を並び順で。設定が読めないワープ・スイッチは入れない。
 * 設定が読めないポータルは、最初の 1 つを決めるときに数えるので、行き先の無いポータルとして入れる。
 */
export function entityScripts(parts: Iterable<Part>, entityId: string): EntityScript[] {
    return [...parts]
        .filter((part) => entityOf(part) === entityId)
        .flatMap((part): EntityScript[] => {
            const data = part.data ?? {};
            if (part.type === CORE_COMPONENT_TYPES.warp) {
                const warp = readCoreData(WarpDataSchema, data).data;
                return warp ? [{ kind: 'warp', id: part.id, label: warp.label.trim(), target: warp.target }] : [];
            }
            if (part.type === CORE_COMPONENT_TYPES.switch) {
                const sw = readCoreData(SwitchDataSchema, data).data;
                return sw
                    ? [{ kind: 'switch', id: part.id, label: sw.label.trim(), ready: sw.targets.length > 0 }]
                    : [];
            }
            if (part.type === CORE_COMPONENT_TYPES.portal) {
                const portal = readCoreData(PortalDataSchema, data).data;
                return [
                    {
                        kind: 'portal',
                        id: part.id,
                        label: portal?.label.trim() ?? '',
                        target: portal ? parsePortalTarget(portal.world) : null,
                    },
                ];
            }
            return [];
        });
}

/**
 * ボタンを 1 回押したときに動かすスクリプトとその順番。部屋の中で済むもの（ワープ・スイッチ）を並び順に動かし、
 * 部屋を出るポータルは最初の 1 つだけを最後に動かす。ポータルが 2 つ動くと確かめる画面が重なり、行き先が決まらない。
 */
export function planButtonPress(scripts: readonly EntityScript[]): EntityScript[] {
    const portal = scripts.find((script) => script.kind === 'portal');
    const inRoom = scripts.filter((script) => script.kind !== 'portal');
    return portal ? [...inRoom, portal] : inRoom;
}

/** ボタンにした UI がある Entity で、押しても動かないスクリプト（2 つ目からのポータル）の Component の ID。 */
export function idleButtonScripts(parts: Iterable<Part>, entityId: string): string[] {
    const list = [...parts];
    if (!hasUiButton(list, entityId)) return [];
    const scripts = entityScripts(list, entityId);
    const planned = new Set(planButtonPress(scripts).map((script) => script.id));
    return scripts.filter((script) => !planned.has(script.id)).map((script) => script.id);
}

const PORTAL_NAME = 'ポータル';

/** 行き先のワールドの名前を待つ長さ（ms）。引けないまま押したことを止めない */
export const PORTAL_NAME_WAIT_MS = 1500;

/**
 * 移る前に確かめる画面に出す名前。標準のポータルと同じく、ポータルの名前、行き先のワールドの名前（同じ lookup で引く）、
 * 押したものの名前（UI のテキスト）、「ポータル」の順。
 */
export async function portalConfirmName(
    portal: { label: string; target: PortalTarget },
    lookup: PortalLookup | null,
    pressedName: string,
    waitMs = PORTAL_NAME_WAIT_MS,
): Promise<string> {
    const fallback = pressedName.trim().replace(/\s+/g, ' ') || PORTAL_NAME;
    if (portal.label) return portal.label;
    if (!lookup) return fallback;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs));
    const destination = await Promise.race([lookup(portal.target).catch(() => null), timeout]);
    return destination?.name || fallback;
}

/**
 * 押したときの動きが終わるまで、同じボタンをもう一度押しても動かさない（確かめる画面が出ている間に Enter を押し直して、
 * スイッチを部屋の全員の画面で切り替え直さない）。
 */
export function createPressGuard(): (press: () => Promise<unknown>) => void {
    const state = { busy: false };
    return (press) => {
        if (state.busy) return;
        state.busy = true;
        void new Promise((resolve) => resolve(press()))
            .catch((error: unknown) => console.error('[button] 押したときの動きが失敗しました', error))
            .finally(() => {
                state.busy = false;
            });
    };
}

/** ボタンの読み上げの名前。UI のテキスト、無ければスクリプトの名前を並べる。 */
export function uiButtonLabel(text: string, scripts: readonly EntityScript[]): string {
    const own = text.trim().replace(/\s+/g, ' ');
    if (own) return own;
    const names = scripts.map((script) => script.label).filter(Boolean);
    return names.length > 0 ? names.join('・') : 'ボタン';
}
