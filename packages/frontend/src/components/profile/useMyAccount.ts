import type { WorldIdentity } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { type ResignResult, resignAll } from '@/lib/account/resign';
import { API_BASE } from '@/lib/api';
import { authorSignerFor, browserFetch, signHostedWorld } from '@/lib/signing';
import type { OwnedWorld } from './OwnedWorldCard';

/** 自分のアカウント（`GET /api/v1/users/me`）。 */
export interface MyProfile {
    id: string;
    name: string;
    handle: string | null;
    author: string | null;
    signingKeys?: string[];
    displayNameConflict?: boolean;
    passwordChangeRequired?: boolean;
    passwordManagedBySecret?: boolean;
    isAdmin?: boolean;
    profileImageUrl: string | null;
    bio?: string | null;
}

/**
 * 設定の各タブ（プロフィール・ワールド・公開・アカウント）が使う自分のアカウントとワールド。
 * 署名し直し（鍵の用意は 1 回だけ）・削除・読み直しもここに置く。
 */
export function useMyAccount() {
    const [profile, setProfile] = useState<MyProfile | null>(null);
    const [worlds, setWorlds] = useState<OwnedWorld[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    /** 公開環境が増えたら一覧を取り直すためのキー */
    const [environmentsVersion, setEnvironmentsVersion] = useState(0);

    const reloadMyWorlds = useCallback(async () => {
        const res = await fetch(`${API_BASE}/api/v1/users/me/worlds`, { credentials: 'include' });
        if (res.ok) setWorlds(((await res.json()) as { worlds: OwnedWorld[] }).worlds);
    }, []);

    useEffect(() => {
        const ctrl = { cancelled: false };
        Promise.all([
            fetch(`${API_BASE}/api/v1/users/me`, { credentials: 'include' }),
            fetch(`${API_BASE}/api/v1/users/me/worlds`, { credentials: 'include' }),
        ])
            .then(async ([pRes, wRes]) => {
                if (!pRes.ok) throw new Error(`アカウントを取得できません (${pRes.status})`);
                if (!wRes.ok) throw new Error(`ワールドを取得できません (${wRes.status})`);
                const [p, w] = [(await pRes.json()) as MyProfile, (await wRes.json()) as { worlds: OwnedWorld[] }];
                if (ctrl.cancelled) return;
                setProfile(p);
                setWorlds(w.worlds);
            })
            .catch((e: unknown) => !ctrl.cancelled && setError(e instanceof Error ? e.message : '読み込み失敗'))
            .finally(() => !ctrl.cancelled && setLoading(false));
        return () => {
            ctrl.cancelled = true;
        };
    }, []);

    /**
     * 今の内容に作者アカウントで署名して公開する（鍵の用意・登録は自動）。取り消した鍵で署名したワールドを
     * まとめて署名し直すときも同じ処理を使う。
     */
    const signWorlds = async (worldIds: readonly string[]): Promise<ResignResult<WorldIdentity>> => {
        setError('');
        if (!profile?.author) {
            setError('公開するには、「公開」で ID を設定してください。');
            return { done: [], failed: worldIds.map((id) => ({ id, error: 'ID が未設定です' })) };
        }
        try {
            const signingKeys = profile.signingKeys ?? [];
            const signer = await authorSignerFor({ id: profile.id, author: profile.author, signingKeys });
            if (!signingKeys.includes(signer.key.publicKey)) {
                setProfile({ ...profile, signingKeys: [...signingKeys, signer.key.publicKey] });
                setEnvironmentsVersion((v) => v + 1);
            }
            const result = await resignAll(worldIds, (worldId) =>
                signHostedWorld(worldId, signer, { apiBase: API_BASE, fetch: browserFetch }),
            );
            const signed = new Map(result.done.map((d) => [d.id, d.identity]));
            setWorlds((prev) => prev.map((w) => (signed.has(w.id) ? { ...w, identity: signed.get(w.id) } : w)));
            if (worldIds.length === 1 && result.failed[0]) setError(result.failed[0].error);
            return result;
        } catch (e) {
            const message = e instanceof Error ? e.message : '署名に失敗しました';
            setError(message);
            return { done: [], failed: worldIds.map((id) => ({ id, error: message })) };
        }
    };

    const deleteWorld = async (worldId: string): Promise<boolean> => {
        const res = await fetch(`${API_BASE}/api/v1/worlds/${encodeURIComponent(worldId)}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (!res.ok) {
            setError(`削除に失敗しました (${res.status})`);
            return false;
        }
        setWorlds((prev) => prev.filter((w) => w.id !== worldId));
        return true;
    };

    return {
        profile,
        setProfile,
        worlds,
        loading,
        error,
        setError,
        environmentsVersion,
        signWorlds,
        reloadMyWorlds,
        deleteWorld,
    };
}

export type MyAccountState = ReturnType<typeof useMyAccount>;
