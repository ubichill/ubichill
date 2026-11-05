/**
 * `world.html` の画面。同じオリジンの Go にゲストとして入り、同じオリジンの `/mods` から mod を取る。
 * ログイン・ロビー・router は無い。入るインスタンスは URL のパスで決まる（`/` は `default`）。
 */
import { useCallback, useMemo } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { DEV_HOST, fetchGuestInstance, type ModSource, WorldView } from '@/world';
import { instanceIdFromPath, readDevMeta } from './location';

const fetchInstance = (instanceId: string) => fetchGuestInstance('', instanceId);
const reload = () => window.location.reload();
const acceptEntry = async () => true;

export function WorldApp() {
    const dev = useMemo(() => readDevMeta(document), []);
    const instanceId = useMemo(() => instanceIdFromPath(window.location.pathname), []);
    const userName = useMemo(() => new URLSearchParams(window.location.search).get('name') ?? 'Guest', []);
    const modSource = useMemo<ModSource>(() => ({ baseUrl: '/mods', devHost: DEV_HOST || dev }), [dev]);
    const confirm = useConfirm();
    // dev サーバーが配るワールドは手元のものなので、作者の確認は出さない
    const confirmEntry = useCallback((message: string) => (dev ? acceptEntry() : confirm(message)), [dev, confirm]);
    return (
        <WorldView
            instanceId={instanceId}
            userName={userName}
            fetchInstance={fetchInstance}
            confirmEntry={confirmEntry}
            modSource={modSource}
            recovery={{ label: '再試行する', run: reload }}
        />
    );
}
