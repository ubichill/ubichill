/**
 * `world.html` の画面。同じオリジンの Go にゲストとして入り、同じオリジンの `/mods` から mod を取る。
 * ログイン・ホーム・router は無い。入るインスタンスは URL のパスで決まる（`/` は `default`）。
 *
 * dev サーバー（`ubichill dev`）が配るときは `<meta name="ubichill-dev">` が付き、世代（lock・部屋）を SSE から受け取る。
 */
import { useCallback, useMemo } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { DEV_HOST, fetchGuestInstance, type ModSource, WorldView } from '@/world';
import { DevBar, DevDiagnostics } from './DevPanel';
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
        <WorldView
            instanceId={instanceId}
            userName={userName}
            fetchInstance={fetchInstance}
            confirmEntry={confirm}
            modSource={modSource}
            recovery={{ label: '再試行する', run: reload }}
        />
    );
}

/** dev サーバー: 部屋と lock は世代ごと。手元のワールドなので作者の確認は出さない。 */
function DevWorldApp() {
    const { generation, failures, connected } = useDevGeneration();
    const userName = useMemo(userNameFromQuery, []);
    const modSource = useMemo<ModSource>(() => ({ baseUrl: '/mods', devHost: true }), []);
    const confirmEntry = useCallback(() => acceptEntry(), []);
    return (
        <>
            <DevBar
                buildId={generation?.buildId ?? null}
                instanceId={generation?.instanceId ?? null}
                connected={connected}
                onReconfigure={requestReconfigure}
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
            <DevDiagnostics failures={failures} />
        </>
    );
}
