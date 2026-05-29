import type { EntityComponentDef, InitialEntity, WorldDefinition } from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import yaml from 'yaml';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { css } from '@/styled-system/css';
import { EditorAssets } from './components/assets/EditorAssets';
import { DockSlot } from './components/DockSlot';
import { EditorHeader } from './components/EditorHeader';
import { EditorStage } from './components/EditorStage';
import { WorldInfoForm } from './components/forms/WorldInfoForm';
import { YamlEditorForm } from './components/forms/YamlEditorForm';
import { EditorHierarchy } from './components/hierarchy/EditorHierarchy';
import { EntityInspector } from './components/inspector/EntityInspector';
import { MobileLeftHandle } from './components/MobileLeftHandle';
import { MobileRightHandle } from './components/MobileRightHandle';
import { Modal } from './components/Modal';
import { ModalPrimaryButton, ModalSecondaryButton } from './components/ModalButtons';
import { useAvailableEntityKinds } from './hooks/useAvailableEntityKinds';
import { useEditorModals } from './hooks/useEditorModals';
import { useEntityClipboard } from './hooks/useEntityClipboard';
import { useWorldEditorApi } from './hooks/useWorldEditorApi';
import { DEFAULT_H, DEFAULT_W, SNAP_STEP } from './lib/dragHelpers';
import {
    adjustPathAfterDelete,
    buildUniqueEntityId,
    cloneEntitySubtree,
    collectEntityIds,
    deleteEntityAt,
    type EntityPath,
    ensureUniqueName,
    flattenForStage,
    getEntityAt,
    insertEntity,
    moveEntity,
    nextRootZ,
    pathKey,
    updateEntityAt,
} from './lib/entityTree';

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

    const [selectedPath, setSelectedPath] = useState<EntityPath | null>(null);
    const [selectedComponentIndex, setSelectedComponentIndex] = useState<number | null>(null);
    const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(new Set());
    const [snapEnabled, setSnapEnabled] = useState(false);
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

    const updateEntities = useCallback((mutate: (prev: InitialEntity[]) => InitialEntity[]) => {
        setDefinition((prev) => ({
            ...prev,
            spec: { ...prev.spec, initialEntities: mutate(prev.spec.initialEntities) },
        }));
    }, []);

    const selectEntity = useCallback((path: EntityPath | null) => {
        setSelectedPath(path);
        if (path === null) {
            setSelectedComponentIndex(null);
            setMobileRightOpen(false);
        }
    }, []);

    const selectComponent = useCallback((componentIndex: number | null) => {
        setSelectedComponentIndex(componentIndex);
    }, []);

    /** EditOverlay からの transform 編集 (path ベース、子 Entity は親基準で保存)。 */
    const patchEntityTransform = useCallback(
        (path: EntityPath, patch: Partial<InitialEntity['transform']>) => {
            updateEntities((prev) =>
                updateEntityAt(prev, path, (e) => ({ ...e, transform: { ...e.transform, ...patch } })),
            );
        },
        [updateEntities],
    );

    const flatNodes = useMemo(
        () => flattenForStage(definition.spec.initialEntities),
        [definition.spec.initialEntities],
    );

    const handleCreateEmptyEntity = useCallback(
        (parentPath: EntityPath | null) => {
            const env = definition.spec.environment;
            const worldSize = env?.worldSize ?? { width: 2000, height: 1500 };
            const entities = definition.spec.initialEntities;
            const newEntity: InitialEntity = {
                id: buildUniqueEntityId('entity', collectEntityIds(entities)),
                transform: parentPath
                    ? { x: 0, y: 0, z: 1, w: DEFAULT_W, h: DEFAULT_H, scale: 1, rotation: 0 }
                    : {
                          x: Math.round(worldSize.width / 2 - DEFAULT_W / 2),
                          y: Math.round(worldSize.height / 2 - DEFAULT_H / 2),
                          z: nextRootZ(entities),
                          w: DEFAULT_W,
                          h: DEFAULT_H,
                          scale: 1,
                          rotation: 0,
                      },
                components: [],
                tags: [],
                children: [],
            };
            updateEntities((prev) => insertEntity(prev, parentPath, newEntity));
            // 新規作成した Entity を選択
            if (parentPath) {
                const parent = getEntityAt(entities, parentPath);
                const newChildIdx = parent?.children?.length ?? 0;
                selectEntity([...parentPath, newChildIdx]);
            } else {
                selectEntity([entities.length]);
            }
            selectComponent(null);
        },
        [definition.spec.initialEntities, definition.spec.environment, updateEntities, selectEntity, selectComponent],
    );

    const handleAddComponentToEntity = useCallback(
        (path: EntityPath, componentType: string) => {
            const kind = kinds.find((k) => k.kind === componentType);
            const initialData: Record<string, unknown> = {};
            if (kind?.dataFields) {
                for (const [name, spec] of Object.entries(kind.dataFields)) {
                    if (spec.default !== undefined) initialData[name] = spec.default;
                }
            }
            const newComponent: EntityComponentDef = { type: componentType, data: initialData };
            updateEntities((prev) =>
                updateEntityAt(prev, path, (e) => ({ ...e, components: [...e.components, newComponent] })),
            );
            const target = getEntityAt(definition.spec.initialEntities, path);
            selectEntity(path);
            selectComponent(target?.components.length ?? 0);
        },
        [kinds, updateEntities, selectEntity, selectComponent, definition.spec.initialEntities],
    );

    const handleDeleteEntity = useCallback(
        (path: EntityPath) => {
            updateEntities((prev) => deleteEntityAt(prev, path));
            // 削除された path 以下の hiddenPaths キーを破棄 (path index ずれは諦めて単純化)
            setHiddenPaths((prev) => {
                const next = new Set<string>();
                const removedKey = pathKey(path);
                for (const k of prev) {
                    if (k === removedKey || k.startsWith(`${removedKey}-`)) continue;
                    next.add(k);
                }
                return next;
            });
            setSelectedPath((cur) => adjustPathAfterDelete(cur, path));
            setSelectedComponentIndex(null);
        },
        [updateEntities],
    );

    const handleDeleteComponent = useCallback(
        (path: EntityPath, componentIndex: number) => {
            updateEntities((prev) =>
                updateEntityAt(prev, path, (e) => ({
                    ...e,
                    components: e.components.filter((_, ci) => ci !== componentIndex),
                })),
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
        (path: EntityPath, newId: string) => {
            const taken = new Set(collectEntityIds(definition.spec.initialEntities));
            // 自分自身は許可 (実質ノーオペになる)
            const self = getEntityAt(definition.spec.initialEntities, path);
            if (self) taken.delete(self.id);
            // 衝突したら "hoge" → "hoge2" → "hoge3" の suffix を自動採番
            const uniqueId = ensureUniqueName(newId, taken);
            updateEntities((prev) => updateEntityAt(prev, path, (e) => ({ ...e, id: uniqueId })));
        },
        [updateEntities, definition.spec.initialEntities],
    );

    const handleToggleHidden = useCallback((path: EntityPath) => {
        const key = pathKey(path);
        setHiddenPaths((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const handleMoveEntity = useCallback(
        (from: EntityPath, to: EntityPath | null) => {
            updateEntities((prev) => moveEntity(prev, from, to));
            // 移動後の selectedPath は厳密追跡が難しいので解除する
            setSelectedPath(null);
            setSelectedComponentIndex(null);
            setHiddenPaths(new Set()); // path ずれを避けるため一旦リセット
        },
        [updateEntities],
    );

    // ── クリップボード (Entity subtree のコピー&ペースト) ─────────────
    const clipboard = useEntityClipboard();

    const handleCopyEntity = useCallback(
        (path: EntityPath) => {
            const target = getEntityAt(definition.spec.initialEntities, path);
            if (target) clipboard.copy(target);
        },
        [clipboard, definition.spec.initialEntities],
    );

    const handlePasteEntity = useCallback(
        (parentPath: EntityPath | null) => {
            const source = clipboard.peek();
            if (!source) return;
            const taken = collectEntityIds(definition.spec.initialEntities);
            const cloned = cloneEntitySubtree(source, taken);
            // ルートに貼り付け時のみ z をスタック頂上に持ち上げる (見えなくならないように)
            const placed = parentPath
                ? cloned
                : { ...cloned, transform: { ...cloned.transform, z: nextRootZ(definition.spec.initialEntities) } };
            updateEntities((prev) => insertEntity(prev, parentPath, placed));
            // 貼った Entity を選択
            if (parentPath) {
                const parent = getEntityAt(definition.spec.initialEntities, parentPath);
                const newChildIdx = parent?.children?.length ?? 0;
                selectEntity([...parentPath, newChildIdx]);
            } else {
                selectEntity([definition.spec.initialEntities.length]);
            }
            selectComponent(null);
        },
        [clipboard, definition.spec.initialEntities, updateEntities, selectEntity, selectComponent],
    );

    const handleEnterChild = useCallback(
        (path: EntityPath) => {
            const parent = getEntityAt(definition.spec.initialEntities, path);
            if (!parent?.children?.length) return;
            setSelectedPath([...path, 0]);
            setSelectedComponentIndex(null);
        },
        [definition.spec.initialEntities],
    );

    const handleSave = useCallback(() => {
        if (!definition.spec.displayName.trim()) {
            api.setError('表示名は必須です。「ワールド情報」から入力してください');
            modals.openInfo();
            return;
        }
        void api.save();
    }, [definition.spec.displayName, api, modals]);

    // hiddenPaths からルートのみの index Set を導出 (Stage / EditorPreview 用)
    const hiddenRootIndices = useMemo(() => {
        const out = new Set<number>();
        for (const key of hiddenPaths) {
            if (!key.includes('-')) {
                const n = Number.parseInt(key, 10);
                if (Number.isFinite(n)) out.add(n);
            }
        }
        return out;
    }, [hiddenPaths]);

    if (isPending || !session) return <CenteredMessage text="読み込み中..." />;
    if (loading) return <CenteredMessage text="ワールドを読み込み中..." />;

    const selectedEntity = selectedPath ? getEntityAt(definition.spec.initialEntities, selectedPath) : null;
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
                    snapEnabled={snapEnabled}
                    onToggleSnap={() => setSnapEnabled((p) => !p)}
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
                    selectedPath={selectedPath}
                    selectedComponentIndex={selectedComponentIndex}
                    hiddenPaths={hiddenPaths}
                    onSelectEntity={(p) => {
                        selectEntity(p);
                        setMobileLeftOpen(false);
                    }}
                    onSelectComponent={selectComponent}
                    onCreateEmptyEntity={handleCreateEmptyEntity}
                    onDeleteEntity={handleDeleteEntity}
                    onDeleteComponent={handleDeleteComponent}
                    onToggleHidden={handleToggleHidden}
                    onDropComponent={handleAddComponentToEntity}
                    onMoveEntity={handleMoveEntity}
                    onEnterChild={handleEnterChild}
                    onCopyEntity={handleCopyEntity}
                    onPasteEntity={handlePasteEntity}
                    hasClipboard={clipboard.hasClipboard}
                />
            </DockSlot>

            <div className={css({ gridArea: 'center', minH: 0, minW: 0 })}>
                <EditorStage
                    definition={definition}
                    flatNodes={flatNodes}
                    selectedPath={selectedPath}
                    hiddenPathKeys={hiddenPaths}
                    hiddenRootIndices={hiddenRootIndices}
                    snapStep={snapEnabled ? SNAP_STEP : 0}
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
                {selectedEntity && selectedPath ? (
                    <EntityInspector
                        entity={selectedEntity}
                        initiallyExpandedComponentIndex={selectedComponentIndex}
                        availableKinds={kinds}
                        isChild={selectedPath.length > 1}
                        worldSize={snapEnabled ? definition.spec.environment?.worldSize : undefined}
                        onChange={(updater) => updateEntities((prev) => updateEntityAt(prev, selectedPath, updater))}
                        onAddComponent={(type) => handleAddComponentToEntity(selectedPath, type)}
                        onDeleteComponent={(ci) => handleDeleteComponent(selectedPath, ci)}
                        onDeleteEntity={() => handleDeleteEntity(selectedPath)}
                        onRenameEntity={(id) => handleRenameEntity(selectedPath, id)}
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
