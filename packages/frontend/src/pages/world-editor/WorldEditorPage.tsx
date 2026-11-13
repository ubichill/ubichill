import {
    assertPackageReplacement,
    createModLock,
    instantiatePrefab,
    lockedMods,
    WorldDefinitionSchema,
} from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PackagePicker } from '@/components/mods/PackagePicker';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { confirmModUpdate } from '@/lib/mods/confirmUpdate';
import { useSession } from '@/lib/session';
import { css } from '@/styled-system/css';
import { EditorAssets } from './components/assets/EditorAssets';
import { type BottomDockTab, BottomDockTabs } from './components/BottomDockTabs';
import { ControlPanelTabs } from './components/ControlPanelTabs';
import { ConsoleActions, EditorConsole } from './components/console/EditorConsole';
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
import { PanelSection } from './components/PanelSection';
import { PrefabControls } from './components/PrefabControls';
import { PublishPanel } from './components/PublishPanel';
import { PublishSetupDialog } from './components/PublishSetupDialog';
import { useAvailableEntityKinds } from './hooks/useAvailableEntityKinds';
import { useDefinition } from './hooks/useDefinition';
import { useEditorConsole, useLogNewWarnings } from './hooks/useEditorConsole';
import { useEditorModals } from './hooks/useEditorModals';
import { useEntityOps } from './hooks/useEntityOps';
import { useEntitySelection } from './hooks/useEntitySelection';
import { useMobilePanels } from './hooks/useMobilePanels';
import { usePublishSetup } from './hooks/usePublishSetup';
import { type SaveResult, useWorldEditorApi } from './hooks/useWorldEditorApi';
import { failureTitle, stageLabel } from './lib/actionFailure';
import { SNAP_STEP } from './lib/dragHelpers';
import {
    blockingChecks,
    type CheckTarget,
    compatibilityMessage,
    controlPanelAlert,
    editorChecks,
} from './lib/editorChecks';
import { consoleCounts } from './lib/editorConsole';
import { findEntityPath, flattenForStage, getEntityAt, updateEntityAt } from './lib/entityTree';
import { editorReferenceProblems, problemsByEntity } from './lib/referenceProblems';
import { withSavedFields } from './lib/savedDefinition';
import { editorButton } from './recipes/button';

