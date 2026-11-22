import { formatBytes, type StorageOverview, type StoredFile, WORLD_ASSET_UNUSED_GRACE_DAYS } from '@ubichill/shared';
import { useEffect, useRef, useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { socialButton } from '@/components/social/buttons';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { Switch } from '@/components/ui/Switch';
import { deleteConfirmation, fileKey, usageRatio, usageTone, withoutFiles, withPage } from '@/lib/account/storage';
import {
    deleteStoredFiles,
    fetchMyStorage,
    fetchMyStoredFiles,
    updateMyStorageSettings,
} from '@/lib/account/storageApi';
import { pushToast } from '@/lib/toast';
import { css, cva } from '@/styled-system/css';
import { settingsGroup, settingsHeading, settingsNote } from './settingsStyles';

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('ja-JP');

/**
 * 設定の「ストレージ」: 使っている量・上げた画像の一覧（ページごとに読む。1 個ずつ・チェックしてまとめて消す）・
 * 使われていない画像を自動で消すか。どれもその場で反映する。消すのは、自分のワールドで使っている画像があるときだけ確かめる。
 */
export function StorageSection() {
    const confirm = useConfirm();
    const [overview, setOverview] = useState<StorageOverview | null>(null);
    const [error, setError] = useState('');
    const [savingSettings, setSavingSettings] = useState(false);
    const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
    const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
    const [loadingMore, setLoadingMore] = useState(false);

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

    const loadMore = async (cursor: string) => {
        setLoadingMore(true);
        try {
            const page = await fetchMyStoredFiles(cursor);
            setOverview((current) => current && withPage(current, page));
        } catch (e) {
            pushToast(e instanceof Error ? e.message : '読み込めませんでした', 'error');
        } finally {
            setLoadingMore(false);
        }
    };

    const remove = async (files: StoredFile[]) => {
        const question = deleteConfirmation(files);
        if (question && !(await confirm(question))) return;
        const keys = files.map(fileKey);
        const mark = (on: boolean) => (prev: ReadonlySet<string>) => {
            const next = new Set(prev);
            for (const key of keys) {
                if (on) next.add(key);
                else next.delete(key);
            }
            return next;
        };
        setDeleting(mark(true));
        try {
            // 頼んだものは、もう無かったもの（ほかの端末で消した）も含めて一覧から外す
            await deleteStoredFiles(files);
            setOverview((current) => current && withoutFiles(current, files));
            setChecked(mark(false));
        } catch (e) {
            pushToast(e instanceof Error ? e.message : '消せませんでした', 'error');
        } finally {
            setDeleting(mark(false));
        }
    };

    if (!overview) {
        return error ? <p className={css({ fontSize: '13px', color: 'errorText' })}>{error}</p> : null;
    }

    const tone = usageTone(overview.usage, overview.quotaBytes);
    const shown = `${formatBytes(overview.usage.bytes)} / ${formatBytes(overview.quotaBytes)}`;
    const items = overview.files.items;
    const checkedFiles = items.filter((file) => checked.has(fileKey(file)));
    const allChecked = items.length > 0 && checkedFiles.length === items.length;
    const toggle = (file: StoredFile, on: boolean) =>
        setChecked((prev) => {
            const next = new Set(prev);
            if (on) next.add(fileKey(file));
            else next.delete(fileKey(file));
            return next;
        });

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
                description={`上げてから ${WORLD_ASSET_UNUSED_GRACE_DAYS} 日たち、このサーバーのどのワールドにも使われていない画像を消します。`}
                on={overview.autoCleanup}
                disabled={savingSettings}
                onChange={(next) => void changeAutoCleanup(next)}
            />

            <section className={settingsGroup}>
                <h3 className={settingsHeading}>上げた画像</h3>
                <p className={settingsNote}>
                    消すと、このサーバーで同じ画像を使うほかの人のワールドでも出なくなります。
                </p>
                {items.length === 0 ? (
                    <p className={settingsNote}>ありません。</p>
                ) : (
                    <>
                        <div className={toolbar}>
                            <Check
                                label="読み込んだ画像をすべて選ぶ"
                                checked={allChecked}
                                indeterminate={checkedFiles.length > 0 && !allChecked}
                                onChange={(on) => setChecked(new Set(on ? items.map(fileKey) : []))}
                            />
                            <span aria-live="polite" className={css({ flex: 1 })}>
                                {checkedFiles.length > 0 ? `${checkedFiles.length} 個を選択` : ''}
                            </span>
                            {checkedFiles.length > 0 && (
                                <button
                                    type="button"
                                    className={socialButton({ tone: 'danger' })}
                                    disabled={checkedFiles.some((file) => deleting.has(fileKey(file)))}
                                    onClick={() => void remove(checkedFiles)}
                                >
                                    {checkedFiles.length} 個を消す
                                </button>
                            )}
                        </div>
                        <ul className={css({ display: 'flex', flexDirection: 'column' })}>
                            {items.map((file) => (
                                <FileRow
                                    key={fileKey(file)}
                                    file={file}
                                    checked={checked.has(fileKey(file))}
                                    busy={deleting.has(fileKey(file))}
                                    onCheck={(on) => toggle(file, on)}
                                    onDelete={() => void remove([file])}
                                />
                            ))}
                        </ul>
                        {overview.files.next && (
                            <MoreButton
                                loading={loadingMore}
                                onMore={() => overview.files.next && void loadMore(overview.files.next)}
                            />
                        )}
                    </>
                )}
            </section>
        </div>
    );
}

