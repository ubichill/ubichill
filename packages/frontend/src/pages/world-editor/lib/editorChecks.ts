import type { ControlPanelTab } from '../hooks/useEditorModals';

/** 確認項目から直しに行く先。タブはコントロールパネルのタブ、entity はヒエラルキーで選ぶ。 */
export type CheckTarget = { kind: 'tab'; tab: ControlPanelTab } | { kind: 'entity'; entityId: string };

/** error は保存・公開を止める。warning は止めずに知らせる。 */
export interface EditorCheck {
    id: string;
    severity: 'error' | 'warning';
    message: string;
    target?: CheckTarget;
}

export interface EditorCheckInput {
    displayName: string;
    worldName: string;
    /** YAML タブで書きかけのまま反映できていない内容があるときの理由 */
    yamlError: string;
    referenceProblems: ReadonlyArray<{ entityId: string; message: string }>;
    /** mod の取得・検証の失敗 */
    packagesError: string;
}

/** 保存・公開の前に作者に見せる確認項目。error を先に並べる。 */
export function editorChecks(input: EditorCheckInput): EditorCheck[] {
    const checks: Array<EditorCheck | null> = [
        input.yamlError
            ? {
                  id: 'yaml',
                  severity: 'error',
                  message: `YAML を反映できません: ${input.yamlError}`,
                  target: { kind: 'tab', tab: 'yaml' },
              }
            : null,
        input.displayName.trim()
            ? null
            : { id: 'displayName', severity: 'error', message: '表示名を決めてください', target: infoTab },
        input.worldName
            ? null
            : { id: 'worldName', severity: 'error', message: '名前（URL）を決めてください', target: infoTab },
        input.packagesError
            ? {
                  id: 'packages',
                  severity: 'warning',
                  message: `mod を読み込めません: ${input.packagesError}`,
                  target: { kind: 'tab', tab: 'mods' },
              }
            : null,
        ...input.referenceProblems.map(
            ({ entityId, message }, index): EditorCheck => ({
                id: `ref:${index}:${entityId}`,
                severity: 'warning',
                message: `${entityId}: ${message}`,
                target: { kind: 'entity', entityId },
            }),
        ),
    ];
    const present = checks.filter((check): check is EditorCheck => check !== null);
    return [...present.filter((c) => c.severity === 'error'), ...present.filter((c) => c.severity === 'warning')];
}

const infoTab: CheckTarget = { kind: 'tab', tab: 'info' };

/** 保存・公開を止める項目。 */
export function blockingChecks(checks: readonly EditorCheck[]): EditorCheck[] {
    return checks.filter((check) => check.severity === 'error');
}

/** コントロールパネルのボタンに出す印。失敗や直すことがあるときだけ。 */
export interface ControlPanelAlert {
    level: 'error' | 'warning';
    count: number;
    /** ホバーで見せる、いちばん重い 1 件 */
    summary: string;
}

/** コントロールパネルのボタンの印。最後の失敗を最優先し、次に止める項目、最後に警告。何も無ければ出さない。 */
export function controlPanelAlert(failure: string | null, checks: readonly EditorCheck[]): ControlPanelAlert | null {
    const summary = failure ?? checks[0]?.message;
    if (!summary) return null;
    return {
        level: failure || checks.some((c) => c.severity === 'error') ? 'error' : 'warning',
        count: checks.length + (failure ? 1 : 0),
        summary,
    };
}
