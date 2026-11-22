import { useSocket } from '@ubichill/react';
import { type Instance, roomPortalAddressFor } from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { InstanceHUD } from '@/components/hud/InstanceHUD';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { signInPath } from '@/lib/account/authEntry';
import {
    afterInstanceFailure,
    type InstanceEntryState,
    readInstanceEntryState,
    recordEntryOutcome,
} from '@/lib/home/home';
import { HOST_MOD_SOURCE } from '@/lib/mods/modCdn';
import { useSession } from '@/lib/session';
import { useBlocks } from '@/lib/social/blocks';
import { blockedAuthorsOf, blockedIdsOf } from '@/lib/social/blocksState';
import { dismissToast, pushToast } from '@/lib/toast';
import { createInstance, fetchInstance, fetchInstances, fetchWorld } from '@/lib/worlds/instancesApi';
import { createPortalLookup, portalWorldRef } from '@/lib/worlds/portalDestination';
import { portalRoomPath } from '@/lib/worlds/portalPath';
import { ROOM_PORTAL_REFUSAL_MESSAGES, roomPortalRefusal } from '@/lib/worlds/roomPortalEntry';
import { useRemoteVisit } from '@/lib/worlds/useRemoteVisit';
import { worldPortalInstance } from '@/lib/worlds/worldPortalEntry';
import { type InstanceFailure, InstanceNotFoundError, type PortalGoal, WorldView } from '@/world';

/** 失敗したら一定時間後に自動でホームへ戻す（ロード画面で詰まらないように）。 */
const RETURN_HOME_MS = 5000;

const RETRY_MESSAGE = '元の部屋には入れませんでした';

/** 部屋を引く。無い・見る人に見えない部屋（404）は null、ほかの失敗はそのまま。 */
const fetchRoomOrGone = (address: string): Promise<Instance | null> =>
    fetchInstance(address).catch((error: unknown) => {
        if (error instanceof InstanceNotFoundError) return null;
        throw error;
    });

/**
 * ポータルで入る部屋。入れなければトーストを出して null（今の部屋に残る）。
 * - ワールドに置くポータル: 行き先のワールドのパブリックの部屋（無ければ作る）
 * - 部屋へのポータル: その部屋を引き直して入れるか確かめる（ポータルの鍵は少し前に引いたもの）
 */
function portalRoom(goal: PortalGoal, currentRoom: string, viewerId: string): Promise<string | null> {
    if (goal.kind === 'room') {
        const room = roomPortalAddressFor(goal.room, currentRoom);
        return roomPortalRefusal(fetchRoomOrGone, room, viewerId).then((refusal) => {
            if (!refusal) return room;
            pushToast(ROOM_PORTAL_REFUSAL_MESSAGES[refusal], 'warn');
            return null;
        });
    }
    return worldPortalInstance({ fetchWorld, fetchInstances, createInstance }, portalWorldRef(goal), viewerId).then(
        (instance) => instance.id,
        (e: unknown) => {
            pushToast(e instanceof Error ? e.message : 'ポータルの先の部屋に入れませんでした', 'error');
            return null;
        },
    );
}

/**
 * SNS のインスタンス画面。ワールドを動かすのは `WorldView` で、ここは認証の確認・ホームへの導線・HUD を足すだけ。
 * ホーム・共有 URL・他人のインスタンスなど入口は複数あるが、必ずここを通る。
 */
