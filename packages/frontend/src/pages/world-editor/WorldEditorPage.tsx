import type { InitialEntity, WorldDefinition } from '@ubichill/shared';
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
import { Modal } from './components/Modal';
import { ModalPrimaryButton, ModalSecondaryButton } from './components/ModalButtons';
import { type AvailableEntityKind, useAvailableEntityKinds } from './hooks/useAvailableEntityKinds';
import { useEditorModals } from './hooks/useEditorModals';
import { useWorldEditorApi } from './hooks/useWorldEditorApi';
import { DEFAULT_H, DEFAULT_W, nextZ } from './lib/dragHelpers';

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
    /** DB に保存済みの YAML テキスト。dirty 判定の baseline。 */
    const [savedYaml, setSavedYaml] = useState<string | null>(null);

    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    /** 編集ローカルで非表示にしているエンティティ。保存には影響しない。 */
    const [hiddenIndices, setHiddenIndices] = useState<Set<number>>(new Set());
    /** モバイル時のヒエラルキー drawer 開閉（md 以上では無視される） */
    const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
    const [loading, setLoading] = useState(isEdit);

    const dirty = useMemo(() => {
        if (savedYaml === null) return true;
        return yaml.stringify(definition) !== savedYaml;
    }, [definition, savedYaml]);

    const { kinds, loading: kindsLoading } = useAvailableEntityKinds(definition);
    const kindByName = useMemo(() => new Map(kinds.map((k) => [k.kind, k])), [kinds]);
    const placedKinds = useMemo(
        () => new Set(definition.spec.initialEntities.map((e) => e.kind)),
        [definition.spec.initialEntities],
    );

    const modals = useEditorModals({ definition, onCommit: setDefinition });
    const api = useWorldEditorApi({ isEdit, worldId, definition, onSavedYamlChange: setSavedYaml });

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
                api.setError(e instanceof Error ? e.message : '読み込み失敗');
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [worldId, isEdit, api.setError]);

    // 未認証は ProtectedRoute が弾くが、二重チェックとして useEffect でリダイレクト
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

    const patchEntityTransform = useCallback(
        (index: number, patch: Partial<InitialEntity['transform']>) => {
            updateEntities((prev) =>
                prev.map((e, i) => (i === index ? { ...e, transform: { ...e.transform, ...patch } } : e)),
            );
        },
        [updateEntities],
    );

    const handleAddEntity = useCallback(
        (k: AvailableEntityKind) => {
            if (k.singleton && placedKinds.has(k.kind)) return;
            const env = definition.spec.environment;
            const worldSize = env?.worldSize ?? { width: 2000, height: 1500 };
            const entities = definition.spec.initialEntities;
            const dt = k.defaultTransform ?? {};
            const initialData: Record<string, unknown> = {};
            if (k.dataFields) {
                for (const [name, spec] of Object.entries(k.dataFields)) {
                    if (spec.default !== undefined) initialData[name] = spec.default;
                }
            }
            const next: InitialEntity = {
                kind: k.kind,
                transform: {
                    x: dt.x ?? Math.round(worldSize.width / 2 - DEFAULT_W / 2),
                    y: dt.y ?? Math.round(worldSize.height / 2 - DEFAULT_H / 2),
                    z: dt.z ?? nextZ(entities),
                    w: dt.w ?? (k.suggestSize ? DEFAULT_W : undefined),
                    h: dt.h ?? (k.suggestSize ? DEFAULT_H : undefined),
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
        setSelectedIndex((cur) => (cur === index ? null : cur));
    }, []);

    // ---------- 保存（バリデーション + API 呼び出し） ----------
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
                // モバイル: header / center (preview) / bottom (assets) の 3 行レイアウト。
                // 左 (hierarchy) と右 (inspector) は drawer で重なる。
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
                    selectedIndex={selectedIndex}
                    hiddenIndices={hiddenIndices}
                    onSelect={(i) => {
                        setSelectedIndex(i);
                        // モバイルでヒエラルキーから選択したら drawer を閉じる（プレビュー & インスペクタを見せる）
                        setMobileLeftOpen(false);
                    }}
                    onDelete={handleDeleteEntity}
                    onToggleHidden={handleToggleHidden}
                />
            </DockSlot>

            <div className={css({ gridArea: 'center', minH: 0, minW: 0 })}>
                <EditorStage
                    definition={definition}
                    selectedIndex={selectedIndex}
                    hiddenIndices={hiddenIndices}
                    onSelect={setSelectedIndex}
                    onPatchTransform={patchEntityTransform}
                />
            </div>

            <DockSlot
                area="right"
                // インスペクタはエンティティが選択された時だけ右からスライドして出る (モバイル)
                mobileVisible={!!selectedEntity}
                mobileTitle="設定"
                onMobileClose={() => setSelectedIndex(null)}
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
            </DockSlot>

            {/* アセットは bottom = grid 内に常時表示 (モバイル時もプレビューに被らない常設トレイ) */}
            <DockSlot area="bottom" mobileVisible={true}>
                <EditorAssets kinds={kinds} loading={kindsLoading} placedKinds={placedKinds} onAdd={handleAddEntity} />
            </DockSlot>

            {/* モバイル: 左ハンドルでヒエラルキー drawer を開く (md 以上では非表示) */}
            {!mobileLeftOpen && <MobileLeftHandle onClick={() => setMobileLeftOpen(true)} />}

            {/* エラー通知 */}
            {api.error && (
                <div
                    onClick={() => api.setError('')}
                    className={css({
                        position: 'fixed',
                        bottom: { base: '152px', md: '232px' }, // モバイルは assets (140px) の上に出す
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
                        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    })}
                >
                    {api.error}
                    <span className={css({ ml: '2', opacity: 0.6, fontSize: '11px' })}>(クリックで閉じる)</span>
                </div>
            )}

            {/* モーダル: ワールド情報 */}
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

            {/* モーダル: YAML 編集 */}
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
