import { checkWorldCompatibility, type WorldRequirements, worldPublishProblem } from '@ubichill/shared';
import type { ControlPanelTab } from '../hooks/useEditorModals';

/** 確認項目から直しに行く先。タブはコントロールパネルのタブ、entity はヒエラルキーで選ぶ。 */
export type CheckTarget = { kind: 'tab'; tab: ControlPanelTab } | { kind: 'entity'; entityId: string };

/** error は保存・公開を止める（publishOnly なら公開だけ止め、下書きは保存できる）。warning は止めずに知らせる。 */
export interface EditorCheck {
    id: string;
    severity: 'error' | 'warning';
    publishOnly?: boolean;
    message: string;
    target?: CheckTarget;
}

/** 止めるかを決める操作。下書きは公開に要るもの（サムネイルなど）が揃っていなくても保存できる。 */
export type EditorAction = 'draft' | 'publish';

export interface EditorCheckInput {
    displayName: string;
    worldName: string;
    thumbnail?: string;
    /** YAML タブで書きかけのまま反映できていない内容があるときの理由 */
    yamlError: string;
    referenceProblems: ReadonlyArray<{ entityId: string; message: string }>;
    /** mod の取得・検証の失敗 */
    packagesError: string;
    /** ワールドがこの Host より新しい ubichill で保存されているときの知らせ */
    compatibility?: string;
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
        thumbnailCheck(input.thumbnail),
        input.packagesError
            ? {
                  id: 'packages',
                  severity: 'warning',
                  message: `mod を読み込めません: ${input.packagesError}`,
                  target: { kind: 'tab', tab: 'mods' },
              }
            : null,
        input.compatibility ? { id: 'compatibility', severity: 'warning', message: input.compatibility } : null,
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

function thumbnailCheck(thumbnail: string | undefined): EditorCheck | null {
    const problem = worldPublishProblem({ thumbnail });
    return problem
        ? { id: 'thumbnail', severity: 'error', publishOnly: true, message: problem, target: infoTab }
        : null;
}

/** ワールドがこの Host で一部動かない可能性があるときの知らせ（無ければ空）。 */
export function compatibilityMessage(requires: WorldRequirements | undefined, hostProtocol?: number): string {
    const result = checkWorldCompatibility(requires, hostProtocol);
    return result.level === 'ok' ? '' : result.message;
}

/** その操作を止める項目。 */
export function blockingChecks(checks: readonly EditorCheck[], action: EditorAction = 'publish'): EditorCheck[] {
    return checks.filter((check) => check.severity === 'error' && (action === 'publish' || !check.publishOnly));
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
