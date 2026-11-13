import { type ModLock, type WorldDefinition, withoutWorldLock } from '@ubichill/shared';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import yaml from 'yaml';
import { fetchMyAccount } from '@/lib/account/me';
import { API_BASE } from '@/lib/api';
import { MOD_CDN_URL } from '@/lib/mods/modCdn';
import {
    authorSignerFor,
    browserFetch,
    type PublishReadiness,
    publishReadiness,
    type SavedWorld,
    saveWorldBundle,
} from '@/lib/signing';
import { createInstance as createInstanceApi } from '@/lib/worlds/instancesApi';
import { buildWorldLock } from '@/world';
import { type ActionFailure, type FailureStage, inStage, toActionFailure } from '../lib/actionFailure';
import { nextPublishVersion } from '../lib/publishVersion';
import type { PublishState } from './useDefinition';
import type { PublishDecision } from './usePublishSetup';

/** 保存・公開の結果。利用者が取りやめたときは通知しない。 */
export type SaveResult = { ok: true; stage: FailureStage } | ({ ok: false } & ActionFailure);

interface UseWorldEditorApiArgs {
    isEdit: boolean;
    worldId?: string;
    definition: WorldDefinition;
    /** 公開状態（公開中の版から、公開に使う版を決める） */
    publishState: PublishState;
    /** 最後に保存してから変えたか */
    dirty: boolean;
    /** 保存した YAML・lock・版（公開で版を上げたときはエディタの定義にも反映する） */
    onSavedYamlChange: (text: string, lock: ModLock, version: string) => void;
    /** 公開状態の更新（公開した・下書きを保存した） */
    onPublishStateChange: React.Dispatch<React.SetStateAction<PublishState>>;
    /** 保存・公開の結果の通知先（ページ側でコンソールと通知に出す） */
    onResult: (result: SaveResult) => void;
    /** 削除・インスタンス作成の失敗の通知先 */
    onError: (msg: string) => void;
    /** 公開の準備が足りないとき、公開の準備ダイアログで利用者の操作を待つ */
    requestPublishSetup: (
        readiness: Exclude<PublishReadiness, { kind: 'ready' }>,
        purpose?: 'publish' | 'save',
    ) => Promise<PublishDecision>;
}

/**
 * 保存時に mod 完全性ロックを計算する。lock は人間が書く YAML には埋めず、body の別フィールドで送って
 * サーバ側の別カラムに保存する（YAML はクリーンに保つ）。読む側はこの lock と hash 照合して差し替え mod を拒否する。
 */
async function buildSaveBody(definition: WorldDefinition, worldId: string | undefined) {
    const { lock, unpinned } = await inStage('build', () => buildWorldLock(definition, MOD_CDN_URL));
    return { body: { yaml: yaml.stringify(withoutWorldLock(definition)), lock, worldId }, unpinned };
}

const deps = { apiBase: API_BASE, fetch: browserFetch };

/**
 * ワールドの保存・公開・削除・インスタンス作成 API 呼び出しを集約する hook。
 * 保存はどれも同じ PUT（定義・lock・署名の組）で、同じワールドかは metadata.name で決まる。
 * - saveDraft: 署名せずに送る。公開中のワールドなら公開中の版は変えずに下書きになる（ID が無ければその場で決める）。
 * metadata.name を変えると名前の変更になる（同じワールドのまま URL が変わり、以前の URL からもたどれる）。
 * - publish: 作者アカウントで署名して公開する。鍵の用意と公開環境の登録は自動（ID が無ければその場で決めてもらう）。
 */
export function useWorldEditorApi({
    isEdit,
    worldId,
    definition,
    publishState,
    dirty,
    onSavedYamlChange,
    onPublishStateChange,
    onResult,
    onError,
    requestPublishSetup,
}: UseWorldEditorApiArgs) {
    const navigate = useNavigate();
    const [saving, setSaving] = useState(false);
    /** 最後の保存・公開の失敗。次に成功するまで残す。 */
    const [failure, setFailure] = useState<ActionFailure | null>(null);

    /** task が false を返したのは利用者が取りやめたとき（失敗ではない） */
    const withSaving = useCallback(
        async (task: () => Promise<boolean>, stage: FailureStage): Promise<boolean> => {
            setSaving(true);
            try {
                const done = await task();
                if (done) {
                    setFailure(null);
                    onResult({ ok: true, stage });
                }
                return done;
            } catch (e) {
                const next = toActionFailure(e, stage);
                setFailure(next);
                onResult({ ok: false, ...next });
                return false;
            } finally {
                setSaving(false);
            }
        },
        [onResult],
    );

    /** 新規作成か、metadata.name を変えて別のワールドとして保存したときは、保存先のワールドの編集に移る。 */
    const followSaved = useCallback(
        (saved: SavedWorld) => {
            if (!isEdit || saved.id !== worldId) navigate(`/world/${saved.id}/edit`, { replace: true });
        },
        [isEdit, worldId, navigate],
    );

    const saveDraft = useCallback(
        () =>
            withSaving(async () => {
                // ワールドの URL は /@ID/名前 なので、アカウントを取れなければ保存先が決まらない
                const account = await fetchMyAccount().catch(() => null);
                if (!account) {
                    await requestPublishSetup({ kind: 'no-account' }, 'save');
                    return false;
                }
                const { body } = await buildSaveBody(definition, isEdit ? worldId : undefined);
                const saved = await saveWorldBundle(body, null, deps);
                onSavedYamlChange(body.yaml, body.lock, definition.metadata.version);
                // 公開中なら公開状態はそのままで下書きが増える。未公開なら本体に保存され下書きは無い。
                onPublishStateChange((prev) =>
                    saved.saved === 'draft'
                        ? { ...prev, hasDraft: true }
                        : { published: false, hasDraft: false, publishedVersion: null },
                );
                followSaved(saved);
                return true;
            }, 'save'),
        [
            definition,
            isEdit,
            worldId,
            onSavedYamlChange,
            onPublishStateChange,
            requestPublishSetup,
            followSaved,
            withSaving,
        ],
    );

    const publish = useCallback(
        () =>
            withSaving(async () => {
                const version = nextPublishVersion({
                    version: definition.metadata.version,
                    publishedVersion: publishState.publishedVersion,
                    changed: dirty || publishState.hasDraft,
                });
                const target = { ...definition, metadata: { ...definition.metadata, version } };
                const { body, unpinned } = await buildSaveBody(target, isEdit ? worldId : undefined);
                const readiness = publishReadiness(await fetchMyAccount().catch(() => null), unpinned);
                const decision: PublishDecision =
                    readiness.kind === 'ready'
                        ? { kind: 'continue', account: readiness.account }
                        : await requestPublishSetup(readiness);
                if (decision.kind === 'cancel') return false;
                const signer = await authorSignerFor(decision.account);
                const saved = await saveWorldBundle(body, signer, deps);
                onSavedYamlChange(body.yaml, body.lock, version);
                onPublishStateChange({ published: true, hasDraft: false, publishedVersion: version });
                followSaved(saved);
                return true;
            }, 'publish'),
        [
            definition,
            publishState,
            dirty,
            isEdit,
            worldId,
            onSavedYamlChange,
            onPublishStateChange,
            requestPublishSetup,
            followSaved,
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

    return { saving, failure, saveDraft, publish, remove, createInstance };
}
