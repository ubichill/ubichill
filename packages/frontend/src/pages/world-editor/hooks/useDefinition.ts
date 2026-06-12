/**
 * WorldDefinition のロード / state 管理 / dirty 判定。
 *
 * - 初期値は `createInitialDefinition()`、編集モードなら worldId から fetch して上書き
 * - savedYaml は「最後にサーバーへ保存した状態の YAML」を保持し dirty 判定のベースにする
 * - updateEntities(mutate) は entity array を更新する便利関数
 */
import type { InitialEntity, WorldDefinition } from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import yaml from 'yaml';
import { API_BASE } from '@/lib/api';

const PLACEHOLDER_NAME = 'newworldplaceholder12';

function createInitialDefinition(): WorldDefinition {
    return {
        apiVersion: 'ubichill.com/v1alpha1',
        kind: 'World',
        metadata: { name: PLACEHOLDER_NAME, version: '1.0.0' },
        spec: {
            displayName: '',
            capacity: { default: 10, max: 20 },
            environment: {
                backgroundColor: '#F0F8FF',
                worldSize: { width: 2000, height: 1500 },
            },
            dependencies: [
                { name: 'pen', source: { type: 'repository', path: 'plugins/pen' } },
                { name: 'video-player', source: { type: 'repository', path: 'plugins/video-player' } },
            ],
            initialEntities: [],
        },
    };
}

interface UseDefinitionOptions {
    isEdit: boolean;
    worldId?: string;
    onError: (msg: string) => void;
}

interface UseDefinitionResult {
    definition: WorldDefinition;
    setDefinition: React.Dispatch<React.SetStateAction<WorldDefinition>>;
    savedYaml: string | null;
    setSavedYaml: React.Dispatch<React.SetStateAction<string | null>>;
    /** ロード中 (= edit モードで fetch 中) */
    loading: boolean;
    /** 保存以降に何か変更があったか */
    dirty: boolean;
    /** initialEntities 配列だけを更新する糖衣 */
    updateEntities: (mutate: (prev: InitialEntity[]) => InitialEntity[]) => void;
}

export function useDefinition({ isEdit, worldId, onError }: UseDefinitionOptions): UseDefinitionResult {
    const [definition, setDefinition] = useState<WorldDefinition>(createInitialDefinition);
    const [savedYaml, setSavedYaml] = useState<string | null>(null);
    const [loading, setLoading] = useState(isEdit);

    useEffect(() => {
        if (!isEdit || !worldId) return;
        const ctrl = new AbortController();
        setLoading(true);
        fetch(`${API_BASE}/api/v1/worlds/${worldId}/definition`, {
            credentials: 'include',
            signal: ctrl.signal,
        })
            .then(async (res) => {
                if (res.status === 403) throw new Error('このワールドの編集権限がありません');
                if (!res.ok) throw new Error(`定義取得失敗 (${res.status})`);
                const def = (await res.json()) as WorldDefinition;
                setDefinition(def);
                setSavedYaml(yaml.stringify(def));
            })
            .catch((e: unknown) => {
                if (e instanceof DOMException && e.name === 'AbortError') return;
                onError(e instanceof Error ? e.message : '読み込み失敗');
            })
            .finally(() => {
                if (ctrl.signal.aborted) return;
                setLoading(false);
            });
        return () => ctrl.abort();
    }, [worldId, isEdit, onError]);

    const dirty = useMemo(() => {
        if (savedYaml === null) return true;
        return yaml.stringify(definition) !== savedYaml;
    }, [definition, savedYaml]);

    const updateEntities = useCallback((mutate: (prev: InitialEntity[]) => InitialEntity[]) => {
        setDefinition((prev) => ({
            ...prev,
            spec: { ...prev.spec, initialEntities: mutate(prev.spec.initialEntities) },
        }));
    }, []);

    return { definition, setDefinition, savedYaml, setSavedYaml, loading, dirty, updateEntities };
}
