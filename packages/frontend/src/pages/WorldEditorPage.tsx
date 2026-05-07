import { type InitialEntity, type WorldDefinition, WorldDefinitionSchema } from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import yaml from 'yaml';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { css } from '@/styled-system/css';
import { DEFAULT_H, DEFAULT_W, nextZ } from './editor/dragHelpers';
import { EditorAssets } from './editor/EditorAssets';
import { EditorHeader } from './editor/EditorHeader';
import { EditorHierarchy } from './editor/EditorHierarchy';
import { EditorStage } from './editor/EditorStage';
import { EntityInspector } from './editor/EntityInspector';
import { Modal } from './editor/Modal';
import { type AvailableEntityKind, useAvailableEntityKinds } from './editor/useAvailableEntityKinds';
import { WorldInfoForm } from './editor/WorldInfoForm';
import { YamlEditorForm } from './editor/YamlEditorForm';

// 新規作成時の placeholder name (21文字, lowercase)。サーバー側で nanoid に置き換えられる。
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
            // デフォルトプラグイン: avatar, pen, video-player（後からモーダルで増減できる）
            dependencies: [
                { name: 'avatar', source: { type: 'repository', path: 'plugins/avatar' } },
                { name: 'pen', source: { type: 'repository', path: 'plugins/pen' } },
                { name: 'video-player', source: { type: 'repository', path: 'plugins/video-player' } },
            ],
            initialEntities: [],
        },
    };
}

