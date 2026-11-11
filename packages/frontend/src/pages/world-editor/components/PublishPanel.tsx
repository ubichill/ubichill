import { css } from '@/styled-system/css';
import { type ActionFailure, failureTitle } from '../lib/actionFailure';
import { blockingChecks, type CheckTarget, type EditorCheck } from '../lib/editorChecks';
import { editorButton } from '../recipes/button';
import { StatusIcon } from './statusIcons';

interface PublishPanelProps {
    isEdit: boolean;
    dirty: boolean;
    saving: boolean;
    checks: readonly EditorCheck[];
    failure: ActionFailure | null;
    onGoTo: (target: CheckTarget) => void;
    onShowConsole: () => void;
    onCreateInstance: () => void;
    onSaveDraft: () => void;
    onPublish: () => void;
}

/**
 * コントロールパネルの下端。直すことの一覧・最後の失敗・保存と公開のボタンをまとめる。
 * 止める項目（error）があるうちは保存も公開も押せない。
 */
export function PublishPanel({
    isEdit,
    dirty,
    saving,
    checks,
    failure,
    onGoTo,
    onShowConsole,
    onCreateInstance,
    onSaveDraft,
    onPublish,
}: PublishPanelProps) {
    const blockers = blockingChecks(checks);
    const blockedReason = blockers[0]?.message;
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' })}>
            {failure && (
                <div
                    role="alert"
                    className={css({
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: 'errorLight',
                        bg: 'errorBg',
                        color: 'errorText',
                        fontSize: '12px',
                    })}
                >
                    <StatusIcon level="error" />
                    <div className={css({ flex: 1, minW: 0, userSelect: 'text' })}>
                        <div className={css({ fontWeight: '600' })}>{failureTitle(failure.stage)}</div>
                        <div className={css({ whiteSpace: 'pre-wrap', wordBreak: 'break-word' })}>
                            {failure.message}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onShowConsole}
                        className={editorButton({ intent: 'secondary', size: 'sm' })}
                    >
                        コンソール
                    </button>
                </div>
            )}
            <ul
                aria-label="確認すること"
                className={css({
                    display: 'flex',
                    flexDirection: 'column',
                    maxH: '132px',
                    overflowY: 'auto',
                    border: '1px solid',
                    borderColor: 'border',
                    borderRadius: '8px',
                    listStyle: 'none',
                    m: 0,
                    p: 0,
                })}
            >
                {checks.length === 0 && (
                    <li className={checkRow}>
                        <span className={css({ display: 'inline-flex', color: 'successText' })}>
                            <CheckIcon />
                        </span>
                        問題はありません
                    </li>
                )}
                {checks.map((check) => (
                    <li key={check.id} className={checkRow}>
                        <StatusIcon level={check.severity} />
                        <span className={css({ flex: 1, minW: 0, wordBreak: 'break-word' })}>{check.message}</span>
                        {check.target && (
                            <button
                                type="button"
                                onClick={() => check.target && onGoTo(check.target)}
                                className={editorButton({ intent: 'secondary', size: 'sm' })}
                            >
                                {check.target.kind === 'entity' ? '選択' : '開く'}
                            </button>
                        )}
                    </li>
                ))}
            </ul>
            <div
                className={css({
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                })}
            >
                <div>
                    {isEdit && !dirty && (
                        <button
                            type="button"
                            onClick={onCreateInstance}
                            disabled={saving}
                            title="このワールドで新しいインスタンスを作って参加する"
                            className={editorButton({ intent: 'success', size: 'lg' })}
                        >
                            <PlayIcon />
                            インスタンス作成
                        </button>
                    )}
                </div>
                <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end' })}>
                    <button
                        type="button"
                        onClick={onSaveDraft}
                        disabled={saving || !!blockedReason || (isEdit && !dirty)}
                        title={blockedReason ?? '公開中の版は変わりません。Cmd/Ctrl+S'}
                        className={editorButton({ intent: 'secondary', size: 'lg' })}
                    >
                        {isEdit ? '下書き保存' : '下書きとして作成'}
                    </button>
                </div>
            </div>
            <button
                type="button"
                onClick={onPublish}
                disabled={saving || !!blockedReason}
                title={blockedReason ?? 'あなたの作者アカウントで署名して公開します'}
                className={editorButton({ intent: 'primary', size: 'block' })}
            >
                {saving ? '処理中...' : isEdit ? '公開する' : '作成して公開'}
            </button>
        </div>
    );
}

const checkRow = css({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    fontSize: '12px',
    color: 'text',
    borderBottom: '1px solid',
    borderColor: 'border',
    _last: { borderBottom: 'none' },
});

function CheckIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M5 12l5 5L20 7" />
        </svg>
    );
}

function PlayIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 4l14 8-14 8z" />
        </svg>
    );
}
