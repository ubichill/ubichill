import type { WorldDefinition } from '@ubichill/shared';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import yaml from 'yaml';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { fetchMyAccount } from '@/lib/account/me';
import { API_BASE } from '@/lib/api';
import { createInstance as createInstanceApi } from '@/lib/instancesApi';
import { createHostedWorld, loadSigningKey, signerFor, updateHostedWorld } from '@/lib/signing';
import { buildWorldLock } from '@/mods/buildWorldLock';

const UNSIGNED_SAVE_MESSAGE =
    'このブラウザに作者署名の鍵がありません。このまま保存すると未署名になり、一覧に公開されません（URL を知っている人だけが確認付きで入れます）。保存しますか？\n鍵はプロフィールの「作者署名の鍵」で作成・読み込みできます。';

interface UseWorldEditorApiArgs {
    isEdit: boolean;
    worldId?: string;
    definition: WorldDefinition;
    onSavedYamlChange: (text: string) => void;
    /** エラーメッセージの通知先 (ページ側で集約管理する) */
    onError: (msg: string) => void;
}

/**
 * ワールドの保存・削除・インスタンス作成 API 呼び出しを集約する hook。
 * 状態は saving のみ。エラーは onError 経由で外部へ通知する。
 * 成功時は呼び出し元の savedYaml も更新する。
 */
export function useWorldEditorApi({ isEdit, worldId, definition, onSavedYamlChange, onError }: UseWorldEditorApiArgs) {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const [saving, setSaving] = useState(false);

    const save = useCallback(async (): Promise<boolean> => {
        setSaving(true);
        onError('');
        try {
            // 保存時に mod 完全性ロックを計算する。lock は人間が書く YAML には埋めず、
            // body の別フィールドで送ってサーバ側の別カラムに保存する（YAML はクリーンに保つ）。
            // 外部公開時、そのワールドを読む側は兄弟エンドポイントの lock と hash 照合して
            // 差し替え mod の実行を拒否できる（配布者を信頼しない）。
            const lock = await buildWorldLock(definition);
            const text = yaml.stringify(definition);
            const body = { yaml: text, lock };
            const deps = { apiBase: API_BASE, fetch };

            // 鍵が無いまま保存すると未署名（非公開）になるので、黙って保存せず確認する。
            const [key, account] = await Promise.all([
                loadSigningKey().catch(() => null),
                fetchMyAccount().catch(() => null),
            ]);
            const signer = signerFor(key, account);
            if (!signer && !(await confirm(UNSIGNED_SAVE_MESSAGE))) return false;

            if (isEdit && worldId) {
                await updateHostedWorld(worldId, body, signer, deps);
                // 編集モード: dirty=false にするため savedYaml を更新
                onSavedYamlChange(text);
                return true;
            }
            // 新規作成: サーバー生成の worldId で編集画面に遷移して以降は dirty 解消できる状態に
            const created = await createHostedWorld(body, signer, deps);
            if (created.signError) onError(`保存しましたが署名できず非公開のままです: ${created.signError}`);
            navigate(`/world/${created.id}/edit`, { replace: true });
            return true;
        } catch (e) {
            onError(e instanceof Error ? e.message : '保存失敗');
            return false;
        } finally {
            setSaving(false);
        }
    }, [definition, isEdit, worldId, navigate, onSavedYamlChange, onError, confirm]);

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

    return { saving, save, remove, createInstance };
}
