import { type WorldDefinition, WorldDefinitionSchema } from '@ubichill/shared';
import { useCallback, useState } from 'react';
import yaml from 'yaml';

export type EditorModal = 'info' | 'yaml' | null;

interface UseEditorModalsArgs {
    definition: WorldDefinition;
    onCommit: (next: WorldDefinition) => void;
}

/**
 * ワールド情報モーダルと YAML モーダルの開閉・staging draft を集約する hook。
 *
 * 設計:
 * - 各モーダルは「draft」を内部で保持し、ユーザーが「適用」したときにだけ
 *   `onCommit(definition)` を通じて外側の definition を更新する。
 * - 「キャンセル」または背景クリックで draft は破棄。
 */
export function useEditorModals({ definition, onCommit }: UseEditorModalsArgs) {
    const [openModal, setOpenModal] = useState<EditorModal>(null);

    // ---------- info モーダル ----------
    const [infoDraft, setInfoDraft] = useState<WorldDefinition | null>(null);

    const openInfo = useCallback(() => {
        setInfoDraft(definition);
        setOpenModal('info');
    }, [definition]);
    const applyInfo = useCallback(() => {
        if (infoDraft) onCommit(infoDraft);
        setInfoDraft(null);
        setOpenModal(null);
    }, [infoDraft, onCommit]);
    const cancelInfo = useCallback(() => {
        setInfoDraft(null);
        setOpenModal(null);
    }, []);

    // ---------- yaml モーダル ----------
    const [yamlDraft, setYamlDraft] = useState<string>('');
    const [yamlDraftError, setYamlDraftError] = useState<string>('');

    const openYaml = useCallback(() => {
        setYamlDraft(yaml.stringify(definition));
        setYamlDraftError('');
        setOpenModal('yaml');
    }, [definition]);

    const changeYamlDraft = useCallback((text: string) => {
        setYamlDraft(text);
        try {
            const parsed = yaml.parse(text) as unknown;
            const result = WorldDefinitionSchema.safeParse(parsed);
            setYamlDraftError(result.success ? '' : (result.error.issues[0]?.message ?? 'スキーマ違反'));
        } catch (e) {
            setYamlDraftError(e instanceof Error ? e.message : 'YAML parse error');
        }
    }, []);

    const applyYaml = useCallback(() => {
        try {
            const parsed = yaml.parse(yamlDraft) as unknown;
            const result = WorldDefinitionSchema.safeParse(parsed);
            if (!result.success) {
                setYamlDraftError(result.error.issues[0]?.message ?? 'スキーマ違反');
                return;
            }
            onCommit(result.data);
            setOpenModal(null);
            setYamlDraftError('');
        } catch (e) {
            setYamlDraftError(e instanceof Error ? e.message : 'YAML parse error');
        }
    }, [yamlDraft, onCommit]);

    const cancelYaml = useCallback(() => {
        setYamlDraftError('');
        setOpenModal(null);
    }, []);

    // ---------- ファイルアップロード（YAML draft に書き込み） ----------
    const uploadYamlFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            setYamlDraft(text);
            setOpenModal('yaml');
            setYamlDraftError('');
        } finally {
            e.target.value = '';
        }
    }, []);

    return {
        openModal,
        // info
        infoDraft,
        setInfoDraft,
        openInfo,
        applyInfo,
        cancelInfo,
        // yaml
        yamlDraft,
        yamlDraftError,
        openYaml,
        changeYamlDraft,
        applyYaml,
        cancelYaml,
        uploadYamlFile,
    };
}
