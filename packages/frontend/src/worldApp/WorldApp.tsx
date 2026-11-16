/**
 * `world.html` の画面。同じオリジンの Go にゲストとして入り、同じオリジンの `/mods` から mod を取る。
 * ログイン・ホーム・router は無い。入るインスタンスは URL のパスで決まる（`/` は `default`）。
 *
 * dev サーバー（`ubichill dev`）が配るときは `<meta name="ubichill-dev">` が付き、世代（lock・部屋）を SSE から受け取る。
 * 読み込めなかった mod・mod のログ・dev サーバーの問題は、画面の下の端のコンソールに出す（ランチパッドが無いので）。
 */
import type { DevFailure } from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConsoleDock } from '@/components/console/ConsoleDock';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { addedMessages } from '@/lib/console/console';
import { logConsole } from '@/lib/console/consoleStore';
import { DEV_HOST, fetchGuestInstance, type ModSource, WorldView } from '@/world';
import { DevBar } from './DevPanel';
import { devFailureKey, devFailureLog } from './devConsole';
import { instanceIdFromPath, readDevMeta } from './location';
import { useDevGeneration } from './useDevGeneration';

const fetchInstance = (instanceId: string) => fetchGuestInstance('', instanceId);
const reload = () => window.location.reload();
const acceptEntry = async () => true;
const userNameFromQuery = () => new URLSearchParams(window.location.search).get('name') ?? 'Guest';
const requestReconfigure = () => void fetch('/__ubichill/reconfigure', { method: 'POST' });

export function WorldApp() {
    const dev = useMemo(() => readDevMeta(document), []);
    return dev ? <DevWorldApp /> : <GuestWorldApp />;
}

/** 自前ホスト: 入る部屋は URL のパス、lock は Go の snapshot のもの。 */
function GuestWorldApp() {
    const instanceId = useMemo(() => instanceIdFromPath(window.location.pathname), []);
    const userName = useMemo(userNameFromQuery, []);
    const modSource = useMemo<ModSource>(() => ({ baseUrl: '/mods', devHost: DEV_HOST }), []);
    const confirm = useConfirm();
    return (
        <>
            <WorldView
                instanceId={instanceId}
                userName={userName}
                fetchInstance={fetchInstance}
                confirmEntry={confirm}
                modSource={modSource}
                recovery={{ label: '再試行する', run: reload }}
            />
            <ConsoleDock />
        </>
    );
}

/** dev サーバー: 部屋と lock は世代ごと。手元のワールドなので作者の確認は出さない。 */
function DevWorldApp() {
    const { generation, failures, connected } = useDevGeneration();
    const userName = useMemo(userNameFromQuery, []);
    const modSource = useMemo<ModSource>(() => ({ baseUrl: '/mods', devHost: true }), []);
    const confirmEntry = useCallback(() => acceptEntry(), []);
    const [consoleOpen, setConsoleOpen] = useState(false);
    useLogDevFailures(failures, generation?.buildId);
    return (
        <>
            <DevBar
                buildId={generation?.buildId ?? null}
                instanceId={generation?.instanceId ?? null}
                connected={connected}
                onReconfigure={requestReconfigure}
                consoleOpen={consoleOpen}
                onToggleConsole={() => setConsoleOpen((v) => !v)}
            />
            {generation && (
                <WorldView
                    key={generation.buildId}
                    instanceId={generation.instanceId}
                    userName={userName}
                    fetchInstance={fetchInstance}
                    confirmEntry={confirmEntry}
                    modSource={modSource}
                    lock={generation.lock}
                    recovery={{ label: '再試行する', run: reload }}
                />
            )}
            <ConsoleDock open={consoleOpen} onOpenChange={setConsoleOpen} />
        </>
    );
}

/**
 * dev サーバーの問題のうち、新しく出たものをコンソールに溜める。
 * 世代が変わると WorldView が部屋に入り直してコンソールを空にするので、そのときは今の問題を全部もう一度溜める
 * （この effect は子の WorldView の effect より後に動くので、空にしたあとに入る）。
 */
function useLogDevFailures(failures: readonly DevFailure[], buildId: string | undefined) {
    const logged = useRef<{ buildId: string | undefined; keys: readonly string[] }>({ buildId: undefined, keys: [] });
    useEffect(() => {
        const keys = failures.map(devFailureKey);
        const before = logged.current.buildId === buildId ? logged.current.keys : [];
        for (const key of addedMessages(before, keys)) {
            const failure = failures[keys.indexOf(key)];
            if (failure) logConsole(devFailureLog(failure));
        }
        logged.current = { buildId, keys };
    }, [failures, buildId]);
}
