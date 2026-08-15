import { type WorldDefinition, WorldDefinitionSchema } from '@ubichill/shared';
import { useCallback, useState } from 'react';
import yaml from 'yaml';

export type ControlPanelTab = 'info' | 'publish' | 'mods' | 'yaml';

interface UseEditorModalsArgs {
    definition: WorldDefinition;
    /** definition を直接更新する（single source of truth）。YAML タブの parse 成功時のみ使う。 */
    onCommit: (next: WorldDefinition) => void;
}

/**
 * コントロールパネルの開閉・タブ・YAML バッファを集約する hook。
 *
 * 設計:
 * - フォーム（ワールド情報 / 公開設定 / mod管理）は親の `definition` を直接更新する。
 *   この hook は staging draft を持たない（閉じても破棄される編集が無い）。
 * - サーバーへの保存はこの hook の責務ではなく、呼び出し元（WorldEditorPage）が
 *   「閉じる」や「Cmd/Ctrl+S」で `useWorldEditorApi.save` を呼ぶ。
 * - YAML タブはテキスト用バッファ（yamlText）を持ち、有効な YAML の間だけ `onCommit` で
 *   definition へ反映する（途中の構文エラーは適用せず表示のみ）。
 */
export function useEditorModals({ definition, onCommit }: UseEditorModalsArgs) {
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<ControlPanelTab>('info');
    const [yamlText, setYamlText] = useState('');
    const [yamlError, setYamlError] = useState('');

    const openControlPanel = useCallback(
        (tab: ControlPanelTab = 'info') => {
            setYamlText(yaml.stringify(definition));
            setYamlError('');
            setActiveTab(tab);
            setOpen(true);
        },
        [definition],
    );

    const closeControlPanel = useCallback(() => {
        setOpen(false);
    }, []);

    // YAML タブに入る際は definition の最新状態からテキストを作り直す（他タブでの編集を反映）。
    const switchTab = useCallback(
        (tab: ControlPanelTab) => {
            if (tab === 'yaml') {
                setYamlText(yaml.stringify(definition));
                setYamlError('');
            }
            setActiveTab(tab);
        },
        [definition],
    );

    const changeYamlText = useCallback(
        (text: string) => {
            setYamlText(text);
            try {
                const parsed = yaml.parse(text) as unknown;
                const result = WorldDefinitionSchema.safeParse(parsed);
                if (result.success) {
                    onCommit(result.data);
                    setYamlError('');
                } else {
                    setYamlError(result.error.issues[0]?.message ?? 'スキーマ違反');
                }
            } catch (e) {
                setYamlError(e instanceof Error ? e.message : 'YAML parse error');
            }
        },
        [onCommit],
    );

    const uploadYamlFile = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                changeYamlText(text);
                setActiveTab('yaml');
            } finally {
                e.target.value = '';
            }
        },
        [changeYamlText],
    );

    return {
        open,
        activeTab,
        switchTab,
        openControlPanel,
        closeControlPanel,
        yamlText,
        yamlError,
        changeYamlText,
        uploadYamlFile,
    };
}
