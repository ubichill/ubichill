/**
 * WorldView — ワールドを動かす画面の本体。SNS のインスタンス画面と `world.html` が共通で使う。
 *
 * 入室の流れ（インスタンスの取得 → 作者を確認できないワールドの確認 → world:join）、ロード画面、
 * mod の取得と確認（ModRegistry）、描画（WorldStage）、カーソル、サーバーからの知らせをまとめる。
 * SNS に固有のもの（認証・ホームへの導線・HUD）は持たず、props で受け取る。
 */
import { useSocket, useWorld, WorkerLoadingProvider } from '@ubichill/react';
import type { Instance, ModLock } from '@ubichill/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { CursorLayer } from './cursor/CursorLayer';
import { acceptEntry, hasAcceptedEntry, unverifiedEntryKey, unverifiedEntryMessage } from './entryGate';
import { InstanceLoadingScreen } from './InstanceLoadingScreen';
import { type InstanceFailure, InstanceNotFoundError } from './instanceFailure';
import { ModRegistryProvider } from './ModRegistryContext';
import type { ModSource } from './modSource';
import { ServerNoticeToasts } from './ServerNoticeToasts';
import { useInstanceLoading } from './useInstanceLoading';
import { WorldStage } from './WorldStage';

export const ENTRY_DECLINED_MESSAGE = '作者を確認できないワールドのため、入室を取りやめました';

export interface WorldViewProps {
    instanceId: string;
    /** 入室時の表示名。 */
    userName: string;
    /** インスタンスの情報（ワールドの作者の確認に使う）。SNS は backend、`world.html` は Go から取る。無ければ InstanceNotFoundError。 */
    fetchInstance: (instanceId: string) => Promise<Instance>;
    /** 作者を確認できないワールドに入るかを利用者に聞く。false なら入らない。 */
    confirmEntry: (message: string) => Promise<boolean>;
    /** mod の取得元と、未署名の mod を許すか。 */
    modSource: ModSource;
    /** ワールドの lock を差し替える（dev サーバーの世代）。無ければ Go の snapshot の lock。 */
    lock?: ModLock;
    /** 認証の確認が終わっていないか（SNS だけ）。終わるまで入室を始めない。 */
    authPending?: boolean;
    /** 入室前に自分と他人のカーソルを分ける ID（SNS のログイン中のユーザー）。 */
    selfId?: string;
    /** ロード画面に出すワールドの見た目。 */
    preview?: { displayName?: string; thumbnail?: string };
    /** 失敗したとき・入室を断ったときの導線。 */
    recovery: { label: string; run: () => void };
    /** 読み込みの失敗が確定したとき（SNS はしばらくしてホームへ戻す）。 */
    onFailed?: (failure: InstanceFailure) => void;
    /** 入室できたあとに重ねる UI（HUD など）。 */
    children?: ReactNode;
}

