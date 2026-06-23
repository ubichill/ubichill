import { useEffect, useRef, useState } from 'react';

export type StageStatus = 'pending' | 'active' | 'done' | 'error';

export type StageId = 'auth' | 'connect' | 'join' | 'plugins' | 'workers';

export interface LoadingStage {
    id: StageId;
    label: string;
    status: StageStatus;
    /** 「2 / 5」のような進捗詳細（デバッグ・可視化用） */
    detail?: string;
}

interface UseInstanceLoadingParams {
    /** ロード対象のインスタンスID（変わったら内部状態をリセットする） */
    instanceId: string | undefined;
    /** 認証（セッション）確認中 */
    isAuthPending: boolean;
    /** Socket 接続済み */
    isConnected: boolean;
    /** world:join 成功（currentUser 確定） */
    isJoined: boolean;
    /** Socket / join のエラー文字列 */
    error: string | null;
    /** プラグイン（worker コード）ダウンロード進捗 */
    plugins: { completed: number; total: number };
    /** ワーカー起動進捗 */
    workers: { ready: number; total: number };
}

export interface InstanceLoadingState {
    /** ロード画面を DOM に残すべきか（フェードアウト中も true） */
    showScreen: boolean;
    /** フェードアウト中 */
    fadingOut: boolean;
    /** 0..100 の総合進捗（単調増加） */
    progress: number;
    stages: LoadingStage[];
    /** 失敗（タイムアウト or エラー）したか */
    failed: boolean;
    /** 失敗時のメッセージ */
    failureMessage: string | null;
}

/** 接続〜起動までの全体タイムアウト。これを超えたら失敗扱いでロビーへ戻す。 */
const TIMEOUT_MS = 25000;
/** join 直後にプラグイン登録を待つ猶予（シーン受信→loadPlugin までのラグを吸収）。 */
const GRACE_MS = 600;

const STAGE_LABELS: Record<StageId, string> = {
    auth: '認証',
    connect: 'サーバーへ接続',
    join: 'ワールドに参加',
    plugins: 'プラグインのダウンロード',
    workers: 'ワーカーの初期化',
};

/**
 * インスタンス接続のロード進行を段階ごとに正確に算出するフック。
 * - 各段階（認証 / 接続 / 参加 / DL / 初期化）のステータスと進捗
 * - エラー or タイムアウト時の失敗判定（ロビーへ戻す用）
 */
export function useInstanceLoading({
    instanceId,
    isAuthPending,
    isConnected,
    isJoined,
    error,
    plugins,
    workers,
}: UseInstanceLoadingParams): InstanceLoadingState {
    const [graceDone, setGraceDone] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const [failureMessage, setFailureMessage] = useState<string | null>(null);
    const [showScreen, setShowScreen] = useState(true);
    const [fadingOut, setFadingOut] = useState(false);

    const joinedAtRef = useRef<number | null>(null);
    const maxProgressRef = useRef(0);

    // インスタンス切り替え時は全状態をリセットし、タイムアウトを張り直す。
    // instanceId は本文で読まないが「リセットのトリガー」として依存に必要。
    // biome-ignore lint/correctness/useExhaustiveDependencies: instanceId は意図的なリセットトリガー
    useEffect(() => {
        joinedAtRef.current = null;
        maxProgressRef.current = 0;
        setGraceDone(false);
        setTimedOut(false);
        setFailureMessage(null);
        setShowScreen(true);
        setFadingOut(false);

        const timer = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [instanceId]);

    // join 後の猶予タイマー（プラグインが登録される時間を確保）
    useEffect(() => {
        if (!isJoined) {
            joinedAtRef.current = null;
            setGraceDone(false);
            return;
        }
        if (joinedAtRef.current !== null) return;
        joinedAtRef.current = Date.now();
        const timer = setTimeout(() => setGraceDone(true), GRACE_MS);
        return () => clearTimeout(timer);
    }, [isJoined]);

    const pluginsPending = plugins.total - plugins.completed;
    const workersPending = workers.total - workers.ready;

    const stageDone: Record<StageId, boolean> = {
        auth: !isAuthPending,
        connect: !isAuthPending && isConnected,
        join: isConnected && isJoined,
        plugins: isJoined && graceDone && pluginsPending <= 0,
        workers: isJoined && graceDone && workersPending <= 0,
    };

    const order: StageId[] = ['auth', 'connect', 'join', 'plugins', 'workers'];
    const activeIndex = order.findIndex((id) => !stageDone[id]);
    const complete = activeIndex === -1;

    // 失敗判定（一度確定したら latch する）。
    // タイムアウトでロビーに戻すのは「まだ join できていない（=本当に入れていない）」
    // 場合だけにする。join 済みなら instance には入れているので、プラグイン/ワーカーが
    // 25 秒で揃わなくても（例: 動画ストリームの QUIC アイドルタイムアウトで worker が
    // ready を返さない等）ロビーに蹴り返さず、そのまま入室を維持する。
    useEffect(() => {
        if (failureMessage) return;
        if (error && !isJoined) {
            setFailureMessage(error);
        } else if (timedOut && !complete && !isJoined) {
            setFailureMessage('インスタンスへの接続がタイムアウトしました');
        }
    }, [error, isJoined, timedOut, complete, failureMessage]);

    const failed = failureMessage !== null;

    // join 済みで時間切れになったら、未完了の段階があってもロード画面を畳んで入室する
    // （グレースフルに入れる。残りの worker はバックグラウンドで読み込み続ける）。
    const done = complete || (timedOut && isJoined);

    // フェードアウト制御
    useEffect(() => {
        if (failed) {
            setShowScreen(true);
            setFadingOut(false);
            return;
        }
        if (done) {
            setFadingOut(true);
            const timer = setTimeout(() => setShowScreen(false), 500);
            return () => clearTimeout(timer);
        }
        setShowScreen(true);
        setFadingOut(false);
    }, [done, failed]);

    // 進捗（重み付け）— auth10 / connect20 / join20 / plugins25 / workers25
    const detailFraction = (completed: number, total: number, joined: boolean) => {
        if (total > 0) return completed / total;
        return joined ? 1 : 0;
    };
    const rawProgress =
        (stageDone.auth ? 10 : 0) +
        (stageDone.connect ? 20 : 0) +
        (stageDone.join ? 20 : 0) +
        (stageDone.plugins ? 25 : isJoined ? detailFraction(plugins.completed, plugins.total, graceDone) * 25 : 0) +
        (stageDone.workers ? 25 : isJoined ? detailFraction(workers.ready, workers.total, graceDone) * 25 : 0);
    maxProgressRef.current = Math.max(maxProgressRef.current, Math.min(100, rawProgress));
    const progress = Math.round(maxProgressRef.current);

    const stages: LoadingStage[] = order.map((id, i) => {
        const status: StageStatus = stageDone[id]
            ? 'done'
            : i === activeIndex
              ? failed
                  ? 'error'
                  : 'active'
              : 'pending';
        const detail =
            id === 'plugins' && plugins.total > 0
                ? `${plugins.completed} / ${plugins.total}`
                : id === 'workers' && workers.total > 0
                  ? `${workers.ready} / ${workers.total}`
                  : undefined;
        return { id, label: STAGE_LABELS[id], status, detail };
    });

    return { showScreen, fadingOut, progress, stages, failed, failureMessage };
}