/** 続きを読む。見えるところまでスクロールしたら自動で読み、押しても読める。 */
function MoreButton({ loading, onMore }: { loading: boolean; onMore: () => void }) {
    const ref = useRef<HTMLButtonElement>(null);
    const latest = useRef(onMore);
    latest.current = onMore;
    useEffect(() => {
        const target = ref.current;
        if (!target || loading || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) latest.current();
        });
        observer.observe(target);
        return () => observer.disconnect();
    }, [loading]);
    return (
        <button
            ref={ref}
            type="button"
            className={socialButton({ tone: 'secondary' })}
            disabled={loading}
            onClick={onMore}
        >
            {loading ? '読み込み中...' : 'もっと見る'}
        </button>
    );
}

function Check({
    label,
    checked,
    indeterminate = false,
    onChange,
}: {
    label: string;
    checked: boolean;
    indeterminate?: boolean;
    onChange: (checked: boolean) => void;
}) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (ref.current) ref.current.indeterminate = indeterminate;
    }, [indeterminate]);
    return (
        <input
            ref={ref}
            type="checkbox"
            aria-label={label}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className={checkbox}
        />
    );
}

function FileRow({
    file,
    checked,
    busy,
    onCheck,
    onDelete,
}: {
    file: StoredFile;
    checked: boolean;
    busy: boolean;
    onCheck: (on: boolean) => void;
    onDelete: () => void;
}) {
    const usedIn = file.usedBy.map((use) => use.worldName).join('・');
    return (
        <li className={row({ busy })}>
            <Check
                label={`${formatDate(file.createdAt)} の ${formatBytes(file.bytes)} の画像を選ぶ`}
                checked={checked}
                onChange={onCheck}
            />
            <a href={file.url} target="_blank" rel="noreferrer" className={thumbLink} aria-label="画像を開く">
                <img src={file.url} alt="" loading="lazy" decoding="async" className={thumb} />
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

const toolbar = css({
    display: 'flex',
    alignItems: 'center',
    gap: '3',
    minH: '32px',
    fontSize: '12px',
    color: 'textMuted',
});

const checkbox = css({
    flexShrink: 0,
    w: '18px',
    h: '18px',
    accentColor: 'primary',
    cursor: 'pointer',
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
