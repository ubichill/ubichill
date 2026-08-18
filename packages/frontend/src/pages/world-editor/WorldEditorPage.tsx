import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useSession } from '@/lib/session';
import { css } from '@/styled-system/css';
import { EditorAssets } from './components/assets/EditorAssets';
import { ControlPanelTabs } from './components/ControlPanelTabs';
import { DockSlot } from './components/DockSlot';
import { EditorHeader } from './components/EditorHeader';
import { EditorStage } from './components/EditorStage';
import { ModSelector } from './components/forms/ModSelector';
import { WorldInfoForm } from './components/forms/WorldInfoForm';
import { YamlEditorForm } from './components/forms/YamlEditorForm';
import { EditorHierarchy } from './components/hierarchy/EditorHierarchy';
import { EntityInspector } from './components/inspector/EntityInspector';
import { MobileLeftHandle } from './components/MobileLeftHandle';
import { MobileRightHandle } from './components/MobileRightHandle';
import { Modal } from './components/Modal';
import { ModalPrimaryButton, ModalSecondaryButton } from './components/ModalButtons';
import { PanelSection } from './components/PanelSection';
import { useAvailableEntityKinds } from './hooks/useAvailableEntityKinds';
import { useDefinition } from './hooks/useDefinition';
import { useEditorModals } from './hooks/useEditorModals';
import { useEntityOps } from './hooks/useEntityOps';
import { useEntitySelection } from './hooks/useEntitySelection';
import { useMobilePanels } from './hooks/useMobilePanels';
import { useWorldEditorApi } from './hooks/useWorldEditorApi';
import { SNAP_STEP } from './lib/dragHelpers';
import { flattenForStage, getEntityAt, updateEntityAt } from './lib/entityTree';
import { editorButton } from './recipes/button';

