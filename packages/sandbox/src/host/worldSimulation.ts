/**
 * ワールドの進行を SimulationLoop に載せる配線。
 *
 * 判定そのものは `@ubichill/runtime`（DOM もネットワークも持たない純粋計算）が担い、
 * ここは「毎フレーム collider を集めて runtime に渡し、出てきた事実を mod へ配る」だけ。
 * この分離のおかげで、権威をサーバーへ移す場合は配線だけを差し替えればよい。
 *
 * collider の一覧は Host（ワールドの状態を持っている側）から関数で渡してもらう。
 * sandbox は Entity の保管庫を持たないので、ここで取りに行くことはしない。
 */
import { type ColliderInstance, createCollisionTracker } from '@ubichill/runtime';
import { deliverToEntity } from './ModRegistry';
import { subscribeWorldStep, unsubscribeWorldStep } from './SimulationLoop';

/** mod が受け取るイベント名。`Ubi.event` の emit と同じ経路で届く。 */
export const COLLISION_ENTER_EVENT = 'collision:enter';
export const COLLISION_EXIT_EVENT = 'collision:exit';

/**
 * 衝突相手の情報。自分から見た「ぶつかった相手」を表す。
 * `isTrigger` は押し戻すかどうかの解釈材料として渡すだけで、Host は位置を動かさない。
 */
export interface CollisionEventData {
    /** 相手の Component インスタンス id。 */
    colliderId: string;
    /** 相手が乗っている GameObject id。 */
    entityId?: string;
    /** 相手の collider の layer。 */
    layer: string;
    isTrigger: boolean;
}

export interface WorldSimulationOptions {
    /** 毎フレーム呼ばれる。今ワールドに存在する collider を返す。 */
    getColliders: () => readonly ColliderInstance[];
}

/**
 * ワールドの進行を開始する。1 ワールドにつき 1 回だけ呼ぶ。
 * 同じ key で呼び直すと差し替わる（接触の履歴はリセットされる）。
 */
export function startWorldSimulation(key: string, options: WorldSimulationOptions): void {
    const tracker = createCollisionTracker();
    // 前フレームの collider。破棄された相手の情報を exit に載せるために持つ
    // （消えた瞬間に「離れた」ことだけ伝わって相手が分からない、を避ける）。
    const state: { previousById: ReadonlyMap<string, ColliderInstance> } = { previousById: new Map() };

    subscribeWorldStep(key, () => {
        const colliders = options.getColliders();
        const events = tracker.step(colliders);
        const currentById = new Map(colliders.map((c) => [c.id, c]));

        if (events.entered.length > 0 || events.exited.length > 0) {
            // exit では相手が既に消えていることがあるので、前フレームの分も引けるようにする。
            const lookup = new Map([...state.previousById, ...currentById]);
            const dispatch = (eventType: string, contacts: readonly { a: string; b: string }[]): void => {
                for (const contact of contacts) {
                    const a = lookup.get(contact.a);
                    const b = lookup.get(contact.b);
                    if (!a || !b) continue;
                    if (a.entityId) deliverToEntity(a.entityId, eventType, toEventData(b));
                    if (b.entityId) deliverToEntity(b.entityId, eventType, toEventData(a));
                }
            };
            dispatch(COLLISION_ENTER_EVENT, events.entered);
            dispatch(COLLISION_EXIT_EVENT, events.exited);
        }

        state.previousById = currentById;
    });
}

export function stopWorldSimulation(key: string): void {
    unsubscribeWorldStep(key);
}

function toEventData(other: ColliderInstance): CollisionEventData {
    return {
        colliderId: other.id,
        entityId: other.entityId,
        layer: other.data.layer,
        isTrigger: other.data.isTrigger,
    };
}
