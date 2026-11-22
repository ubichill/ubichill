/**
 * WorldDefinition のロード / state 管理 / dirty 判定。
 *
 * - 初期値は `createInitialDefinition()`、編集モードなら worldId から fetch して上書き。`copyFrom` なら外部のワールドのコピーで始める
 * - savedYaml は「最後にサーバーへ保存した状態の YAML」を保持し dirty 判定のベースにする
 * - updateEntities(mutate) は entity array を更新する便利関数
 */
import {
    type InitialEntity,
    type ResolvedWorld,
    type WorldDefinition,
    type WorldVisibility,
    withoutWorldLock,
} from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import yaml from 'yaml';
import { API_BASE } from '@/lib/api';
import { loadWorldCopy } from '../lib/worldCopy';

/** 新しいワールドの metadata.name（作者のワールドの中で一意な識別子。保存後は変えない）。 */
const newWorldName = (): string =>
    Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');

function createInitialDefinition(): WorldDefinition {
    return {
        apiVersion: 'ubichill.com/v1alpha1',
        kind: 'World',
        metadata: { name: newWorldName(), version: '1.0.0' },
        spec: {
            displayName: '',
            capacity: { default: 10, max: 20 },
            environment: {
                backgroundColor: '#F0F8FF',
                worldSize: { width: 2000, height: 1500 },
            },
            dependencies: [],
            initialEntities: [],
        },
    };
}

interface UseDefinitionOptions {
    isEdit: boolean;
    worldId?: string;
    /** 新しいワールドを、この URL の外部のワールドのコピーから始める */
    copyFrom?: string;
    onError: (msg: string) => void;
    onCopied?: (sourceUrl: string) => void;
}

/** 公開状態。published = 一覧に公開中、hasDraft = 公開中の版とは別に未公開の下書きがある。 */
export interface PublishState {
    published: boolean;
    hasDraft: boolean;
    /** 公開中の版（metadata.version）。公開のたびに版を自動で上げるのに使う */
    publishedVersion: string | null;
}

interface UseDefinitionResult {
    publishState: PublishState;
    setPublishState: React.Dispatch<React.SetStateAction<PublishState>>;
    /** 作者の決めた公開範囲（定義の外。サーバーだけが持つ）。新しいワールドは保存するまで null */
    visibility: WorldVisibility | null;
    setVisibility: React.Dispatch<React.SetStateAction<WorldVisibility | null>>;
    definition: WorldDefinition;
    setDefinition: React.Dispatch<React.SetStateAction<WorldDefinition>>;
    savedYaml: string | null;
    setSavedYaml: React.Dispatch<React.SetStateAction<string | null>>;
    /** ロード中 (= edit モードで fetch 中) */
    loading: boolean;
    /** 読み込めなかった理由。読めないまま空のワールドを編集・保存させない */
    loadError: string | null;
    /** 保存以降に何か変更があったか */
    dirty: boolean;
    /** initialEntities 配列だけを更新する糖衣 */
    updateEntities: (mutate: (prev: InitialEntity[]) => InitialEntity[]) => void;
}

async function resolveExternalWorld(url: string, signal: AbortSignal) {
    const res = await fetch(`${API_BASE}/api/v1/worlds/resolve?url=${encodeURIComponent(url)}`, {
        credentials: 'include',
        signal,
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; source?: { url: string } };
    if (!res.ok || !body.source) throw new Error(body.error ?? `ワールドを読み込めません (${res.status})`);
    return body as ResolvedWorld;
}

async function fetchWorldYaml(url: string, signal: AbortSignal): Promise<string> {
    const res = await fetch(url, { headers: { Accept: 'application/yaml' }, signal }).catch(() => undefined);
    if (!res?.ok) throw new Error(`公開先からワールドの YAML を読めません${res ? ` (${res.status})` : ''}`);
    return res.text();
}

export function useDefinition({
    isEdit,
    worldId,
    copyFrom,
    onError,
    onCopied,
}: UseDefinitionOptions): UseDefinitionResult {
    const [definition, setDefinition] = useState<WorldDefinition>(createInitialDefinition);
    const [savedYaml, setSavedYaml] = useState<string | null>(null);
    const [loading, setLoading] = useState(isEdit || !!copyFrom);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [publishState, setPublishState] = useState<PublishState>({
        published: false,
        hasDraft: false,
        publishedVersion: null,
    });
    const [visibility, setVisibility] = useState<WorldVisibility | null>(null);

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
                if (res.status === 404) {
                    throw new Error(
                        'このワールドはこのサーバーにありません。外部に公開したワールドは、ワールドの詳細の「コピーして編集」から開けます',
                    );
                }
                if (!res.ok) throw new Error(`ワールドを読み込めません (${res.status})`);
                // 下書きがあれば下書きを編集する（公開中の版はサーバー側に残っている）
                const data = (await res.json()) as {
                    definition: WorldDefinition;
                    hasDraft: boolean;
                    published: boolean;
                    publishedVersion?: string | null;
                    visibility?: WorldVisibility;
                };
                setDefinition(data.definition);
                setSavedYaml(yaml.stringify(withoutWorldLock(data.definition)));
                setPublishState({
                    published: data.published,
                    hasDraft: data.hasDraft,
                    publishedVersion: data.publishedVersion ?? null,
                });
                setVisibility(data.visibility ?? 'public');
            })
            .catch((e: unknown) => {
                if (e instanceof DOMException && e.name === 'AbortError') return;
                const message = e instanceof Error ? e.message : '読み込み失敗';
                setLoadError(message);
                onError(message);
            })
            .finally(() => {
                if (ctrl.signal.aborted) return;
                setLoading(false);
            });
        return () => ctrl.abort();
    }, [worldId, isEdit, onError]);

    useEffect(() => {
        if (isEdit || !copyFrom) return;
        const ctrl = new AbortController();
        setLoading(true);
        loadWorldCopy(copyFrom, {
            resolve: (url) => resolveExternalWorld(url, ctrl.signal),
            fetchText: (url) => fetchWorldYaml(url, ctrl.signal),
            newName: newWorldName,
        })
            .then((copy) => {
                if (ctrl.signal.aborted) return;
                setDefinition(copy);
                setSavedYaml(null);
                onCopied?.(copyFrom);
            })
            .catch((e: unknown) => {
                if (ctrl.signal.aborted) return;
                const message = e instanceof Error ? e.message : '読み込み失敗';
                setLoadError(message);
                onError(message);
            })
            .finally(() => {
                if (ctrl.signal.aborted) return;
                setLoading(false);
            });
        return () => ctrl.abort();
    }, [copyFrom, isEdit, onError, onCopied]);

    const dirty = useMemo(() => {
        if (savedYaml === null) return true;
        return yaml.stringify(withoutWorldLock(definition)) !== savedYaml;
    }, [definition, savedYaml]);

    const updateEntities = useCallback((mutate: (prev: InitialEntity[]) => InitialEntity[]) => {
        setDefinition((prev) => ({
            ...prev,
            spec: { ...prev.spec, initialEntities: mutate(prev.spec.initialEntities) },
        }));
    }, []);

    return {
        definition,
        setDefinition,
        savedYaml,
        setSavedYaml,
        loading,
        loadError,
        dirty,
        updateEntities,
        publishState,
        setPublishState,
        visibility,
        setVisibility,
    };
}