export function WorldEditorPage() {
    const { worldId } = useParams<{ worldId?: string }>();
    const navigate = useNavigate();
    const confirm = useConfirm();
    const { data: session, isPending } = useSession();
    const isEdit = !!worldId;

    // エラーはコンソールに溜め、直近の 1 件だけ画面下のトーストでも知らせる
    const editorConsole = useEditorConsole();
    const [error, setError] = useState('');
    const [bottomTab, setBottomTab] = useState<BottomDockTab>('assets');
    const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
    const { log } = editorConsole;
    const reportError = useCallback(
        (source: string, message: string) => {
            setError(message);
            if (message) log({ level: 'error', source, message });
        },
        [log],
    );
    const reportLoadError = useCallback((message: string) => reportError('読み込み', message), [reportError]);
    const reportEditorError = useCallback((message: string) => reportError('エディタ', message), [reportError]);

    const { definition, setDefinition, setSavedYaml, loading, dirty, updateEntities, publishState, setPublishState } =
        useDefinition({
            isEdit,
            worldId,
            onError: reportLoadError,
        });

    const currentDefinition = useRef(definition);
    currentDefinition.current = definition;

    const handleSaveResult = useCallback(
        (result: SaveResult) => {
            if (!result.ok) {
                // コンソールは出どころの欄に段階が出るので、文は理由だけにする
                setError(`${failureTitle(result.stage)}: ${result.message}`);
                log({ level: 'error', source: stageLabel(result.stage), message: result.message });
                return;
            }
            const message = result.stage === 'publish' ? '公開しました' : '下書きを保存しました';
            log({ level: 'info', source: stageLabel(result.stage), message });
        },
        [log],
    );

    const publishSetup = usePublishSetup();
    const editorApi = useWorldEditorApi({
        requestPublishSetup: publishSetup.request,
        isEdit,
        worldId,
        definition,
        publishState,
        dirty,
        // 保存を待つ間の編集を残すため、エディタが決めた項目だけ差し替える（違いは未保存として残る）
        onSaved: (text, fields) => {
            setSavedYaml(text);
            setDefinition((prev) => withSavedFields(prev, fields));
        },
        onPublishStateChange: setPublishState,
        onResult: handleSaveResult,
        onError: reportEditorError,
    });

    const { kinds, packages, error: packagesError, loading: kindsLoading } = useAvailableEntityKinds(definition);
    const modals = useEditorModals({ definition, onCommit: setDefinition });

    const openedPackage = useRef(false);
    useEffect(() => {
        if (!loading && !openedPackage.current && new URLSearchParams(window.location.search).has('addMod')) {
            openedPackage.current = true;
            modals.openControlPanel('mods');
        }
    }, [loading, modals.openControlPanel]);

    const selection = useEntitySelection();
    const ops = useEntityOps({ definition, updateEntities, kinds, selection });
    const referenceProblemList = useMemo(
        () => editorReferenceProblems(definition.spec.initialEntities, kinds),
        [definition.spec.initialEntities, kinds],
    );
    const referenceProblems = useMemo(() => problemsByEntity(referenceProblemList), [referenceProblemList]);
    const checks = useMemo(
        () =>
            editorChecks({
                displayName: definition.spec.displayName,
                worldName: definition.metadata.name,
                yamlError: modals.activeTab === 'yaml' ? modals.yamlError : '',
                referenceProblems: referenceProblemList,
                packagesError,
                compatibility: compatibilityMessage(definition.spec.requires),
            }),
        [
            definition.spec.displayName,
            definition.metadata.name,
            definition.spec.requires,
            modals.activeTab,
            modals.yamlError,
            referenceProblemList,
            packagesError,
        ],
    );
    const consoleWarnings = useMemo(
        () =>
            checks
                .filter((check) => check.severity === 'warning')
                .map((check) => ({
                    source: check.target?.kind === 'entity' ? '参照' : 'mod',
                    message: check.message,
                })),
        [checks],
    );
    useLogNewWarnings(consoleWarnings, log);
    const mobile = useMobilePanels();

    // 認証ガード
    useEffect(() => {
        if (!isPending && !session) navigate('/auth');
    }, [isPending, session, navigate]);

    const flatNodes = useMemo(
        () => flattenForStage(definition.spec.initialEntities),
        [definition.spec.initialEntities],
    );

    // 止める項目があれば保存しない（ボタンは押せないが Cmd/Ctrl+S・閉じる時の保存はここを通る）
    const validate = useCallback((): boolean => {
        const blocker = blockingChecks(checks)[0];
        if (blocker) {
            reportError('エディタ', blocker.message);
            return false;
        }
        setError('');
        return true;
    }, [checks, reportError]);

    // 下書き保存（準備不要）。公開中のワールドでも公開中の版は変わらない。
    const saveDraft = useCallback(async () => validate() && editorApi.saveDraft(), [validate, editorApi]);
    // 作者アカウントで署名して公開（準備が足りなければ公開の準備ダイアログ）。
    const publish = useCallback(async () => validate() && editorApi.publish(), [validate, editorApi]);

    const handleSave = useCallback(() => {
        void saveDraft();
    }, [saveDraft]);

    // コントロールパネルを閉じる。編集モードでは未保存の変更を保存してから閉じる。
    // 新規作成時は閉じるだけで破棄する（作成は「作成」ボタン or Cmd/Ctrl+S）。
    const handleCloseControlPanel = useCallback(() => {
        if (isEdit) {
            if (modals.activeTab === 'yaml' && modals.yamlError) {
                reportError('YAML', modals.yamlError);
                return;
            }
            if (dirty) void saveDraft();
        }
        modals.closeControlPanel();
    }, [isEdit, dirty, saveDraft, reportError, modals.activeTab, modals.yamlError, modals.closeControlPanel]);

    // 確認項目の「開く / 選択」。Entity はコントロールパネルを閉じてヒエラルキーで選ぶ。
    const goToCheck = useCallback(
        (target: CheckTarget) => {
            if (target.kind === 'tab') {
                modals.switchTab(target.tab);
                return;
            }
            const path = findEntityPath(definition.spec.initialEntities, target.entityId);
            if (!path) return;
            selection.selectEntity(path);
            modals.closeControlPanel();
        },
        [modals.switchTab, modals.closeControlPanel, definition.spec.initialEntities, selection.selectEntity],
    );

    const showConsole = useCallback(() => {
        setError('');
        setBottomTab('console');
        modals.closeControlPanel();
    }, [modals.closeControlPanel]);

    const consoleCount = useMemo(() => consoleCounts(editorConsole.entries), [editorConsole.entries]);
    const headerAlert = useMemo(
        () =>
            controlPanelAlert(
                editorApi.failure ? `${failureTitle(editorApi.failure.stage)}: ${editorApi.failure.message}` : null,
                checks,
            ),
        [editorApi.failure, checks],
    );

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
        const ok = await saveDraft();
        if (ok && isEdit) navigate(-1);
    }, [saveDraft, isEdit, navigate]);

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
                gridTemplateRows: { base: 'auto 1fr 168px', md: 'auto 1fr 220px' },
                gridTemplateColumns: { base: 'minmax(0, 1fr)', md: '240px minmax(0, 1fr) 320px' },
                gridTemplateAreas: {
                    base: `"header" "center" "bottom"`,
                    md: `"header header header" "left center right" "bottom bottom bottom"`,
                },
                bg: 'background',
                color: 'text',
                overflow: 'hidden',
            })}
        >
            <div className={css({ gridArea: 'header', minW: 0 })}>
                <EditorHeader
                    title={title}
                    dirty={dirty}
                    snapEnabled={mobile.snapEnabled}
                    onToggleSnap={mobile.toggleSnap}
                    onBack={handleBack}
                    onOpenControlPanel={() => modals.openControlPanel()}
                    publishState={isEdit ? publishState : null}
                    alert={headerAlert}
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
                    referenceProblems={referenceProblems}
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
                    <>
                        <PrefabControls
                            key={selectedEntity.id}
                            entity={selectedEntity}
                            packages={packages}
                            entities={definition.spec.initialEntities}
                            onChange={(next) => {
                                const path = selection.selectedPath;
                                if (path) updateEntities((prev) => updateEntityAt(prev, path, () => next));
                            }}
                        />
                        <EntityInspector
                            entity={selectedEntity}
                            initiallyExpandedComponentIndex={selection.selectedComponentIndex}
                            availableKinds={kinds}
                            allEntities={definition.spec.initialEntities}
                            referenceProblems={referenceProblems.get(selectedEntity.id) ?? []}
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
                    </>
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
                <BottomDockTabs
                    active={bottomTab}
                    onChange={setBottomTab}
                    counts={consoleCount}
                    actions={
                        bottomTab === 'console' && (
                            <ConsoleActions entries={editorConsole.entries} onClear={editorConsole.clear} />
                        )
                    }
                />
                {bottomTab === 'console' ? (
                    <EditorConsole entries={editorConsole.entries} />
                ) : (
                    <EditorAssets
                        kinds={kinds}
                        loading={kindsLoading}
                        dependencies={definition.spec.dependencies ?? []}
                        packages={packages}
                        onAddPrefab={(pkg, name) => {
                            try {
                                const prefab = pkg.manifest.prefabs?.[name];
                                if (!prefab) return;
                                const next = instantiatePrefab(
                                    pkg.entry,
                                    name,
                                    prefab,
                                    pkg.manifest.components,
                                    definition.spec.initialEntities,
                                    `prefab-${crypto.randomUUID().slice(0, 12)}`,
                                );
                                setDefinition(
                                    WorldDefinitionSchema.parse({
                                        ...definition,
                                        spec: {
                                            ...definition.spec,
                                            initialEntities: [...definition.spec.initialEntities, next],
                                        },
                                    }),
                                );
                            } catch (e) {
                                reportError('配置', e instanceof Error ? e.message : '配置できません');
                            }
                        }}
                    />
                )}
            </DockSlot>

            {!mobile.leftOpen && <MobileLeftHandle onClick={mobile.openLeft} />}
            {selectedEntity && !mobile.rightOpen && <MobileRightHandle onClick={mobile.openRight} />}

            {error && (
                <button
                    type="button"
                    onClick={showConsole}
                    className={css({
                        position: 'fixed',
                        bottom: { base: '180px', md: '232px' },
                        left: { base: '12px', md: '252px' },
                        right: { base: '12px', md: '332px' },
                        padding: '8px 12px',
                        bg: 'errorBg',
                        color: 'errorText',
                        border: '1px solid',
                        borderColor: 'errorLight',
                        borderRadius: '8px',
                        fontSize: '13px',
                        zIndex: 99999,
                        cursor: 'pointer',
                        boxShadow: 'toast',
                        textAlign: 'left',
                    })}
                >
                    {error}
                    <span className={css({ ml: '2', opacity: 0.7, fontSize: '12px' })}>コンソールで見る</span>
                </button>
            )}

            <Modal
                open={modals.open}
                onClose={handleCloseControlPanel}
                title="コントロールパネル"
                width="960px"
                height="calc(100vh - 32px)"
                footer={
                    <PublishPanel
                        isEdit={isEdit}
                        dirty={dirty}
                        saving={editorApi.saving}
                        checks={checks}
                        failure={editorApi.failure}
                        onGoTo={goToCheck}
                        onShowConsole={showConsole}
                        onCreateInstance={editorApi.createInstance}
                        onSaveDraft={handleSave}
                        onPublish={() => void publish()}
                    />
                }
            >
                <ControlPanelTabs active={modals.activeTab} onChange={modals.switchTab} />
                {modals.activeTab === 'info' && <WorldInfoForm definition={definition} onChange={setDefinition} />}
                {modals.activeTab === 'mods' && (
                    <>
                        <PackagePicker
                            initialRef={new URLSearchParams(window.location.search).get('addMod') ?? ''}
                            onInstall={async (pkg) => {
                                const current = currentDefinition.current;
                                const deps = current.spec.dependencies ?? [];
                                const old = deps.find((d) => d.name === pkg.entry.id);
                                if (old && old.source.author !== pkg.entry.author)
                                    throw new Error('同名の別作者の mod が入っています');
                                const previous = lockedMods(current.spec.lock)[pkg.entry.id];
                                assertPackageReplacement(previous, pkg.entry);
                                const proposed = createModLock({
                                    ...lockedMods(current.spec.lock),
                                    [pkg.entry.id]: pkg.entry,
                                });
                                if (!(await confirmModUpdate(current.spec.lock, proposed, confirm))) return false;
                                if (
                                    JSON.stringify(lockedMods(currentDefinition.current.spec.lock)[pkg.entry.id]) !==
                                    JSON.stringify(previous)
                                )
                                    throw new Error('確認中に mod が変わりました。読み直して追加してください');
                                setDefinition((prev) => ({
                                    ...prev,
                                    spec: {
                                        ...prev.spec,
                                        dependencies: [
                                            ...(prev.spec.dependencies ?? []).filter((d) => d.name !== pkg.entry.id),
                                            {
                                                name: pkg.entry.id,
                                                source: {
                                                    author: pkg.entry.author,
                                                    url: pkg.entry.baseUrl,
                                                    version: pkg.entry.version,
                                                },
                                            },
                                        ],
                                        lock: createModLock({
                                            ...lockedMods(prev.spec.lock),
                                            [pkg.entry.id]: pkg.entry,
                                        }),
                                    },
                                }));
                                return true;
                            }}
                        />
                        {packagesError && <p role="alert">{packagesError}</p>}
                        <ModSelector
                            key={JSON.stringify([
                                definition.spec.dependencies,
                                definition.spec.lock,
                                definition.spec.requires,
                            ])}
                            dependencies={definition.spec.dependencies ?? []}
                            lock={definition.spec.lock}
                            requires={definition.spec.requires}
                            onCommit={({ dependencies, lock, requires }) =>
                                setDefinition((prev) => ({
                                    ...prev,
                                    spec: {
                                        ...prev.spec,
                                        dependencies,
                                        ...(lock ? { lock } : {}),
                                        ...(requires ? { requires } : {}),
                                    },
                                }))
                            }
                        />
                    </>
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
                    <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' })}>
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
                                {isEdit ? '下書き保存して戻る' : '下書きとして作成'}
                            </button>
                        </div>
                    </div>
                }
            >
                <p className={css({ fontSize: '14px', color: 'textMuted', lineHeight: '1.6' })}>
                    変更が保存されていません。保存せずに戻ると変更が失われます。
                </p>
            </Modal>
            {/* 他のモーダル（コントロールパネル等）から保存しても最前面に出るよう最後に描画する */}
            {publishSetup.pending && <PublishSetupDialog {...publishSetup.pending} />}
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
