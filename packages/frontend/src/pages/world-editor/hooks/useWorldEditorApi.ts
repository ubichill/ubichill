import type { WorldDefinition } from '@ubichill/shared';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import yaml from 'yaml';
import { fetchMyAccount } from '@/lib/account/me';
import { API_BASE } from '@/lib/api';
import { createInstance as createInstanceApi } from '@/lib/instancesApi';
import {
    authorSignerFor,
    browserFetch,
    createHostedWorld,
    type PublishReadiness,
    publishReadiness,
    saveHostedDraft,
    updateHostedWorld,
} from '@/lib/signing';
import { buildWorldLock } from '@/mods/buildWorldLock';
import type { PublishState } from './useDefinition';
import type { PublishDecision } from './usePublishSetup';

interface UseWorldEditorApiArgs {
    isEdit: boolean;
    worldId?: string;
    definition: WorldDefinition;
    onSavedYamlChange: (text: string) => void;
    /** 公開状態の更新（公開した・下書きを保存した） */
    onPublishStateChange: React.Dispatch<React.SetStateAction<PublishState>>;
    /** エラーメッセージの通知先 (ページ側で集約管理する) */
    onError: (msg: string) => void;
    /** 公開の準備が足りないとき、公開の準備ダイアログで利用者の操作を待つ */
    requestPublishSetup: (readiness: Exclude<PublishReadiness, { kind: 'ready' }>) => Promise<PublishDecision>;
}

/**
 * 保存時に mod 完全性ロックを計算する。lock は人間が書く YAML には埋めず、body の別フィールドで送って
 * サーバ側の別カラムに保存する（YAML はクリーンに保つ）。読む側はこの lock と hash 照合して差し替え mod を拒否する。
 */
async function buildSaveBody(definition: WorldDefinition) {
    const { lock, unpinned } = await buildWorldLock(definition);
    return { body: { yaml: yaml.stringify(definition), lock }, unpinned };
}

const deps = { apiBase: API_BASE, fetch: browserFetch };

/**
 * ワールドの保存・公開・削除・インスタンス作成 API 呼び出しを集約する hook。
 * - saveDraft: 下書き保存。鍵・ID などの準備は不要で、公開中の版は変えない。
 * - publish: 作者アカウントで署名して公開する。鍵の用意と公開環境の登録は自動（ID が無ければその場で決めてもらう）。
 */
export function useWorldEditorApi({
    isEdit,
    worldId,
    definition,
    onSavedYamlChange,
    onPublishStateChange,
    onError,
    requestPublishSetup,
}: UseWorldEditorApiArgs) {
    const navigate = useNavigate();
    const [saving, setSaving] = useState(false);

    const withSaving = useCallback(
        async (task: () => Promise<boolean>, failure: string): Promise<boolean> => {
            setSaving(true);
            onError('');
            try {
                return await task();
            } catch (e) {
                onError(e instanceof Error ? e.message : failure);
                return false;
            } finally {
                setSaving(false);
            }
        },
        [onError],
    );

    const saveDraft = useCallback(
        () =>
            withSaving(async () => {
                const { body } = await buildSaveBody(definition);
                if (isEdit && worldId) {
                    const { hasDraft } = await saveHostedDraft(worldId, body, deps);
                    onSavedYamlChange(body.yaml);
                    // 署名済みなら公開状態はそのままで下書きが増える。未署名なら本体に保存され下書きは無い。
                    onPublishStateChange((prev) => (hasDraft ? { ...prev, hasDraft } : { published: false, hasDraft }));
                    return true;
                }
                const created = await createHostedWorld(body, null, deps);
                navigate(`/world/${created.id}/edit`, { replace: true });
                return true;
            }, '下書きを保存できませんでした'),
        [definition, isEdit, worldId, navigate, onSavedYamlChange, onPublishStateChange, withSaving],
    );

    const publish = useCallback(
        () =>
            withSaving(async () => {
                const { body, unpinned } = await buildSaveBody(definition);
                const readiness = publishReadiness(await fetchMyAccount().catch(() => null), unpinned);
                const decision: PublishDecision =
                    readiness.kind === 'ready'
                        ? { kind: 'continue', account: readiness.account }
                        : await requestPublishSetup(readiness);
                if (decision.kind === 'cancel') return false;
                const signer = await authorSignerFor(decision.account);

                if (isEdit && worldId) {
                    await updateHostedWorld(worldId, body, signer, deps);
                    onSavedYamlChange(body.yaml);
                    onPublishStateChange({ published: true, hasDraft: false });
                    return true;
                }
                const created = await createHostedWorld(body, signer, deps);
                if (created.signError)
                    onError(`作成しましたが公開できませんでした（下書きのままです）: ${created.signError}`);
                navigate(`/world/${created.id}/edit`, { replace: true });
                return true;
            }, '公開できませんでした'),
        [
            definition,
            isEdit,
            worldId,
            navigate,
            onSavedYamlChange,
            onPublishStateChange,
            onError,
            requestPublishSetup,
            withSaving,
        ],
    );

    const remove = useCallback(async () => {
        if (!worldId) return;
        if (!window.confirm('このワールドを削除しますか？この操作は取り消せません。')) return;
        setSaving(true);
        onError('');
        try {
            const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!res.ok && res.status !== 204) {
                const data = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(data.error ?? `HTTP ${res.status}`);
            }
            navigate('/');
        } catch (e) {
            onError(e instanceof Error ? e.message : '削除失敗');
            setSaving(false);
        }
    }, [worldId, navigate, onError]);

    const createInstance = useCallback(async () => {
        if (!worldId) return;
        setSaving(true);
        onError('');
        try {
            const inst = await createInstanceApi(worldId);
            navigate(`/instance/${inst.id}`, { state: { worldId } });
        } catch (e) {
            onError(e instanceof Error ? e.message : 'インスタンス作成失敗');
            setSaving(false);
        }
    }, [worldId, navigate, onError]);

    return { saving, saveDraft, publish, remove, createInstance };
}
