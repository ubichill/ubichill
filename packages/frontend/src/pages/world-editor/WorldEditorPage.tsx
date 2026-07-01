import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useSession } from '@/lib/session';
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
import { useDefinition } from './hooks/useDefinition';
import { useEditorModals } from './hooks/useEditorModals';
import { useEntityOps } from './hooks/useEntityOps';
import { useEntitySelection } from './hooks/useEntitySelection';
import { useMobilePanels } from './hooks/useMobilePanels';
import { useWorldEditorApi } from './hooks/useWorldEditorApi';
import { SNAP_STEP } from './lib/dragHelpers';
import { flattenForStage, getEntityAt, updateEntityAt } from './lib/entityTree';

export function WorldEditorPage() {
    const { worldId } = useParams<{ worldId?: string }>();
    const navigate = useNavigate();
    const { data: session, isPending } = useSession();
    const isEdit = !!worldId;

    // ── ページ全体で共有する error trough ──────────────────────────
    // useDefinition / useWorldEditorApi 両方から書き込まれ、画面下のトーストで表示する
    const [error, setError] = useState('');

    const { definition, setDefinition, setSavedYaml, loading, dirty, updateEntities } = useDefinition({
        isEdit,
        worldId,
        onError: setError,
    });

    const editorApi = useWorldEditorApi({
        isEdit,
        worldId,
        definition,
        onSavedYamlChange: setSavedYaml,
        onError: setError,
    });

    const { kinds, loading: kindsLoading } = useAvailableEntityKinds(definition);
    const modals = useEditorModals({ definition, onCommit: setDefinition });

    const selection = useEntitySelection();
    const ops = useEntityOps({ definition, updateEntities, kinds, selection });
    const mobile = useMobilePanels();

    // 認証ガード
    useEffect(() => {
        if (!isPending && !session) navigate('/auth');
    }, [isPending, session, navigate]);

    const flatNodes = useMemo(
        () => flattenForStage(definition.spec.initialEntities),
        [definition.spec.initialEntities],
    );

    const handleSave = useCallback(() => {
        if (!definition.spec.displayName.trim()) {
            setError('表示名は必須です。「ワールド情報」から入力してください');
            modals.openInfo();
            return;
        }
        void editorApi.save();
    }, [definition.spec.displayName, editorApi, modals]);

    if (isPending || !session) return <CenteredMessage text="読み込み中..." />;
    if (loading) return <CenteredMessage text="ワールドを読み込み中..." />;

    const selectedEntity = selection.selectedPath
        ? getEntityAt(definition.spec.initialEntities, selection.selectedPath)
        : null;
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
                    saving={editorApi.saving}
                    dirty={dirty}
                    snapEnabled={mobile.snapEnabled}
                    onToggleSnap={mobile.toggleSnap}
                    onOpenInfo={modals.openInfo}
                    onOpenYaml={modals.openYaml}
                    onSave={handleSave}
                    onDelete={isEdit ? editorApi.remove : undefined}
                    onCreateInstance={isEdit ? editorApi.createInstance : undefined}
                />
            </div>

            <DockSlot
                area="left"
                mobileVisible={mobile.leftOpen}
                mobileTitle="ヒエラルキー"
                onMobileClose={mobile.closeLeft}
            >
                <EditorHierarchy
                    entities={definition.spec.initialEntities}
                    selectedPath={selection.selectedPath}
                    selectedComponentIndex={selection.selectedComponentIndex}
                    hiddenPaths={selection.hiddenPaths}
                    onSelectEntity={(p) => {
                        selection.selectEntity(p);
                        mobile.closeLeft();
                    }}
                    onSelectComponent={selection.selectComponent}
                    onCreateEmptyEntity={ops.handleCreateEmptyEntity}
                    onDeleteEntity={ops.handleDeleteEntity}
                    onDeleteComponent={ops.handleDeleteComponent}
                    onToggleHidden={selection.toggleHidden}
                    onDropComponent={ops.handleAddComponentToEntity}
                    onMoveEntity={ops.handleMoveEntity}
                    onEnterChild={ops.handleEnterChild}
                    onCopyEntity={ops.handleCopyEntity}
                    onPasteEntity={ops.handlePasteEntity}
                    onDuplicateEntity={ops.handleDuplicateEntity}
                    hasClipboard={ops.hasClipboard}
                />
            </DockSlot>

            <div className={css({ gridArea: 'center', minH: 0, minW: 0 })}>
                <EditorStage
                    definition={definition}
                    flatNodes={flatNodes}
                    selectedPath={selection.selectedPath}
                    hiddenPathKeys={selection.hiddenPaths}
                    hiddenRootIndices={selection.hiddenRootIndices}
                    snapStep={mobile.snapEnabled ? SNAP_STEP : 0}
                    onSelect={selection.selectEntity}
                    onPatchTransform={ops.patchEntityTransform}
                    onDropComponent={ops.handleAddComponentToEntity}
                />
            </div>

            <DockSlot
                area="right"
                mobileVisible={mobile.rightOpen && !!selectedEntity}
                mobileTitle="設定"
                onMobileClose={mobile.closeRight}
            >
                {selectedEntity && selection.selectedPath ? (
                    <EntityInspector
                        entity={selectedEntity}
                        initiallyExpandedComponentIndex={selection.selectedComponentIndex}
                        availableKinds={kinds}
                        isChild={selection.selectedPath.length > 1}
                        worldSize={mobile.snapEnabled ? definition.spec.environment?.worldSize : undefined}
                        onChange={(updater) => {
                            const path = selection.selectedPath;
                            if (path) updateEntities((prev) => updateEntityAt(prev, path, updater));
                        }}
                        onAddComponent={(type) => {
                            const path = selection.selectedPath;
                            if (path) ops.handleAddComponentToEntity(path, type);
                        }}
                        onDeleteComponent={(ci) => {
                            const path = selection.selectedPath;
                            if (path) ops.handleDeleteComponent(path, ci);
                        }}
                        onDeleteEntity={() => {
                            const path = selection.selectedPath;
                            if (path) ops.handleDeleteEntity(path);
                        }}
                        onRenameEntity={(id) => {
                            const path = selection.selectedPath;
                            if (path) ops.handleRenameEntity(path, id);
                        }}
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

            {!mobile.leftOpen && <MobileLeftHandle onClick={mobile.openLeft} />}
            {selectedEntity && !mobile.rightOpen && <MobileRightHandle onClick={mobile.openRight} />}

            {error && (
                <div
                    onClick={() => setError('')}
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
                    {error}
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
