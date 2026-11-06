import { type SmokeAccount, smokeAccount } from './account.ts';
import { type Fetch, isRecord, preview, register, requestJson, type Session, signIn } from './http.ts';
import { connectInstance, expectSuccess, type InstanceSocket } from './instanceSocket.ts';
import { runSteps, type Step, type StepResult, type StepsOutcome } from './steps.ts';
import { type SmokeTarget, socketUrl } from './target.ts';

/**
 * API と WebSocket の通し（ブラウザ不要）。
 * 2 人が登録・ログインし、同じ部屋に入って、カーソルと共有状態が相手に届くことを確かめる。
 * Go を複数 Pod にしたプレビューでは、2 人が別の Pod に繋がれば中継（#250）の通しにもなる。
 */
export interface ApiSmokeOptions {
    readonly target: SmokeTarget;
    readonly runId: string;
    readonly worldId: string;
    readonly fetchFn?: Fetch;
    readonly onResult?: (result: StepResult) => void;
}

interface Participant {
    readonly account: SmokeAccount;
    readonly session?: Session;
    readonly socket?: InstanceSocket;
    readonly userId?: string;
}

export interface ApiSmokeContext {
    readonly commitHash?: string;
    readonly alice: Participant;
    readonly bob: Participant;
    readonly instanceId?: string;
}

type Role = 'alice' | 'bob';

