import { type WorldDefinition, WorldDefinitionSchema } from '@ubichill/shared';
import { useCallback, useState } from 'react';
import yaml from 'yaml';

export type ControlPanelTab = 'publish' | 'mods' | 'yaml';

interface UseEditorModalsArgs {
    definition: WorldDefinition;
    onCommit: (next: WorldDefinition) => void;
}

/**
 * コントロールパネル（ワールド公開 / mod管理 / YAML の3タブ）の開閉・staging draft を集約する hook。
 *
 * 設計:
 * - 3タブは単一の `draft`（WorldDefinition）を共有する。「作成/保存」ボタンでのみ
 *   `onCommit(draft)` を通じて外側の definition を更新する。
 * - YAML タブはテキスト編集用の別バッファ（yamlText）を持つが、有効な YAML であれば
 *   即座に draft へ反映する（タブを切り替えても他タブに反映されるように）。
 * - 「キャンセル」または背景クリックで draft は破棄。
 */
export function useEditorModals({ definition, onCommit }: UseEditorModalsArgs) {
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<ControlPanelTab>('publish');
    const [draft, setDraft] = useState<WorldDefinition | null>(null);
    const [yamlText, setYamlText] = useState('');
    const [yamlError, setYamlError] = useState('');

    const openControlPanel = useCallback(
        (tab: ControlPanelTab = 'publish') => {
            setDraft(definition);
            setYamlText(yaml.stringify(definition));
            setYamlError('');
            setActiveTab(tab);
            setOpen(true);
        },
        [definition],
    );

    const closeControlPanel = useCallback(() => {
        setDraft(null);
        setOpen(false);
    }, []);

    // タブ切り替え時: YAML タブに入る際は draft の最新状態からテキストを作り直す
    // （他タブでのフィールド編集を YAML 表示に反映するため。逆方向は changeYamlText 側で処理）。
    const switchTab = useCallback(
        (tab: ControlPanelTab) => {
            if (tab === 'yaml' && draft) {
                setYamlText(yaml.stringify(draft));
                setYamlError('');
            }
            setActiveTab(tab);
        },
        [draft],
    );

    const changeYamlText = useCallback((text: string) => {
        setYamlText(text);
        try {
            const parsed = yaml.parse(text) as unknown;
            const result = WorldDefinitionSchema.safeParse(parsed);
            if (result.success) {
                setDraft(result.data);
                setYamlError('');
            } else {
                setYamlError(result.error.issues[0]?.message ?? 'スキーマ違反');
            }
        } catch (e) {
            setYamlError(e instanceof Error ? e.message : 'YAML parse error');
        }
    }, []);

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

    const applyControlPanel = useCallback(() => {
        if (draft) onCommit(draft);
        closeControlPanel();
    }, [draft, onCommit, closeControlPanel]);

    return {
        open,
        activeTab,
        switchTab,
        draft,
        setDraft,
        openControlPanel,
        closeControlPanel,
        applyControlPanel,
        yamlText,
        yamlError,
        changeYamlText,
        uploadYamlFile,
    };
}