export function WorldEditorPage() {
    const { worldId } = useParams<{ worldId?: string }>();
    const navigate = useNavigate();
    const { data: session, isPending } = useSession();
    const isEdit = !!worldId;

    const [definition, setDefinition] = useState<WorldDefinition>(createInitialDefinition);
    /** DB に保存済みの YAML (編集モード初期ロード時にセットされ、保存成功時に更新)。
     *  これと yaml.stringify(definition) を比較して dirty を判定する。 */
    const [savedYaml, setSavedYaml] = useState<string | null>(null);

    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    /** エディタ画面上で非表示にしているエンティティの index 集合（保存には影響しない・編集ローカル状態） */
    const [hiddenIndices, setHiddenIndices] = useState<Set<number>>(new Set());
    const [openModal, setOpenModal] = useState<'info' | 'yaml' | null>(null);

    /** ワールド情報モーダル内の編集中 draft（適用ボタンで definition に反映） */
    const [infoDraft, setInfoDraft] = useState<WorldDefinition | null>(null);
    /** YAML モーダル内のテキスト draft */
    const [yamlDraft, setYamlDraft] = useState<string>('');
    /** YAML draft の parse / schema エラー（適用ボタン無効化に使う） */
    const [yamlDraftError, setYamlDraftError] = useState<string>('');

    const [loading, setLoading] = useState(isEdit);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    /** 保存済みからの未保存変更があるか。新規作成時は常に true（まだ DB に居ない）。 */
    const dirty = useMemo(() => {
        if (savedYaml === null) return true;
        return yaml.stringify(definition) !== savedYaml;
    }, [definition, savedYaml]);

    const { kinds, loading: kindsLoading } = useAvailableEntityKinds(definition);

    // 編集モード: 初期データロード
    useEffect(() => {
        if (!isEdit || !worldId) return;
        let cancelled = false;
        setLoading(true);
        fetch(`${API_BASE}/api/v1/worlds/${worldId}/definition`, { credentials: 'include' })
            .then(async (res) => {
                if (cancelled) return;
                if (res.status === 403) throw new Error('このワールドの編集権限がありません');
                if (!res.ok) throw new Error(`定義取得失敗 (${res.status})`);
                const def = (await res.json()) as WorldDefinition;
                if (cancelled) return;
                setDefinition(def);
                setSavedYaml(yaml.stringify(def));
            })
            .catch((e: unknown) => {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : '読み込み失敗');
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [worldId, isEdit]);

    // ---------- ワールド情報モーダル (staging) ----------
    const handleOpenInfo = useCallback(() => {
        setInfoDraft(definition);
        setOpenModal('info');
    }, [definition]);
    const handleApplyInfo = useCallback(() => {
        if (infoDraft) setDefinition(infoDraft);
        setInfoDraft(null);
        setOpenModal(null);
    }, [infoDraft]);
    const handleCancelInfo = useCallback(() => {
        setInfoDraft(null);
        setOpenModal(null);
    }, []);

    // ---------- YAML モーダル (staging) ----------
    const handleOpenYaml = useCallback(() => {
        setYamlDraft(yaml.stringify(definition));
        setYamlDraftError('');
        setOpenModal('yaml');
    }, [definition]);
    const handleYamlDraftChange = useCallback((text: string) => {
        setYamlDraft(text);
        // 即時 parse は行わない。エラー表示用に先読みチェックだけ実施。
        try {
            const parsed = yaml.parse(text) as unknown;
            const result = WorldDefinitionSchema.safeParse(parsed);
            setYamlDraftError(result.success ? '' : (result.error.issues[0]?.message ?? 'スキーマ違反'));
        } catch (e) {
            setYamlDraftError(e instanceof Error ? e.message : 'YAML parse error');
        }
    }, []);
    const handleApplyYaml = useCallback(() => {
        try {
            const parsed = yaml.parse(yamlDraft) as unknown;
            const result = WorldDefinitionSchema.safeParse(parsed);
            if (!result.success) {
                setYamlDraftError(result.error.issues[0]?.message ?? 'スキーマ違反');
                return;
            }
            setDefinition(result.data);
            setOpenModal(null);
            setYamlDraftError('');
        } catch (e) {
            setYamlDraftError(e instanceof Error ? e.message : 'YAML parse error');
        }
    }, [yamlDraft]);
    const handleCancelYaml = useCallback(() => {
        setYamlDraftError('');
        setOpenModal(null);
    }, []);

    const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            setYamlDraft(text);
            setOpenModal('yaml');
            setYamlDraftError('');
            setError('');
        } catch {
            setError('ファイルの読み込みに失敗しました');
        } finally {
            e.target.value = '';
        }
    }, []);

    // ---------- definition 操作 ----------
    const updateEntities = useCallback((mutate: (prev: InitialEntity[]) => InitialEntity[]) => {
        setDefinition((prev) => ({
            ...prev,
            spec: { ...prev.spec, initialEntities: mutate(prev.spec.initialEntities) },
        }));
    }, []);

    const patchEntityTransform = useCallback(
        (index: number, patch: Partial<InitialEntity['transform']>) => {
            updateEntities((prev) =>
                prev.map((e, i) => (i === index ? { ...e, transform: { ...e.transform, ...patch } } : e)),
            );
        },
        [updateEntities],
    );

    const placedKinds = useMemo(
        () => new Set(definition.spec.initialEntities.map((e) => e.kind)),
        [definition.spec.initialEntities],
    );

    /** kind 名から AvailableEntityKind を引くマップ（インスペクタで dataFields を参照するため） */
    const kindByName = useMemo(() => new Map(kinds.map((k) => [k.kind, k])), [kinds]);

    const handleAddEntity = useCallback(
        (k: AvailableEntityKind) => {
            const isSingleton = k.singleton && placedKinds.has(k.kind);
            if (isSingleton) return;
            const env = definition.spec.environment;
            const worldSize = env?.worldSize ?? { width: 2000, height: 1500 };
            const entities = definition.spec.initialEntities;
            const dt = k.defaultTransform ?? {};
            // 位置: defaultTransform に x/y があれば優先、なければキャンバス中央。
            const fallbackX = Math.round(worldSize.width / 2 - DEFAULT_W / 2);
            const fallbackY = Math.round(worldSize.height / 2 - DEFAULT_H / 2);
            // サイズ: defaultTransform に w/h があれば優先、なければ suggestSize で決める。
            const w = dt.w ?? (k.suggestSize ? DEFAULT_W : undefined);
            const h = dt.h ?? (k.suggestSize ? DEFAULT_H : undefined);
            // dataFields が宣言されていれば、各 field の default を初期 data に展開する。
            const initialData: Record<string, unknown> = {};
            if (k.dataFields) {
                for (const [name, spec] of Object.entries(k.dataFields)) {
                    if (spec.default !== undefined) {
                        initialData[name] = spec.default;
                    }
                }
            }
            const next: InitialEntity = {
                kind: k.kind,
                transform: {
                    x: dt.x ?? fallbackX,
                    y: dt.y ?? fallbackY,
                    z: dt.z ?? nextZ(entities),
                    w,
                    h,
                    scale: dt.scale ?? 1,
                    rotation: dt.rotation ?? 0,
                },
                data: initialData,
            };
            updateEntities((prev) => [...prev, next]);
            setSelectedIndex(entities.length);
        },
        [definition.spec.initialEntities, definition.spec.environment, placedKinds, updateEntities],
    );

    const handleDeleteEntity = useCallback(
        (index: number) => {
            updateEntities((prev) => prev.filter((_, i) => i !== index));
            // 削除に伴って後ろの index がシフトするので hiddenIndices を再計算
            setHiddenIndices((prev) => {
                const next = new Set<number>();
                for (const i of prev) {
                    if (i < index) next.add(i);
                    else if (i > index) next.add(i - 1);
                }
                return next;
            });
            setSelectedIndex((cur) => (cur === index ? null : cur && cur > index ? cur - 1 : cur));
        },
        [updateEntities],
    );

    const handleToggleHidden = useCallback((index: number) => {
        setHiddenIndices((prev) => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
        // 非表示にした瞬間、それが選択中なら選択解除
        setSelectedIndex((cur) => (cur === index ? null : cur));
    }, []);

    // ---------- 保存・削除・インスタンス作成 ----------
    const handleSave = useCallback(async () => {
        if (!definition.spec.displayName.trim()) {
            setError('表示名は必須です。「ワールド情報」から入力してください');
            handleOpenInfo();
            return;
        }
        setSaving(true);
        setError('');
        try {
            const text = yaml.stringify(definition);
            const body = JSON.stringify({ yaml: text });
            const url =
                isEdit && worldId ? `${API_BASE}/api/v1/worlds/${worldId}/yaml` : `${API_BASE}/api/v1/worlds/yaml`;
            const method = isEdit ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body,
            });
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(data.error ?? `HTTP ${res.status}`);
            }
            // 新規作成: サーバーが nanoid 生成した worldId を使い編集画面に遷移して dirty を解消
            if (!isEdit) {
                const created = (await res.json()) as { id: string };
                navigate(`/world/${created.id}/edit`, { replace: true });
                return;
            }
            // 編集モード: そのまま留まり savedYaml を更新して dirty=false にする
            setSavedYaml(text);
        } catch (e) {
            setError(e instanceof Error ? e.message : '保存失敗');
        } finally {
            setSaving(false);
        }
    }, [definition, isEdit, worldId, navigate, handleOpenInfo]);

    const handleCreateInstance = useCallback(async () => {
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

    const handleDelete = useCallback(async () => {
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
            navigate('/user/me');
        } catch (e) {
            setError(e instanceof Error ? e.message : '削除失敗');
            setSaving(false);
        }
    }, [worldId, navigate]);

    // 未認証のリダイレクトはレンダー中の副作用にしない (StrictMode 重複呼び出し回避)。
    // 親 ProtectedRoute で守られているが念のため二重チェック。
    useEffect(() => {
        if (!isPending && !session) navigate('/auth');
    }, [isPending, session, navigate]);

    if (isPending || !session) {
        return <CenteredMessage text="読み込み中..." />;
    }
    if (loading) {
        return <CenteredMessage text="ワールドを読み込み中..." />;
    }

    const selectedEntity = selectedIndex !== null ? definition.spec.initialEntities[selectedIndex] : null;
    const title =
        (definition.spec.displayName?.trim() || (isEdit ? 'ワールドを編集' : '新しいワールド')) +
        (isEdit ? '' : ' (未保存)');

    return (
        <div
            className={css({
                position: 'fixed',
                inset: 0,
                display: 'grid',
                gridTemplateRows: 'auto 1fr 220px',
                gridTemplateColumns: '240px 1fr 320px',
                gridTemplateAreas: `
                    "header header header"
                    "left   center right"
                    "bottom bottom bottom"
                `,
                bg: 'background',
                color: 'text',
                overflow: 'hidden',
            })}
        >
            <EditorHeader
                title={title}
                isEdit={isEdit}
                saving={saving}
                dirty={dirty}
                onOpenInfo={handleOpenInfo}
                onOpenYaml={handleOpenYaml}
                onSave={handleSave}
                onDelete={isEdit ? handleDelete : undefined}
                onCreateInstance={isEdit ? handleCreateInstance : undefined}
            />

            <EditorHierarchy
                entities={definition.spec.initialEntities}
                selectedIndex={selectedIndex}
                hiddenIndices={hiddenIndices}
                onSelect={setSelectedIndex}
                onDelete={handleDeleteEntity}
                onToggleHidden={handleToggleHidden}
            />

            <EditorStage
                definition={definition}
                selectedIndex={selectedIndex}
                hiddenIndices={hiddenIndices}
                onSelect={setSelectedIndex}
                onPatchTransform={patchEntityTransform}
            />

            <aside
                className={css({
                    gridArea: 'right',
                    bg: 'surface',
                    borderLeft: '1px solid',
                    borderColor: 'border',
                    overflowY: 'auto',
                    minH: 0,
                    minW: 0,
                })}
            >
                {selectedEntity && selectedIndex !== null ? (
                    <EntityInspector
                        entity={selectedEntity}
                        dataFields={kindByName.get(selectedEntity.kind)?.dataFields}
                        onChange={(updater) =>
                            updateEntities((prev) => prev.map((e, i) => (i === selectedIndex ? updater(e) : e)))
                        }
                        onDelete={() => handleDeleteEntity(selectedIndex)}
                    />
                ) : (
                    <div
                        className={css({
                            padding: '20px 16px',
                            fontSize: '12px',
                            color: 'textSubtle',
                            textAlign: 'center',
                        })}
                    >
                        左のヒエラルキーまたはキャンバスでエンティティを選択してください
                    </div>
                )}
            </aside>

            <EditorAssets kinds={kinds} loading={kindsLoading} placedKinds={placedKinds} onAdd={handleAddEntity} />

            {/* エラー通知（floating） */}
            {error && (
                <div
                    onClick={() => setError('')}
                    className={css({
                        position: 'fixed',
                        bottom: '232px',
                        left: '252px',
                        right: '332px',
                        padding: '10px 14px',
                        bg: 'errorBg',
                        color: 'errorText',
                        border: '1px solid',
                        borderColor: 'errorLight',
                        borderRadius: '8px',
                        fontSize: '13px',
                        zIndex: 99999,
                        cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    })}
                >
                    {error}
                    <span className={css({ ml: '2', opacity: 0.6, fontSize: '11px' })}>(クリックで閉じる)</span>
                </div>
            )}

            {/* モーダル */}
            <Modal
                open={openModal === 'info'}
                onClose={handleCancelInfo}
                title="ワールド情報"
                width="640px"
                footer={
                    <>
                        <ModalSecondaryButton onClick={handleCancelInfo}>キャンセル</ModalSecondaryButton>
                        <ModalPrimaryButton onClick={handleApplyInfo}>適用</ModalPrimaryButton>
                    </>
                }
            >
                {infoDraft && <WorldInfoForm draft={infoDraft} onChange={setInfoDraft} />}
            </Modal>
            <Modal
                open={openModal === 'yaml'}
                onClose={handleCancelYaml}
                title="YAML 編集"
                width="800px"
                footer={
                    <>
                        <ModalSecondaryButton onClick={handleCancelYaml}>キャンセル</ModalSecondaryButton>
                        <ModalPrimaryButton
                            onClick={handleApplyYaml}
                            disabled={!!yamlDraftError}
                            title={yamlDraftError || undefined}
                        >
                            適用
                        </ModalPrimaryButton>
                    </>
                }
            >
                <YamlEditorForm
                    yamlText={yamlDraft}
                    yamlDirty={!!yamlDraftError}
                    onChange={handleYamlDraftChange}
                    onFileUpload={handleFileUpload}
                />
            </Modal>
        </div>
    );
}

function ModalPrimaryButton({
    onClick,
    children,
    disabled,
    title,
}: {
    onClick: () => void;
    children: React.ReactNode;
    disabled?: boolean;
    title?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={css({
                padding: '8px 16px',
                bg: 'primary',
                color: 'textOnPrimary',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                _hover: { opacity: 0.9 },
            })}
        >
            {children}
        </button>
    );
}

function ModalSecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={css({
                padding: '8px 16px',
                bg: 'surface',
                color: 'textMuted',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                _hover: { borderColor: 'borderStrong' },
            })}
        >
            {children}
        </button>
    );
}

function CenteredMessage({ text }: { text: string }) {
    return (
        <div
            className={css({
                minH: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'textMuted',
            })}
        >
            {text}
        </div>
    );
}
