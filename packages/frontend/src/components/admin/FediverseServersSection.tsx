import { MAX_FEATURED_FEDIVERSE_SERVERS } from '@ubichill/shared';
import { useCallback, useEffect, useId, useState } from 'react';
import { FediverseServerCard } from '@/components/auth/FediverseServerCard';
import { HudIcon } from '@/components/hud/HudIcon';
import { useFediverseServer } from '@/lib/account/fediverseSignIn';
import { movedServers } from '@/lib/admin/featuredServerOrder';
import {
    addFeaturedServer,
    fetchFeaturedServers,
    removeFeaturedServer,
    reorderFeaturedServers,
} from '@/lib/admin/fediverseServersApi';
import { css } from '@/styled-system/css';
import { adminButton, adminError, adminField, adminIconButton, adminList, adminRow, adminTag } from './adminStyles';

/**
 * ログイン画面に並べるサーバー（管理者）。押すとそのままそのサーバーの認証画面へ進む入口で、並べていないサーバーも
 * 「その他のサーバー」から使える。変えるとすぐ反映する（確定のボタンは挟まない）。
 */
export function FediverseServersSection() {
    const [servers, setServers] = useState<string[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = useCallback(async (action: () => Promise<string[]>) => {
        setBusy(true);
        setError(null);
        try {
            setServers(await action());
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : '変えられませんでした');
            // ほかの管理者が変えた後かもしれないので読み直す
            setServers(await fetchFeaturedServers().catch(() => null));
            return false;
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => {
        fetchFeaturedServers()
            .then(setServers)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : '読み込めませんでした'));
    }, []);

    const full = (servers?.length ?? 0) >= MAX_FEATURED_FEDIVERSE_SERVERS;

    return (
        <section className={section}>
            <h2 className={heading}>ログイン画面に並べるサーバー</h2>
            <p className={lead}>
                フェディバースのボタンを押すと、この順に並びます。押すとそのサーバーの認証画面へ進みます。並べていないサーバーも「その他のサーバー」から使えます。
            </p>
            {error && <p className={adminError}>{error}</p>}
            {servers && servers.length === 0 && (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                    並べているサーバーはありません（ログイン画面には「その他のサーバー」だけが出ます）。
                </p>
            )}
            {servers && servers.length > 0 && (
                <ol className={adminList}>
                    {servers.map((host, index) => (
                        <FeaturedRow
                            key={host}
                            host={host}
                            busy={busy}
                            first={index === 0}
                            last={index === servers.length - 1}
                            onMove={(by) => void run(() => reorderFeaturedServers(movedServers(servers, index, by)))}
                            onRemove={() => void run(() => removeFeaturedServer(host))}
                        />
                    ))}
                </ol>
            )}
            {servers && (
                <AddServer
                    busy={busy}
                    full={full}
                    count={servers.length}
                    onAdd={(host) => run(() => addFeaturedServer(host))}
                />
            )}
        </section>
    );
}

function FeaturedRow({
    host,
    busy,
    first,
    last,
    onMove,
    onRemove,
}: {
    host: string;
    busy: boolean;
    first: boolean;
    last: boolean;
    onMove: (by: -1 | 1) => void;
    onRemove: () => void;
}) {
    const server = useFediverseServer(host, 0);
    // 未対応・許可の外になったサーバーは、ログイン画面では出ない。管理者には外すよう印を出す
    const unusable = server.state === 'error' && server.code !== 'server-unreachable' && server.code !== null;
    return (
        <li className={adminRow()}>
            <span className={css({ flex: 1, minW: 0 })}>
                <FediverseServerCard host={host} server={server.state === 'found' ? server.server : null} size="sm" />
            </span>
            {unusable && <span className={adminTag()}>ログイン画面に出ません</span>}
            <button
                type="button"
                className={adminIconButton}
                disabled={busy || first}
                aria-label={`${host} を上へ`}
                onClick={() => onMove(-1)}
            >
                <HudIcon name="chevronUp" size={16} />
            </button>
            <button
                type="button"
                className={adminIconButton}
                disabled={busy || last}
                aria-label={`${host} を下へ`}
                onClick={() => onMove(1)}
            >
                <HudIcon name="chevronDown" size={16} />
            </button>
            <button
                type="button"
                className={adminIconButton}
                disabled={busy}
                aria-label={`${host} を外す`}
                onClick={onRemove}
            >
                <HudIcon name="trash" size={16} />
            </button>
        </li>
    );
}

function AddServer({
    busy,
    full,
    count,
    onAdd,
}: {
    busy: boolean;
    full: boolean;
    count: number;
    onAdd: (host: string) => Promise<boolean>;
}) {
    const id = useId();
    const [draft, setDraft] = useState('');
    const server = useFediverseServer(draft, 500);
    const found = server.state === 'found' ? server.server : null;
    return (
        <form
            className={css({ display: 'flex', flexDirection: 'column', gap: '2', mt: '3' })}
            onSubmit={(e) => {
                e.preventDefault();
                if (!found) return;
                void onAdd(found.host).then((added) => {
                    if (added) setDraft('');
                });
            }}
        >
            <label htmlFor={id} className={css({ fontSize: '13px', fontWeight: '600', color: 'text' })}>
                サーバーを足す（{count} / {MAX_FEATURED_FEDIVERSE_SERVERS}）
            </label>
            <div className={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}>
                <input
                    id={id}
                    className={adminField({ grow: true })}
                    type="text"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="misskey.example"
                    value={draft}
                    disabled={full}
                    onChange={(e) => setDraft(e.target.value)}
                />
                <button type="submit" className={adminButton({ tone: 'primary' })} disabled={busy || full || !found}>
                    足す
                </button>
            </div>
            <div role="status" className={css({ minH: '28px' })}>
                {full && <p className={hint}>上限まで並んでいます。足すには、どれかを外してください。</p>}
                {!full && server.state === 'checking' && <p className={hint}>確かめています...</p>}
                {!full && server.state === 'error' && <p className={adminError}>{server.error}</p>}
                {!full && found && <FediverseServerCard host={found.host} server={found} size="sm" />}
            </div>
        </form>
    );
}

const section = css({ p: '4', bg: 'surface', borderRadius: '12px' });
const heading = css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '1' });
const lead = css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6', mb: '3' });
const hint = css({ fontSize: '13px', color: 'textMuted' });