export function WorldView({
    instanceId,
    userName,
    fetchInstance,
    confirmEntry,
    modSource,
    lock,
    authPending = false,
    selfId,
    preview,
    recovery,
    onFailed,
    children,
}: WorldViewProps) {
    const { isConnected, isConnecting, error, sessionReplaced, currentUser, joinWorld, leaveWorld } = useSocket();
    const { resetWorld, modLock } = useWorld();

    const joinedIdRef = useRef<string | null>(null);
    const leaveWorldRef = useRef(leaveWorld);
    leaveWorldRef.current = leaveWorld;

    // インスタンスの取得・作者の確認など、Socket 以外で起きる失敗
    const [loadError, setLoadError] = useState<{ message: string; gone: boolean } | null>(null);
    // mod の取得 / Worker 起動の進捗（各 Provider から通知される）
    const [mods, setMods] = useState({ completed: 0, total: 0 });
    const [workers, setWorkers] = useState({ ready: 0, total: 0 });

    useEffect(() => {
        return () => {
            // 確認待ちの入室処理があれば打ち切る（stillTarget が false になる）
            joinedIdRef.current = null;
            leaveWorldRef.current();
            resetWorld();
        };
    }, [resetWorld]);

    useEffect(() => {
        if (authPending) return;
        if (joinedIdRef.current === instanceId) return;

        // 対象 id を同期的に確保する。以降の await 中に別 id へ移動・アンマウントされたら
        // joinedIdRef が変わるので、それを見て古い入室処理を打ち切る（確認待ちでも二重入室しない）。
        const previousId = joinedIdRef.current;
        joinedIdRef.current = instanceId;
        const stillTarget = () => joinedIdRef.current === instanceId;

        const connect = async () => {
            // 前のインスタンスからの退出完了を待ってから join する
            if (previousId) {
                await leaveWorldRef.current();
                resetWorld();
            }
            if (!stillTarget()) return;

            // 作者署名を検証できないワールドは、入室（= mod 実行）前に本人の確認を取る。
            // 取得できなければ署名の有無を確認できないので参加しない（確認を飛ばして入らない）。
            const fetched = await fetchInstance(instanceId).then(
                (instance) => ({ instance }),
                (e: unknown) => ({
                    error: e instanceof Error ? e.message : String(e),
                    gone: e instanceof InstanceNotFoundError,
                }),
            );
            if (!stillTarget()) return;
            if (!('instance' in fetched)) {
                joinedIdRef.current = null;
                setLoadError({ message: `入室できません: ${fetched.error}`, gone: fetched.gone });
                return;
            }
            const entryKey = unverifiedEntryKey(fetched.instance.world);
            if (entryKey && !hasAcceptedEntry(sessionStorage, entryKey)) {
                const accepted = await confirmEntry(unverifiedEntryMessage(fetched.instance.world));
                if (!stillTarget()) return;
                if (!accepted) {
                    joinedIdRef.current = null;
                    setLoadError({ message: ENTRY_DECLINED_MESSAGE, gone: false });
                    return;
                }
                acceptEntry(sessionStorage, entryKey);
            }
            if (!stillTarget()) return;
            setLoadError(null);

            // ワールドの中身はサーバー（Go）が snapshot で配る。クライアントは ID だけを渡す。
            joinWorld(userName, instanceId, (message) => {
                console.error('[WorldView] world:join failed:', message);
            });
        };
        void connect();
    }, [authPending, instanceId, userName, fetchInstance, confirmEntry, joinWorld, resetWorld]);

    const loading = useInstanceLoading({
        instanceId,
        isAuthPending: authPending,
        isConnected,
        isConnecting,
        isJoined: currentUser != null,
        error: error ?? loadError?.message ?? null,
        mods,
        workers,
    });

    const gone = !error && loadError?.gone === true;
    useEffect(() => {
        if (loading.failed && loading.failureMessage)
            onFailed?.({ message: loading.failureMessage, replaced: sessionReplaced, gone });
    }, [loading.failed, loading.failureMessage, sessionReplaced, gone, onFailed]);

    return (
        <>
            {loading.showScreen && (
                <InstanceLoadingScreen
                    worldName={preview?.displayName}
                    thumbnail={preview?.thumbnail}
                    progress={loading.progress}
                    stages={loading.stages}
                    fadingOut={loading.fadingOut}
                    failed={loading.failed}
                    failureMessage={loading.failureMessage}
                    recoveryLabel={recovery.label}
                    onRecover={recovery.run}
                />
            )}
            {!loading.failed && currentUser != null && (
                <main>
                    <ModRegistryProvider
                        key={instanceId}
                        onStatusChange={setMods}
                        lock={lock ?? modLock}
                        source={modSource}
                    >
                        <WorkerLoadingProvider onStatusChange={setWorkers}>
                            <WorldStage />
                        </WorkerLoadingProvider>
                    </ModRegistryProvider>
                    {children}
                </main>
            )}
            <CursorLayer fallbackSelfId={selfId} />
            <ServerNoticeToasts />
        </>
    );
}