export function WorldEditorPage() {
    const { worldId } = useParams<{ worldId?: string }>();
    const navigate = useNavigate();
    const { data: session, isPending } = useSession();
    const isEdit = !!worldId;

    // ── ページ全体で共有する error trough ──────────────────────────
    // useDefinition / useWorldEditorApi 両方から書き込まれ、画面下のトーストで表示する
    const [error, setError] = useState('');
    const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

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

    // サーバーへ保存する共通処理。フォームが definition を直接更新しているため draft を介さず保存する。
    const persist = useCallback(async (): Promise<boolean> => {
        if (modals.activeTab === 'yaml' && modals.yamlError) {
            setError(modals.yamlError);
            return false;
        }
        if (!definition.spec.displayName.trim()) {
            setError('表示名は必須です');
            return false;
        }
        return editorApi.save();
    }, [definition, editorApi, modals.activeTab, modals.yamlError]);

    const handleSave = useCallback(() => {
        void persist();
    }, [persist]);

    // コントロールパネルを閉じる。編集モードでは未保存の変更を保存してから閉じる。
    // 新規作成時は閉じるだけで破棄する（作成は「作成」ボタン or Cmd/Ctrl+S）。
    const handleCloseControlPanel = useCallback(() => {
        if (isEdit) {
            if (modals.activeTab === 'yaml' && modals.yamlError) {
                setError(modals.yamlError);
                return;
            }
            if (dirty) void editorApi.save();
        }
        modals.closeControlPanel();
    }, [isEdit, dirty, editorApi, modals.activeTab, modals.yamlError, modals.closeControlPanel]);

    // 戻るボタン。未保存なら確認モーダルを出す。
    const handleBack = useCallback(() => {
        if (dirty) setLeaveConfirmOpen(true);
        else navigate(-1);
    }, [dirty, navigate]);

    const handleDiscardAndLeave = useCallback(() => {
        setLeaveConfirmOpen(false);
        navigate(-1);
    }, [navigate]);

    const handleSaveAndLeave = useCallback(async () => {
        setLeaveConfirmOpen(false);
        const ok = await persist();
        if (ok && isEdit) navigate(-1);
    }, [persist, isEdit, navigate]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
            e.preventDefault();
            if (editorApi.saving) return;
            handleSave();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleSave, editorApi.saving]);

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
                    dirty={dirty}
                    snapEnabled={mobile.snapEnabled}
                    onToggleSnap={mobile.toggleSnap}
                    onBack={handleBack}
                    onOpenControlPanel={() => modals.openControlPanel()}
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
                        allEntities={definition.spec.initialEntities}
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
                <EditorAssets kinds={kinds} loading={kindsLoading} dependencies={definition.spec.dependencies ?? []} />
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
                open={modals.open}
                onClose={handleCloseControlPanel}
                title="コントロールパネル"
                width="960px"
                height="680px"
                footer={
                    <div className={css({ display: 'flex', width: '100%', justifyContent: 'space-between' })}>
                        <div>
                            {isEdit && !dirty && (
                                <button
                                    type="button"
                                    onClick={editorApi.createInstance}
                                    disabled={editorApi.saving}
                                    title="このワールドで新しいインスタンスを作って参加する"
                                    className={editorButton({ intent: 'success' })}
                                >
                                    ▶ インスタンス作成
                                </button>
                            )}
                        </div>
                        <div className={css({ display: 'flex', gap: '8px' })}>
                            {isEdit ? (
                                <ModalPrimaryButton onClick={handleCloseControlPanel}>
                                    {dirty ? '保存して閉じる' : '閉じる'}
                                </ModalPrimaryButton>
                            ) : (
                                <>
                                    <ModalSecondaryButton onClick={modals.closeControlPanel}>
                                        キャンセル
                                    </ModalSecondaryButton>
                                    <ModalPrimaryButton onClick={handleSave} disabled={editorApi.saving}>
                                        {editorApi.saving ? '作成中...' : '作成'}
                                    </ModalPrimaryButton>
                                </>
                            )}
                        </div>
                    </div>
                }
            >
                <ControlPanelTabs active={modals.activeTab} onChange={modals.switchTab} />
                {modals.activeTab === 'info' && <WorldInfoForm definition={definition} onChange={setDefinition} />}
                {modals.activeTab === 'mods' && (
                    <ModSelector
                        dependencies={definition.spec.dependencies ?? []}
                        onCommitDependencies={(next) =>
                            setDefinition((prev) => ({ ...prev, spec: { ...prev.spec, dependencies: next } }))
                        }
                    />
                )}
                {modals.activeTab === 'yaml' && (
                    <YamlEditorForm
                        yamlText={modals.yamlText}
                        yamlDirty={!!modals.yamlError}
                        onChange={modals.changeYamlText}
                        onFileUpload={modals.uploadYamlFile}
                    />
                )}

                {isEdit && (
                    <div className={css({ mt: '4' })}>
                        <PanelSection title="Danger Zone" defaultOpen={false}>
                            <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                                このワールドを削除します。この操作は取り消せません。
                            </p>
                            <button
                                type="button"
                                onClick={editorApi.remove}
                                disabled={editorApi.saving}
                                className={css({
                                    alignSelf: 'flex-start',
                                    padding: '8px 16px',
                                    bg: 'errorBg',
                                    color: 'errorText',
                                    border: '1px solid',
                                    borderColor: 'errorLight',
                                    borderRadius: '8px',
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                                    _hover: { opacity: 0.9 },
                                })}
                            >
                                このワールドを削除
                            </button>
                        </PanelSection>
                    </div>
                )}
            </Modal>

            <Modal
                open={leaveConfirmOpen}
                onClose={() => setLeaveConfirmOpen(false)}
                title="未保存の変更があります"
                width="440px"
                footer={
                    <div className={css({ display: 'flex', gap: '8px', width: '100%' })}>
                        <button
                            type="button"
                            onClick={() => setLeaveConfirmOpen(false)}
                            className={editorButton({ intent: 'secondary' })}
                        >
                            キャンセル
                        </button>
                        <div className={css({ marginLeft: 'auto', display: 'flex', gap: '8px' })}>
                            <button
                                type="button"
                                onClick={handleDiscardAndLeave}
                                className={editorButton({ intent: 'danger' })}
                            >
                                破棄して戻る
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveAndLeave}
                                className={editorButton({ intent: 'primary' })}
                            >
                                {isEdit ? '保存して戻る' : '作成'}
                            </button>
                        </div>
                    </div>
                }
            >
                <p className={css({ fontSize: '14px', color: 'textMuted', lineHeight: '1.6' })}>
                    変更が保存されていません。保存せずに戻ると変更が失われます。
                </p>
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
