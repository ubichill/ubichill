import type { EntityComponentDef, InitialEntity, WorldDefinition } from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import yaml from 'yaml';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { css } from '@/styled-system/css';
import { DockSlot } from './components/DockSlot';
import { EditorAssets } from './components/EditorAssets';
import { EditorHeader } from './components/EditorHeader';
import { EditorHierarchy } from './components/EditorHierarchy';
import { EditorStage } from './components/EditorStage';
import { EntityInspector } from './components/EntityInspector';
import { WorldInfoForm } from './components/forms/WorldInfoForm';
import { YamlEditorForm } from './components/forms/YamlEditorForm';
import { MobileLeftHandle } from './components/MobileLeftHandle';
import { MobileRightHandle } from './components/MobileRightHandle';
import { Modal } from './components/Modal';
import { ModalPrimaryButton, ModalSecondaryButton } from './components/ModalButtons';
import { useAvailableEntityKinds } from './hooks/useAvailableEntityKinds';
import { useEditorModals } from './hooks/useEditorModals';
import { useWorldEditorApi } from './hooks/useWorldEditorApi';
import { buildEntityId, DEFAULT_H, DEFAULT_W, nextZ } from './lib/dragHelpers';

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
    const [savedYaml, setSavedYaml] = useState<string | null>(null);

    const [selectedEntityIndex, setSelectedEntityIndex] = useState<number | null>(null);
    const [selectedComponentIndex, setSelectedComponentIndex] = useState<number | null>(null);
    const [hiddenIndices, setHiddenIndices] = useState<Set<number>>(new Set());
    const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
    const [mobileRightOpen, setMobileRightOpen] = useState(false);
    const [loading, setLoading] = useState(isEdit);

    const dirty = useMemo(() => {
        if (savedYaml === null) return true;
        return yaml.stringify(definition) !== savedYaml;
    }, [definition, savedYaml]);

    const { kinds, loading: kindsLoading } = useAvailableEntityKinds(definition);

    const modals = useEditorModals({ definition, onCommit: setDefinition });
    const api = useWorldEditorApi({ isEdit, worldId, definition, onSavedYamlChange: setSavedYaml });

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
                api.setError(e instanceof Error ? e.message : '読み込み失敗');
            })
            .finally(() => {
                if (ctrl.signal.aborted) return;
                setLoading(false);
            });
        return () => ctrl.abort();
    }, [worldId, isEdit, api.setError]);

    useEffect(() => {
        if (!isPending && !session) navigate('/auth');
    }, [isPending, session, navigate]);

    // ---------- entity 操作 ----------
    const updateEntities = useCallback((mutate: (prev: InitialEntity[]) => InitialEntity[]) => {
        setDefinition((prev) => ({
            ...prev,
            spec: { ...prev.spec, initialEntities: mutate(prev.spec.initialEntities) },
        }));
    }, []);

    /**
     * Entity 選択。drawer は自動展開しない（移動/リサイズの邪魔になるため）。
     */
    const selectEntity = useCallback((index: number | null) => {
        setSelectedEntityIndex(index);
        if (index === null) {
            setSelectedComponentIndex(null);
            setMobileRightOpen(false);
        }
    }, []);

    const selectComponent = useCallback((componentIndex: number | null) => {
        setSelectedComponentIndex(componentIndex);
    }, []);

    const patchEntityTransform = useCallback(
        (index: number, patch: Partial<InitialEntity['transform']>) => {
            updateEntities((prev) =>
                prev.map((e, i) => (i === index ? { ...e, transform: { ...e.transform, ...patch } } : e)),
            );
        },
        [updateEntities],
    );

    /** 空の GameObject (transform のみ) をワールド中央に新規作成する。 */
    const handleCreateEmptyEntity = useCallback(() => {
        const env = definition.spec.environment;
        const worldSize = env?.worldSize ?? { width: 2000, height: 1500 };
        const entities = definition.spec.initialEntities;
        const next: InitialEntity = {
            id: buildEntityId(
                'entity',
                entities.map((e) => e.id),
            ),
            transform: {
                x: Math.round(worldSize.width / 2 - DEFAULT_W / 2),
                y: Math.round(worldSize.height / 2 - DEFAULT_H / 2),
                z: nextZ(entities),
                w: DEFAULT_W,
                h: DEFAULT_H,
                scale: 1,
                rotation: 0,
            },
            components: [],
            tags: [],
        };
        updateEntities((prev) => [...prev, next]);
        selectEntity(entities.length);
        selectComponent(null);
    }, [definition.spec.initialEntities, definition.spec.environment, updateEntities, selectEntity, selectComponent]);

    /** Inspector / Hierarchy / Overlay からの component 追加 (D&D 含む)。既存 Entity に component を載せる。 */
    const handleAddComponentToEntity = useCallback(
        (entityIndex: number, componentType: string) => {
            const kind = kinds.find((k) => k.kind === componentType);
            const initialData: Record<string, unknown> = {};
            if (kind?.dataFields) {
                for (const [name, spec] of Object.entries(kind.dataFields)) {
                    if (spec.default !== undefined) initialData[name] = spec.default;
                }
            }
            const newComponent: EntityComponentDef = { type: componentType, data: initialData };
            updateEntities((prev) =>
                prev.map((e, i) => (i === entityIndex ? { ...e, components: [...e.components, newComponent] } : e)),
            );
            selectComponent(definition.spec.initialEntities[entityIndex]?.components.length ?? 0);
        },
        [kinds, updateEntities, selectComponent, definition.spec.initialEntities],
    );

    const handleDeleteEntity = useCallback(
        (index: number) => {
            updateEntities((prev) => prev.filter((_, i) => i !== index));
            setHiddenIndices((prev) => {
                const next = new Set<number>();
                for (const i of prev) {
                    if (i < index) next.add(i);
                    else if (i > index) next.add(i - 1);
                }
                return next;
            });
            setSelectedEntityIndex((cur) => (cur === index ? null : cur !== null && cur > index ? cur - 1 : cur));
            setSelectedComponentIndex(null);
        },
        [updateEntities],
    );

    const handleDeleteComponent = useCallback(
        (entityIndex: number, componentIndex: number) => {
            updateEntities((prev) =>
                prev.map((e, i) =>
                    i === entityIndex ? { ...e, components: e.components.filter((_, ci) => ci !== componentIndex) } : e,
                ),
            );
            setSelectedComponentIndex((cur) => {
                if (cur === null) return null;
                if (cur === componentIndex) return null;
                if (cur > componentIndex) return cur - 1;
                return cur;
            });
        },
        [updateEntities],
    );

    const handleRenameEntity = useCallback(
        (entityIndex: number, newId: string) => {
            updateEntities((prev) => {
                const others = prev.filter((_, i) => i !== entityIndex).map((e) => e.id);
                if (others.includes(newId)) return prev; // 重複は無視
                return prev.map((e, i) => (i === entityIndex ? { ...e, id: newId } : e));
            });
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
        setSelectedEntityIndex((cur) => (cur === index ? null : cur));
        setSelectedComponentIndex(null);
    }, []);

    // ---------- 保存 ----------
    const handleSave = useCallback(() => {
        if (!definition.spec.displayName.trim()) {
            api.setError('表示名は必須です。「ワールド情報」から入力してください');
            modals.openInfo();
            return;
        }
        void api.save();
    }, [definition.spec.displayName, api, modals]);

    if (isPending || !session) return <CenteredMessage text="読み込み中..." />;
    if (loading) return <CenteredMessage text="ワールドを読み込み中..." />;

    const selectedEntity = selectedEntityIndex !== null ? definition.spec.initialEntities[selectedEntityIndex] : null;
    const title =
        (definition.spec.displayName?.trim() || (isEdit ? 'ワールドを編集' : '新しいワールド')) +
        (isEdit ? '' : ' (未保存)');

    return (
        <div
            className={css({
                position: 'fixed',
                inset: 0,
                display: 'grid',
                gridTemplateRows: { base: 'auto 1fr 140px', md: 'auto 1fr 220px' },
                gridTemplateColumns: { base: '1fr', md: '240px 1fr 320px' },
                gridTemplateAreas: {
                    base: `"header" "center" "bottom"`,
                    md: `"header header header" "left center right" "bottom bottom bottom"`,
                },
                bg: 'background',
                color: 'text',
                overflow: 'hidden',
            })}
        >
            <div className={css({ gridArea: 'header' })}>
                <EditorHeader
                    title={title}
                    isEdit={isEdit}
                    saving={api.saving}
                    dirty={dirty}
                    onOpenInfo={modals.openInfo}
                    onOpenYaml={modals.openYaml}
                    onSave={handleSave}
                    onDelete={isEdit ? api.remove : undefined}
                    onCreateInstance={isEdit ? api.createInstance : undefined}
                />
            </div>

            <DockSlot
                area="left"
                mobileVisible={mobileLeftOpen}
                mobileTitle="ヒエラルキー"
                onMobileClose={() => setMobileLeftOpen(false)}
            >
                <EditorHierarchy
                    entities={definition.spec.initialEntities}
                    selectedEntityIndex={selectedEntityIndex}
                    selectedComponentIndex={selectedComponentIndex}
                    hiddenIndices={hiddenIndices}
                    onSelectEntity={(i) => {
                        selectEntity(i);
                        setMobileLeftOpen(false);
                    }}
                    onSelectComponent={selectComponent}
                    onCreateEmptyEntity={handleCreateEmptyEntity}
                    onDeleteEntity={handleDeleteEntity}
                    onDeleteComponent={handleDeleteComponent}
                    onToggleHidden={handleToggleHidden}
                    onDropComponent={handleAddComponentToEntity}
                />
            </DockSlot>

            <div className={css({ gridArea: 'center', minH: 0, minW: 0 })}>
                <EditorStage
                    definition={definition}
                    selectedIndex={selectedEntityIndex}
                    hiddenIndices={hiddenIndices}
                    onSelect={selectEntity}
                    onPatchTransform={patchEntityTransform}
                    onDropComponent={handleAddComponentToEntity}
                />
            </div>

            <DockSlot
                area="right"
                mobileVisible={mobileRightOpen && !!selectedEntity}
                mobileTitle="設定"
                onMobileClose={() => setMobileRightOpen(false)}
            >
                {selectedEntity && selectedEntityIndex !== null ? (
                    <EntityInspector
                        entity={selectedEntity}
                        selectedComponentIndex={selectedComponentIndex}
                        availableKinds={kinds}
                        onChange={(updater) =>
                            updateEntities((prev) => prev.map((e, i) => (i === selectedEntityIndex ? updater(e) : e)))
                        }
                        onSelectComponent={selectComponent}
                        onAddComponent={(type) => handleAddComponentToEntity(selectedEntityIndex, type)}
                        onDeleteComponent={(ci) => handleDeleteComponent(selectedEntityIndex, ci)}
                        onDeleteEntity={() => handleDeleteEntity(selectedEntityIndex)}
                        onRenameEntity={(id) => handleRenameEntity(selectedEntityIndex, id)}
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
            </DockSlot>

            <DockSlot area="bottom" mobileVisible={true}>
                <EditorAssets
                    kinds={kinds}
                    loading={kindsLoading}
                    pluginNames={(definition.spec.dependencies ?? []).map((d) => d.name)}
                />
            </DockSlot>

            {!mobileLeftOpen && <MobileLeftHandle onClick={() => setMobileLeftOpen(true)} />}
            {selectedEntity && !mobileRightOpen && <MobileRightHandle onClick={() => setMobileRightOpen(true)} />}

            {api.error && (
                <div
                    onClick={() => api.setError('')}
                    className={css({
                        position: 'fixed',
                        bottom: { base: '152px', md: '232px' },
                        left: { base: '12px', md: '252px' },
                        right: { base: '12px', md: '332px' },
                        padding: '10px 14px',
                        bg: 'errorBg',
                        color: 'errorText',
                        border: '1px solid',
                        borderColor: 'errorLight',
                        borderRadius: '8px',
                        fontSize: '13px',
                        zIndex: 99999,
                        cursor: 'pointer',
                        boxShadow: 'toast',
                    })}
                >
                    {api.error}
                    <span className={css({ ml: '2', opacity: 0.6, fontSize: '11px' })}>(クリックで閉じる)</span>
                </div>
            )}

            <Modal
                open={modals.openModal === 'info'}
                onClose={modals.cancelInfo}
                title="ワールド情報"
                width="640px"
                footer={
                    <>
                        <ModalSecondaryButton onClick={modals.cancelInfo}>キャンセル</ModalSecondaryButton>
                        <ModalPrimaryButton onClick={modals.applyInfo}>適用</ModalPrimaryButton>
                    </>
                }
            >
                {modals.infoDraft && <WorldInfoForm draft={modals.infoDraft} onChange={modals.setInfoDraft} />}
            </Modal>

            <Modal
                open={modals.openModal === 'yaml'}
                onClose={modals.cancelYaml}
                title="YAML 編集"
                width="800px"
                footer={
                    <>
                        <ModalSecondaryButton onClick={modals.cancelYaml}>キャンセル</ModalSecondaryButton>
                        <ModalPrimaryButton
                            onClick={modals.applyYaml}
                            disabled={!!modals.yamlDraftError}
                            title={modals.yamlDraftError || undefined}
                        >
                            適用
                        </ModalPrimaryButton>
                    </>
                }
            >
                <YamlEditorForm
                    yamlText={modals.yamlDraft}
                    yamlDirty={!!modals.yamlDraftError}
                    onChange={modals.changeYamlDraft}
                    onFileUpload={modals.uploadYamlFile}
                />
            </Modal>
        </div>
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
