import { formatBytes, type StorageOverview, type StoredFile, WORLD_ASSET_UNUSED_GRACE_DAYS } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { Switch } from '@/components/ui/Switch';
import { deleteConfirmation, usageRatio, usageTone, withoutFile } from '@/lib/account/storage';
import { deleteStoredFile, fetchMyStorage, updateMyStorageSettings } from '@/lib/account/storageApi';
import { pushToast } from '@/lib/toast';
import { css, cva } from '@/styled-system/css';
import { settingsGroup, settingsHeading, settingsNote } from './settingsStyles';

const fileKey = (file: StoredFile) => `${file.kind}:${file.id}`;
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('ja-JP');

/**
 * 設定の「ストレージ」: 使っている量・上げた画像の一覧（消す）・使われていない画像を自動で消すか。どれもその場で反映する。
 * 消すのは、自分のワールドで使っている画像のときだけ確かめる（ワールドの画像が出なくなるため）。
 */
export function StorageSection() {
    const confirm = useConfirm();
    const [overview, setOverview] = useState<StorageOverview | null>(null);
    const [error, setError] = useState('');
    const [savingSettings, setSavingSettings] = useState(false);
    const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());

    useEffect(() => {
        const ctrl = { cancelled: false };
        fetchMyStorage()
            .then((data) => !ctrl.cancelled && setOverview(data))
            .catch((e: unknown) => !ctrl.cancelled && setError(e instanceof Error ? e.message : '読み込めません'));
        return () => {
            ctrl.cancelled = true;
        };
    }, []);

    const changeAutoCleanup = async (autoCleanup: boolean) => {
        setSavingSettings(true);
        try {
            const saved = await updateMyStorageSettings({ autoCleanup });
            setOverview((current) => current && { ...current, ...saved });
        } catch (e) {
            pushToast(e instanceof Error ? e.message : '変更できませんでした', 'error');
        } finally {
            setSavingSettings(false);
        }
    };

    const remove = async (file: StoredFile) => {
        const question = deleteConfirmation(file);
        if (question && !(await confirm(question))) return;
        const key = fileKey(file);
        setDeleting((prev) => new Set(prev).add(key));
        try {
            await deleteStoredFile(file);
            setOverview((current) => current && withoutFile(current, file));
        } catch (e) {
            pushToast(e instanceof Error ? e.message : '消せませんでした', 'error');
        } finally {
            setDeleting((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    };

    if (!overview) {
        return error ? <p className={css({ fontSize: '13px', color: 'errorText' })}>{error}</p> : null;
    }

    const tone = usageTone(overview.usage, overview.quotaBytes);
    const shown = `${formatBytes(overview.usage.bytes)} / ${formatBytes(overview.quotaBytes)}`;

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '6' })}>
            <section className={settingsGroup}>
                <div
                    className={css({
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: '3',
                    })}
                >
                    <h3 className={settingsHeading}>使っている量</h3>
                    <span className={css({ fontSize: '13px', color: 'textMuted', fontVariantNumeric: 'tabular-nums' })}>
                        {shown}・{overview.usage.count} 個
                    </span>
                </div>
                <div
                    role="meter"
                    aria-label="使っている量"
                    aria-valuemin={0}
                    aria-valuemax={overview.quotaBytes}
                    aria-valuenow={Math.min(overview.usage.bytes, overview.quotaBytes)}
                    aria-valuetext={shown}
                    className={meterTrack}
                >
                    {/* 割合は実行時の値なので style で渡す */}
                    <div
                        className={meterFill({ tone })}
                        style={{ width: `${usageRatio(overview.usage, overview.quotaBytes) * 100}%` }}
                    />
                </div>
                {tone === 'full' && (
                    <p className={css({ fontSize: '12px', color: 'errorText' })}>
                        いっぱいです。画像を消すまで、新しく上げられません。
                    </p>
                )}
            </section>

            <Switch
                title="使われていない画像を自動で消す"
                description={`上げてから ${WORLD_ASSET_UNUSED_GRACE_DAYS} 日たち、どのワールドにも使われていない画像を消します。`}
                on={overview.autoCleanup}
                disabled={savingSettings}
                onChange={(next) => void changeAutoCleanup(next)}
            />

            <section className={settingsGroup}>
                <h3 className={settingsHeading}>上げた画像</h3>
                {overview.files.length === 0 ? (
                    <p className={settingsNote}>ありません。</p>
                ) : (
                    <ul className={css({ display: 'flex', flexDirection: 'column' })}>
                        {overview.files.map((file) => (
                            <FileRow
                                key={fileKey(file)}
                                file={file}
                                busy={deleting.has(fileKey(file))}
                                onDelete={() => void remove(file)}
                            />
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function FileRow({ file, busy, onDelete }: { file: StoredFile; busy: boolean; onDelete: () => void }) {
    const usedIn = file.usedBy.map((use) => use.worldName).join('・');
    return (
        <li className={row({ busy })}>
            <a href={file.url} target="_blank" rel="noreferrer" className={thumbLink} aria-label="画像を開く">
                <img src={file.url} alt="" loading="lazy" className={thumb} />
            </a>
            <div className={css({ display: 'flex', flexDirection: 'column', gap: '0.5', minW: 0, flex: 1 })}>
                <span className={css({ fontSize: '13px', color: 'text', fontVariantNumeric: 'tabular-nums' })}>
                    {formatBytes(file.bytes)}・{file.width} × {file.height}
                </span>
                <span className={css({ fontSize: '12px', color: 'textMuted' })}>{formatDate(file.createdAt)}</span>
                {usedIn && <span className={usedTag}>{usedIn}で使用中</span>}
            </div>
            <button type="button" className={deleteButton} aria-label="消す" disabled={busy} onClick={onDelete}>
                <HudIcon name="trash" size={16} />
            </button>
        </li>
    );
}

const meterTrack = css({ h: '8px', borderRadius: 'full', bg: 'surfaceAccent', overflow: 'hidden' });

const meterFill = cva({
    base: { h: 'full', borderRadius: 'full', transition: 'width 0.2s ease' },
    variants: {
        tone: { normal: { bg: 'primary' }, near: { bg: 'warning' }, full: { bg: 'error' } },
    },
});

const row = cva({
    base: {
        display: 'flex',
        alignItems: 'center',
        gap: '3',
        py: '2.5',
        borderBottom: '1px solid',
        borderColor: 'surfaceAccent',
        _last: { borderBottom: 'none' },
    },
    variants: { busy: { true: { opacity: 0.5 } } },
});

const thumbLink = css({ flexShrink: 0, borderRadius: '8px', overflow: 'hidden', lineHeight: 0 });

const thumb = css({
    w: '64px',
    h: '64px',
    objectFit: 'cover',
    bg: 'surfaceAccent',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
});

const usedTag = css({
    alignSelf: 'flex-start',
    maxW: 'full',
    px: '1.5',
    py: '0.5',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '700',
    color: 'textMuted',
    bg: 'surfaceAccent',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const deleteButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    w: '32px',
    h: '32px',
    border: 'none',
    borderRadius: 'full',
    bg: 'transparent',
    color: 'textMuted',
    cursor: 'pointer',
    _hover: { bg: 'errorBg', color: 'errorText' },
    _disabled: { opacity: 0.4, cursor: 'not-allowed' },
});
