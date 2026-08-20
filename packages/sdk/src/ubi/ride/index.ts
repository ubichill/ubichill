/**
 * Ubi.ride — 自エンティティを「乗れる乗り物」として宣言する SDK プリミティブ。
 *
 * `Ubi.grip`(掴む)の対になるプリミティブ。grip は「エンティティがカーソルに追従する」
 * のに対し、ride は逆に「乗った間だけ自分のアバターがOSカーソルから切り離され、
 * 矢印キーでの移動 + カメラ追従に切り替わる」(実体はホスト側の CursorLayer が担う)。
 *
 * grip と違い、「同じ Component type の中で1つだけ」という兄弟間の調停は不要。
 * 乗るのはユーザー単位の排他(1ユーザーは同時に1つの乗り物にしか乗れない)なので、
 * 既に他の乗り物に乗っていた場合の自動下車はホスト側 (RideContext) が担当する。
 *
 * - 占有者(今乗っているユーザー)を ComponentInstance.lockedBy (top-level) として永続同期する。
 * - CMD_RIDE の mount/dismount でホストに通知 → CursorLayer が操作方式を切り替える。
 */

import type { CmdRide } from '@ubichill/shared/mod/types';
import type { StateModule } from '../state';

export interface Ride {
    /** 現在乗っているユーザー (`null` = 誰も乗っていない) */
    readonly holder: string | null;
    /** 自分が乗っているか */
    readonly isMine: boolean;
    /** 他人が乗っているか */
    readonly isRiddenByOther: boolean;
    /** 乗る。既に他人が乗っていれば no-op。 */
    acquire(): void;
    /** 降りる。 */
    release(): void;
    /** 乗っていなければ乗る、乗っていれば降りる。 */
    toggle(): void;
    /** 占有者の変化を監視。戻り関数で unregister。 */
    onChange(listener: (next: string | null, prev: string | null) => void): () => void;
}

export type RideModuleDeps = {
    state: StateModule;
    getMyUserId(): string | undefined;
    getComponentInstanceId(): string | undefined;
    /** CMD_RIDE コマンドをホストへ送信する */
    sendRideCommand(payload: CmdRide['payload']): void;
};

export type RideModule = {
    /**
     * 自エンティティを「1ユーザーが同時に1つだけ乗れる」乗り物として公開する。
     *
     * ```ts
     * const ride = Ubi.ride.exclusive();
     * onUbiClick={() => ride.toggle()}
     * ride.onChange(renderVehicle);
     * ```
     */
    exclusive(): Ride;
};

export function createRideModule(deps: RideModuleDeps): RideModule {
    return {
        exclusive: (): Ride => {
            const inner = deps.state.define({
                holder: deps.state.sync<string | null>(null, { topLevel: 'lockedBy' }),
            });

            const listeners = new Set<(next: string | null, prev: string | null) => void>();
            inner.onChange('holder', (next, prev) => {
                const me = deps.getMyUserId();
                // ゴースト防止: 自分の乗車が外的要因 (サーバー patch・entity:patched での
                // lockedBy=null など) で外れた場合も、host へ CMD_RIDE dismount を必ず送る。
                if (prev === me && next !== me) {
                    deps.sendRideCommand({ action: 'dismount', entityId: deps.getComponentInstanceId() ?? '' });
                }
                for (const fn of listeners) fn(next as string | null, prev as string | null);
            });

            const ride: Ride = {
                get holder() {
                    return inner.local.holder;
                },
                get isMine() {
                    const me = deps.getMyUserId();
                    return me !== undefined && inner.local.holder === me;
                },
                get isRiddenByOther() {
                    const me = deps.getMyUserId();
                    const h = inner.local.holder;
                    return h !== null && h !== me;
                },
                toggle(): void {
                    if (ride.isMine) ride.release();
                    else if (!ride.isRiddenByOther) ride.acquire();
                },
                acquire(): void {
                    const me = deps.getMyUserId();
                    const self = deps.getComponentInstanceId();
                    if (!me || !self) return;
                    if (ride.isRiddenByOther) return;

                    inner.local.holder = me;
                    // ホストへ CMD_RIDE mount を送信 → CursorLayer がキーボード移動+カメラ追従に切替。
                    // 既に他の乗り物に乗っていた場合の自動下車はホスト側 (RideContext) が担当する。
                    deps.sendRideCommand({ action: 'mount', entityId: self });
                },
                release(): void {
                    // dismount 送信は onChange のゴースト防止ハンドラ(prev===me && next!==me)が
                    // 自己下車・外的クリア(サーバー patch 等)を問わず一元的に担う。ここで書くのは
                    // holder=null の代入のみで、二重送信を避ける。
                    inner.local.holder = null;
                },
                onChange(listener): () => void {
                    listeners.add(listener);
                    return () => {
                        listeners.delete(listener);
                    };
                },
            };

            return ride;
        },
    };
}
