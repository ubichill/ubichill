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

/** Entity のスクリプト（ワープ・スイッチ・ポータル）を並び順で。設定が読めないものは動かさないので入れない。 */
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
                return portal
                    ? [
                          {
                              kind: 'portal',
                              id: part.id,
                              label: portal.label.trim(),
                              target: parsePortalTarget(portal.world),
                          },
                      ]
                    : [];
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

/** ボタンの読み上げの名前。UI のテキスト、無ければスクリプトの名前を並べる。 */
export function uiButtonLabel(text: string, scripts: readonly EntityScript[]): string {
    const own = text.trim().replace(/\s+/g, ' ');
    if (own) return own;
    const names = scripts.map((script) => script.label).filter(Boolean);
    return names.length > 0 ? names.join('・') : 'ボタン';
}