export function runApiSmoke({
    target,
    runId,
    worldId,
    fetchFn = fetch,
    onResult,
}: ApiSmokeOptions): Promise<StepsOutcome<ApiSmokeContext>> {
    const initial: ApiSmokeContext = {
        alice: { account: smokeAccount(runId, 'a') },
        bob: { account: smokeAccount(runId, 'b') },
    };
    const stateKey = `smoke:${runId}`;

    const enter =
        (role: Role): Step<ApiSmokeContext>['run'] =>
        async (context) => {
            const instanceId = need(context.instanceId, 'インスタンスの ID');
            const session = need(context[role].session, `${role} のログイン`);
            const joined = await requestJson(fetchFn, target, `/api/v1/instances/${instanceId}/join`, {
                method: 'POST',
                body: {},
                cookie: session.cookie,
            });
            if (!isRecord(joined) || typeof joined.token !== 'string' || typeof joined.url !== 'string') {
                throw new Error(`参加情報に token・url がありません: ${preview(joined)}`);
            }
            const socket = await connectInstance(socketUrl(target.apiOrigin, joined.url));
            const reply = expectSuccess(
                await socket.request('world:join', {
                    instanceId,
                    token: joined.token,
                    user: { name: session.account.displayName, status: 'online', position: { x: 0, y: 0 } },
                }),
                'world:join',
            );
            const snapshot = await socket.waitFor('world:snapshot');
            if (!isRecord(snapshot) || !Array.isArray(snapshot.entities)) {
                throw new Error(`world:snapshot に entities がありません: ${preview(snapshot)}`);
            }
            const userId = typeof reply.userId === 'string' ? reply.userId : undefined;
            return { ...context, [role]: { ...context[role], socket, userId: need(userId, 'world:join の userId') } };
        };

    const cursorReaches = async (from: Participant, to: Participant, position: { x: number; y: number }) => {
        const sender = need(from.socket, '送る側の接続');
        const receiver = need(to.socket, '受け取る側の接続');
        const arrival = receiver.waitFor(
            'cursor:moved',
            (data) =>
                isRecord(data) &&
                data.userId === from.userId &&
                isRecord(data.position) &&
                data.position.x === position.x &&
                data.position.y === position.y,
            5_000,
        );
        sender.send('cursor:move', { position });
        await arrival;
    };

    const steps: Step<ApiSmokeContext>[] = [
        {
            name: '版（/api/version）',
            run: async (context) => {
                const version = await requestJson(fetchFn, target, '/api/version');
                if (!isRecord(version) || typeof version.commitHash !== 'string') {
                    throw new Error(`commitHash がありません: ${preview(version)}`);
                }
                return { ...context, commitHash: version.commitHash };
            },
        },
        {
            name: '登録（2 人・メール確認なし）',
            run: async (context) => {
                await register(fetchFn, target, context.alice.account);
                await register(fetchFn, target, context.bob.account);
                return context;
            },
        },
        {
            name: 'ログイン（2 人）',
            run: async (context) => ({
                ...context,
                alice: { ...context.alice, session: await signIn(fetchFn, target, context.alice.account) },
                bob: { ...context.bob, session: await signIn(fetchFn, target, context.bob.account) },
            }),
        },
        {
            name: `ワールドの一覧に ${worldId} がある`,
            run: async (context) => {
                const cookie = need(context.alice.session, 'ログイン').cookie;
                const list = await requestJson(fetchFn, target, '/api/v1/worlds', { cookie });
                const worlds = isRecord(list) && Array.isArray(list.worlds) ? list.worlds : [];
                const ids = worlds.flatMap((world) =>
                    isRecord(world) && typeof world.id === 'string' ? [world.id] : [],
                );
                if (!ids.includes(worldId)) {
                    throw new Error(
                        `一覧に ${worldId} がありません（${ids.join(', ') || '空'}）。WORLDS_SERVE_UNSIGNED_REPOSITORY を確かめてください`,
                    );
                }
                return context;
            },
        },
        {
            name: 'インスタンスを作る',
            run: async (context) => {
                const created = await requestJson(fetchFn, target, '/api/v1/instances', {
                    method: 'POST',
                    body: { worldId, access: { type: 'public' } },
                    cookie: need(context.alice.session, 'ログイン').cookie,
                });
                if (!isRecord(created) || typeof created.id !== 'string') {
                    throw new Error(`作ったインスタンスに id がありません: ${preview(created)}`);
                }
                return { ...context, instanceId: created.id };
            },
        },
        { name: '1 人目が入室（world:join → world:snapshot）', run: enter('alice') },
        { name: '2 人目が同じ部屋に入室', run: enter('bob') },
        {
            name: 'カーソルが相手に届く（cursor:move → cursor:moved・双方向）',
            run: async (context) => {
                await cursorReaches(context.alice, context.bob, { x: 123, y: 456 });
                await cursorReaches(context.bob, context.alice, { x: 789, y: 12 });
                return context;
            },
        },
        {
            name: '共有状態（state:update → state:changed・state:get・競合）',
            run: async (context) => {
                const alice = need(context.alice.socket, '1 人目の接続');
                const bob = need(context.bob.socket, '2 人目の接続');
                const value = { runId, n: 1 };
                const changed = bob.waitFor('state:changed', (data) => isRecord(data) && data.key === stateKey, 5_000);
                const written = expectSuccess(
                    await alice.request('state:update', { key: stateKey, value, expectedRevision: 0 }),
                    'state:update',
                );
                const revision = isRecord(written.entry) ? written.entry.revision : undefined;
                if (typeof revision !== 'number' || revision < 1) {
                    throw new Error(`state:update の revision が不正です: ${preview(written)}`);
                }
                await changed;
                const read = expectSuccess(await bob.request('state:get', { key: stateKey }), 'state:get');
                if (!isRecord(read.entry) || JSON.stringify(read.entry.value) !== JSON.stringify(value)) {
                    throw new Error(`state:get が書いた値を返しません: ${preview(read)}`);
                }
                // 古い revision での書き込みは、上書きせずに競合を返す
                const stale = await bob.request('state:update', {
                    key: stateKey,
                    value: { n: 2 },
                    expectedRevision: 0,
                });
                if (!isRecord(stale) || stale.success !== false || stale.code !== 'conflict') {
                    throw new Error(`古い revision の書き込みが競合になりません: ${preview(stale)}`);
                }
                return context;
            },
        },
        {
            name: '後片付け（接続を閉じ、インスタンスを消す）',
            always: true,
            run: async (context) => {
                context.alice.socket?.close();
                context.bob.socket?.close();
                if (!context.instanceId || !context.alice.session) return context;
                await requestJson(fetchFn, target, `/api/v1/instances/${context.instanceId}`, {
                    method: 'DELETE',
                    cookie: context.alice.session.cookie,
                });
                return { ...context, instanceId: undefined };
            },
        },
    ];

    return runSteps(steps, initial, { onResult });
}

function need<T>(value: T | undefined, what: string): T {
    if (value === undefined) throw new Error(`${what} がありません（前の段が終わっていません）`);
    return value;
}
