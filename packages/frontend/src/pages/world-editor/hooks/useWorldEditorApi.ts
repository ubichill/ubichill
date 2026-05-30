import type { WorldDefinition } from '@ubichill/shared';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import yaml from 'yaml';
import { API_BASE } from '@/lib/api';

interface UseWorldEditorApiArgs {
    isEdit: boolean;
    worldId?: string;
    definition: WorldDefinition;
    onSavedYamlChange: (text: string) => void;
}

/**
 * ワールドの保存・削除・インスタンス作成 API 呼び出しを集約する hook。
 * 状態は saving / error の 2 つだけ。成功時は呼び出し元の savedYaml も更新する。
 */
export function useWorldEditorApi({ isEdit, worldId, definition, onSavedYamlChange }: UseWorldEditorApiArgs) {
    const navigate = useNavigate();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const save = useCallback(async () => {
        setSaving(true);
        setError('');
        try {
            const text = yaml.stringify(definition);
            const url =
                isEdit && worldId ? `${API_BASE}/api/v1/worlds/${worldId}/yaml` : `${API_BASE}/api/v1/worlds/yaml`;
            const method = isEdit ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ yaml: text }),
            });
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(data.error ?? `HTTP ${res.status}`);
            }
            // 新規作成: サーバー生成の worldId で編集画面に遷移して以降は dirty 解消できる状態に
            if (!isEdit) {
                const created = (await res.json()) as { id: string };
                navigate(`/world/${created.id}/edit`, { replace: true });
                return;
            }
            // 編集モード: dirty=false にするため savedYaml を更新
            onSavedYamlChange(text);
        } catch (e) {
            setError(e instanceof Error ? e.message : '保存失敗');
        } finally {
            setSaving(false);
        }
    }, [definition, isEdit, worldId, navigate, onSavedYamlChange]);

    const remove = useCallback(async () => {
        if (!worldId) return;
        if (!window.confirm('このワールドを削除しますか？この操作は取り消せません。')) return;
        setSaving(true);
        setError('');
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
            setError(e instanceof Error ? e.message : '削除失敗');
            setSaving(false);
        }
    }, [worldId, navigate]);

    const createInstance = useCallback(async () => {
        if (!worldId) return;
        setSaving(true);
        setError('');
        try {
            const res = await fetch(`${API_BASE}/api/v1/instances`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ worldId }),
            });
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(data.error ?? `HTTP ${res.status}`);
            }
            const inst = (await res.json()) as { id: string };
            navigate(`/instance/${inst.id}`, { state: { worldId } });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'インスタンス作成失敗');
            setSaving(false);
        }
    }, [worldId, navigate]);

    return { saving, error, setError, save, remove, createInstance };
}