export function InstancePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { id } = useParams<{ id: string }>();
    const { data: session, isPending } = useSession();
    const confirm = useConfirm();

    useEffect(() => {
        if (!isPending && !session) navigate(signInPath(`${location.pathname}${location.search}`));
    }, [isPending, session, navigate, location.pathname, location.search]);

    // 部屋を移ってもこのページは作り直されないので、入った部屋ごとに読む
    const entry = useMemo(() => readInstanceEntryState(location.state), [location.state]);
    const [failed, setFailed] = useState<{ instanceId: string; failure: InstanceFailure } | null>(null);
    const failure = failed && failed.instanceId === id ? failed.failure : null;
    const handleFailed = useCallback(
        (next: InstanceFailure) => {
            if (id) setFailed({ instanceId: id, failure: next });
        },
        [id],
    );
    const path = `${location.pathname}${location.search}`;
    // 入れなかった部屋は履歴に残さない（戻るでまた入れない部屋を開かない）
    const toHome = useCallback(() => {
        const next = afterInstanceFailure(failure ?? { replaced: false, gone: false }, entry, path);
        if (next.kind === 'home' && next.autoHomeFailed) recordEntryOutcome(sessionStorage, 'autoHomeFailed');
        navigate('/', { replace: true, state: next.kind === 'home' ? next.state : {} });
    }, [entry, failure, navigate, path]);
    useEffect(() => {
        if (!failure) return;
        const next = afterInstanceFailure(failure, entry, path);
        if (next.kind === 'stay') return;
        console.warn('[InstancePage] load failed → returning home:', failure.message);
        const timer = setTimeout(toHome, next.immediate ? 0 : RETURN_HOME_MS);
        return () => clearTimeout(timer);
    }, [entry, failure, path, toHome]);

    // 入れなかった部屋へ戻る導線は、ホームに入れてから出し、この部屋を出たら消す
    const retryToast = useRef<number | null>(null);
    const handleEntered = useCallback(() => {
        recordEntryOutcome(sessionStorage, 'entered');
        const { retryPath } = entry;
        if (!retryPath) return;
        retryToast.current = pushToast(
            RETRY_MESSAGE,
            'info',
            { label: '元の部屋をもう一度試す', run: () => navigate(retryPath) },
            { sticky: true },
        );
        navigate(path, { replace: true, state: { ...entry, retryPath: undefined } });
    }, [entry, navigate, path]);
    // biome-ignore lint/correctness/useExhaustiveDependencies: id は部屋を移ったときに消すための合図
    useEffect(
        () => () => {
            if (retryToast.current !== null) dismissToast(retryToast.current);
            retryToast.current = null;
        },
        [id],
    );

    // お知らせは 1 度だけ（読み込み直しで履歴の state からまた出さない）
    useEffect(() => {
        if (!entry.notice) return;
        pushToast(entry.notice, 'warn');
        navigate(location.pathname, { replace: true, state: { ...entry, notice: undefined } });
    }, [entry, location.pathname, navigate]);

    // ほかのサーバーの部屋にいる間は、ホームに来訪を知らせ続ける
    useRemoteVisit(id, !failure);

    // ブロックした人の一覧を読むまで入らない（読む前にその人の mod を読み込まないように）。読めなければ止めずに入る
    const blockState = useBlocks(session?.user.id);
    const blocksPending = !!session && blockState.blocks === null && blockState.error === null;
    const blocks = useMemo(
        () => ({ ids: blockedIdsOf(blockState), modAuthors: blockedAuthorsOf(blockState) }),
        [blockState],
    );
    useEffect(() => {
        if (blockState.error) pushToast('ブロックした人の一覧を読み込めませんでした', 'warn');
    }, [blockState.error]);

    const userName = session?.user.name ?? new URLSearchParams(location.search).get('name') ?? 'Guest';
    const preview = useMemo(
        () => ({ displayName: entry.worldData?.displayName, thumbnail: entry.worldData?.thumbnail }),
        [entry.worldData?.displayName, entry.worldData?.thumbnail],
    );
    // 別のタブに切られたときは、ここで入り直すかを本人が選ぶ（自動で戻すとタブ同士で取り合う）
    const recovery = useMemo(
        () =>
            failure?.replaced
                ? { label: 'このタブで入り直す', run: () => window.location.reload() }
                : { label: 'ホームに戻る', run: toHome },
        [failure?.replaced, toHome],
    );

    // ポータル（core:portal）: 確かめてから、入る部屋を決めて今の部屋を出る（決められなければ今の部屋に残る）
    const { leaveWorld } = useSocket();
    const viewerId = session?.user.id ?? null;
    const goThroughPortal = useCallback(
        async (goal: PortalGoal, label: string, look?: { displayName: string; thumbnail?: string }) => {
            if (!id || !viewerId || !(await confirm(`「${label}」へ移りますか？今の部屋から退出します。`))) return;
            const room = await portalRoom(goal, id, viewerId);
            if (!room) return;
            await leaveWorld();
            const state: InstanceEntryState | undefined = look ? { worldData: look } : undefined;
            navigate(portalRoomPath(room), { state });
        },
        [confirm, id, leaveWorld, navigate, viewerId],
    );

    // ポータルに出す行き先。部屋へのポータルは、見る人が入れるかも引く（入れるかは少しずつ引き直す）
    const portalLookup = useMemo(
        () =>
            createPortalLookup(fetchWorld, {
                fetch: (room) => fetchRoomOrGone(roomPortalAddressFor(room, id ?? '')),
                viewerId,
            }),
        [id, viewerId],
    );

    if (!id) return null;
    return (
        <WorldView
            instanceId={id}
            userName={userName}
            fetchInstance={fetchInstance}
            confirmEntry={confirm}
            modSource={HOST_MOD_SOURCE}
            authPending={isPending || blocksPending}
            selfId={session?.user?.id}
            blocks={blocks}
            preview={preview}
            recovery={recovery}
            onFailed={handleFailed}
            onEntered={handleEntered}
            onPortal={goThroughPortal}
            portalLookup={portalLookup}
        >
            <InstanceHUD />
        </WorldView>
    );
}
