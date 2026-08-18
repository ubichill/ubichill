import type { ComponentInstance } from '@ubichill/shared/mod/entities';
import type { CmdRide } from '@ubichill/shared/mod/types';
import { describe, expect, it, vi } from 'vitest';
import { createStateModule } from '../state';
import { createRideModule } from './index';

const TRANSFORM = { x: 0, y: 0, z: 0, w: 1, h: 1, scale: 1, rotation: 0 };

function makeVehicle(): ComponentInstance {
    return {
        id: 'vehicle-1',
        type: 'vehicle',
        entityId: 'go-1',
        ownerId: null,
        lockedBy: null,
        transform: TRANSFORM,
        data: {},
    };
}

/** 指定 userId 視点の Ride を、共有された `vehicle` インスタンスに対して組む。 */
function makeRideFor(vehicle: ComponentInstance, userId: string) {
    const sent: CmdRide['payload'][] = [];
    const state = createStateModule({
        send: () => {},
        updateEntity: async (_id, patch) => {
            if ('lockedBy' in patch) vehicle.lockedBy = patch.lockedBy as string | null;
        },
        getMyUserId: () => userId,
        getEntityId: () => undefined,
        getModId: () => 'mod',
        getComponentType: () => undefined,
        getWatchEntityTypes: () => ['vehicle'],
        getPresenceUsers: () => new Map(),
        getLocalSharedState: () => ({}),
        getScrollX: () => 0,
        getScrollY: () => 0,
        getForEachUserComponents: () => new Set(),
        registerPendingFlush: (fn) => fn(),
        getInitialEntities: () => [vehicle],
        trackRead: () => {},
        beginRender: () => {},
        queueUiRender: () => {},
        unmountUi: () => {},
        recordUiRenderCost: () => {},
        buildEntityTargetId: (entityId, componentName) => `${entityId}#${componentName}`,
    });
    const ride = createRideModule({
        state,
        getMyUserId: () => userId,
        getComponentInstanceId: () => 'vehicle-1',
        sendRideCommand: (payload) => sent.push(payload),
    }).exclusive();
    /** サーバーからの entity:patched 反映を模す(他ユーザーの mount/dismount を自分の state へ伝播)。 */
    const receivePatch = () => {
        for (const binding of state._getStateBindings()) binding.applyEntity(vehicle);
    };
    return { ride, sent, receivePatch };
}

describe('createRideModule / exclusive', () => {
    it('乗っていない状態が初期値', () => {
        const { ride } = makeRideFor(makeVehicle(), 'me');
        expect(ride.holder).toBeNull();
        expect(ride.isMine).toBe(false);
        expect(ride.isRiddenByOther).toBe(false);
    });

    it('acquire で自分が乗り、CMD_RIDE mount を送信する', () => {
        const { ride, sent } = makeRideFor(makeVehicle(), 'me');
        ride.acquire();
        expect(ride.holder).toBe('me');
        expect(ride.isMine).toBe(true);
        expect(sent).toEqual([{ action: 'mount', entityId: 'vehicle-1' }]);
    });

    it('release で自分の乗車が解除され、CMD_RIDE dismount を送信する', () => {
        const { ride, sent } = makeRideFor(makeVehicle(), 'me');
        ride.acquire();
        sent.length = 0;
        ride.release();
        expect(ride.holder).toBeNull();
        expect(sent).toEqual([{ action: 'dismount', entityId: 'vehicle-1' }]);
    });

    it('toggle は乗る/降りるを交互に切り替える', () => {
        const { ride } = makeRideFor(makeVehicle(), 'me');
        ride.toggle();
        expect(ride.isMine).toBe(true);
        ride.toggle();
        expect(ride.isMine).toBe(false);
    });

    it('他人が乗っている乗り物には acquire しても乗れない(no-op)', () => {
        const vehicle = makeVehicle();
        const me = makeRideFor(vehicle, 'me');
        const other = makeRideFor(vehicle, 'other');

        other.ride.acquire();
        expect(other.ride.isMine).toBe(true);
        me.receivePatch(); // サーバーが other の乗車を me にも broadcast した想定

        me.ride.acquire();
        expect(me.ride.isMine).toBe(false);
        expect(me.ride.isRiddenByOther).toBe(true);
        expect(me.sent).toHaveLength(0);
    });

    it('onChange は holder の変化を通知し、unregister 後は呼ばれない', () => {
        const { ride } = makeRideFor(makeVehicle(), 'me');
        const listener = vi.fn();
        const unregister = ride.onChange(listener);

        ride.acquire();
        expect(listener).toHaveBeenCalledWith('me', null);

        unregister();
        ride.release();
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
