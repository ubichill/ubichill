import {
    DEFAULT_SERVER_BRANDING,
    DEFAULT_THEME_PRIMARY,
    MIN_THEME_CONTRAST,
    SERVER_BRANDING_LIMITS,
    type ServerBranding,
    type ServerImageKind,
    themeCssVariables,
} from '@ubichill/shared';
import { type CSSProperties, useEffect, useId, useState } from 'react';
import { CameraIcon, TrashIcon } from '@/components/profile/profileIcons';
import { removeBrandingImage, updateBranding, uploadBrandingImage } from '@/lib/admin/brandingApi';
import { type BrandingDraft, brandingChanged, brandingDraft, checkThemeColor } from '@/lib/admin/brandingForm';
import { imageFileProblem, PROFILE_IMAGE_ACCEPT } from '@/lib/profile/imageFile';
import { loadServerOverview, setServerBranding, useServerOverview } from '@/lib/server/serverInfo';
import { css, cva } from '@/styled-system/css';
import { adminButton, adminError, adminField, adminLabel } from './adminStyles';

const errorText = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

/** ブランディング（管理者）。画像は選んだらすぐ置き換え、色と略称は保存で反映する。 */
export function BrandingSection() {
    const overview = useServerOverview();
    useEffect(() => {
        void loadServerOverview();
    }, []);

    if (overview === null) return <section className={section} aria-busy />;
    if (overview === 'failed') {
        return (
            <section className={section}>
                <p className={adminError}>読み込めませんでした</p>
            </section>
        );
    }
    const branding = overview.branding ?? DEFAULT_SERVER_BRANDING;
    return (
        <>
            <ImagesSection branding={branding} />
            <ThemeSection branding={branding} serverName={overview.info.name} />
        </>
    );
}

function ImagesSection({ branding }: { branding: ServerBranding }) {
    const [busy, setBusy] = useState<ServerImageKind | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async (kind: ServerImageKind, action: () => Promise<ServerBranding>, fallback: string) => {
        setBusy(kind);
        setError(null);
        try {
            setServerBranding(await action());
        } catch (e) {
            setError(errorText(e, fallback));
        } finally {
            setBusy(null);
        }
    };

    const choose = (kind: ServerImageKind, file: File) => {
        const problem = imageFileProblem(file);
        if (problem) {
            setError(problem);
            return;
        }
        void run(kind, () => uploadBrandingImage(kind, file), '画像を置き換えられませんでした');
    };

    const remove = (kind: ServerImageKind) => void run(kind, () => removeBrandingImage(kind), '画像を外せませんでした');

    return (
        <section className={section}>
            <h2 className={heading}>アイコンとバナー</h2>
            <div className={imageGrid}>
                <ImageField
                    kind="icon"
                    label="アイコン"
                    hint="ブラウザーのタブ・ホーム画面・紹介のページに出します。正方形に切り抜きます。"
                    src={branding.icon?.icon192 ?? '/icon.png'}
                    custom={branding.icon !== null}
                    busy={busy}
                    onChoose={choose}
                    onRemove={remove}
                />
                <ImageField
                    kind="banner"
                    label="バナー"
                    hint="紹介のページの上と、リンクを共有したときのカードに出します。1200×630 に切り抜きます。"
                    src={branding.banner}
                    custom={branding.banner !== null}
                    busy={busy}
                    onChoose={choose}
                    onRemove={remove}
                />
            </div>
            {error && (
                <p className={adminError} role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}

function ImageField({
    kind,
    label,
    hint,
    src,
    custom,
    busy,
    onChoose,
    onRemove,
}: {
    kind: ServerImageKind;
    label: string;
    hint: string;
    /** 今の画像（バナーが無ければ null） */
    src: string | null;
    /** 置いた画像か（既定の画像なら「外す」を出さない） */
    custom: boolean;
    busy: ServerImageKind | null;
    onChoose: (kind: ServerImageKind, file: File) => void;
    onRemove: (kind: ServerImageKind) => void;
}) {
    const id = useId();
    const disabled = busy !== null;
    return (
        <div className={imageField} aria-busy={busy === kind}>
            <span className={adminLabel} id={`${id}-label`}>
                {label}
            </span>
            <div className={preview({ kind })}>{src && <img src={src} alt="" className={previewImage} />}</div>
            <div className={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}>
                <label className={adminButton()} aria-disabled={disabled}>
                    <input
                        type="file"
                        accept={PROFILE_IMAGE_ACCEPT}
                        disabled={disabled}
                        aria-labelledby={`${id}-label`}
                        aria-describedby={`${id}-hint`}
                        className={css({ srOnly: true })}
                        onChange={(e) => {
                            const file = e.currentTarget.files?.[0];
                            // 同じファイルをもう一度選んでも変更として届くように空にする
                            e.currentTarget.value = '';
                            if (file) onChoose(kind, file);
                        }}
                    />
                    <CameraIcon size={15} />
                    {busy === kind ? '置き換えています...' : '画像を選ぶ'}
                </label>
                {custom && (
                    <button
                        type="button"
                        className={adminButton({ tone: 'danger' })}
                        disabled={disabled}
                        onClick={() => onRemove(kind)}
                    >
                        <TrashIcon size={15} />
                        外す
                    </button>
                )}
            </div>
            <span id={`${id}-hint`} className={hintText}>
                {hint}
            </span>
        </div>
    );
}

function ThemeSection({ branding, serverName }: { branding: ServerBranding; serverName: string }) {
    const id = useId();
    const [draft, setDraft] = useState<BrandingDraft>(() => brandingDraft(branding));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    // 保存した値が変わったら（保存した・ほかの管理者が変えたのを読み直した）、入力欄もそれに合わせる
    const { shortName, themeColor } = branding;
    useEffect(() => {
        setDraft({ shortName: shortName ?? '', themeColor: themeColor ?? '' });
    }, [shortName, themeColor]);

    const check = checkThemeColor(draft.themeColor);
    const previewColor = check.state === 'ok' || check.state === 'low-contrast' ? check.color : DEFAULT_THEME_PRIMARY;
    const colorProblem = check.state === 'invalid' || check.state === 'low-contrast' ? check.problem : null;

    const edit = (patch: Partial<BrandingDraft>) => {
        setSaved(false);
        setError(null);
        setDraft((d) => ({ ...d, ...patch }));
    };

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            setServerBranding(await updateBranding(draft));
            setSaved(true);
        } catch (e) {
            setError(errorText(e, '保存できませんでした'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className={section}>
            <h2 className={heading}>テーマの色と略称</h2>
            <form
                className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
                onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                }}
            >
                <div className={adminLabel}>
                    <label htmlFor={`${id}-color`}>テーマの色</label>
                    <div className={colorRow}>
                        <input
                            type="color"
                            aria-label="テーマの色を選ぶ"
                            className={swatch}
                            value={previewColor}
                            disabled={busy}
                            onChange={(e) => edit({ themeColor: e.target.value })}
                        />
                        <input
                            id={`${id}-color`}
                            aria-describedby={`${id}-color-hint`}
                            aria-invalid={colorProblem !== null}
                            className={adminField({ grow: true })}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={DEFAULT_THEME_PRIMARY}
                            maxLength={7}
                            value={draft.themeColor}
                            disabled={busy}
                            onChange={(e) => edit({ themeColor: e.target.value })}
                        />
                        {draft.themeColor !== '' && (
                            <button
                                type="button"
                                className={adminButton()}
                                disabled={busy}
                                onClick={() => edit({ themeColor: '' })}
                            >
                                既定の色に戻す
                            </button>
                        )}
                    </div>
                    <span id={`${id}-color-hint`} className={hintText}>
                        ボタンなどの主な色。ボタンの文字が読めるよう、コントラスト比 {MIN_THEME_CONTRAST}{' '}
                        以上の暗い色にします。
                    </span>
                    {/* 保存する前に、決めた色で作った色の組でボタンを描いて見せる */}
                    <div className={previewRow} style={themeCssVariables(previewColor) as CSSProperties}>
                        <span className={sampleButton} aria-hidden>
                            新規登録
                        </span>
                        {check.state !== 'default' && check.state !== 'invalid' && (
                            <span className={hintText}>コントラスト比 {check.ratio.toFixed(2)}</span>
                        )}
                    </div>
                    {colorProblem && (
                        <span className={adminError} role="alert">
                            {colorProblem}
                        </span>
                    )}
                </div>
                <div className={adminLabel}>
                    <label htmlFor={`${id}-short-name`}>略称</label>
                    <input
                        id={`${id}-short-name`}
                        aria-describedby={`${id}-short-name-hint`}
                        className={adminField()}
                        autoComplete="off"
                        maxLength={SERVER_BRANDING_LIMITS.shortName}
                        placeholder={serverName}
                        value={draft.shortName}
                        disabled={busy}
                        onChange={(e) => edit({ shortName: e.target.value })}
                    />
                    <span id={`${id}-short-name-hint`} className={hintText}>
                        ホーム画面に追加したときのアイコンの名前と、ワールドのページの見出しに出します。空ならサーバー名。
                    </span>
                </div>
                {error && (
                    <p className={adminError} role="alert">
                        {error}
                    </p>
                )}
                <div className={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
                    <button
                        type="submit"
                        className={adminButton({ tone: 'primary' })}
                        disabled={busy || colorProblem !== null || !brandingChanged(branding, draft)}
                    >
                        {busy ? '保存しています...' : '保存'}
                    </button>
                    <span role="status" className={hintText}>
                        {saved ? '保存しました' : ''}
                    </span>
                </div>
            </form>
        </section>
    );
}

const section = css({
    p: '4',
    bg: 'surface',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '3',
});
const heading = css({ fontSize: 'lg', fontWeight: '700', color: 'text' });
const hintText = css({ fontSize: '12px', fontWeight: '400', color: 'textMuted', lineHeight: '1.6' });
const imageGrid = css({ display: 'grid', gridTemplateColumns: { base: '1fr', md: '160px 1fr' }, gap: '5' });
const imageField = css({ display: 'flex', flexDirection: 'column', gap: '2', minW: 0 });
const preview = cva({
    base: {
        overflow: 'hidden',
        bg: 'background',
        border: '1px dashed',
        borderColor: 'borderStrong',
    },
    variants: {
        kind: {
            icon: { w: '96px', h: '96px', borderRadius: '20px' },
            banner: { w: 'full', aspectRatio: '1200 / 630', borderRadius: '10px' },
        },
    },
});
const previewImage = css({ display: 'block', w: 'full', h: 'full', objectFit: 'cover' });
const colorRow = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' });
const swatch = css({
    w: '40px',
    h: '36px',
    p: '0.5',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    bg: 'background',
    cursor: 'pointer',
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});
const previewRow = css({ display: 'flex', alignItems: 'center', gap: '3', mt: '1' });
const sampleButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    px: '4',
    py: '2',
    borderRadius: '10px',
    bg: 'primary',
    color: 'textOnPrimary',
    fontSize: '13px',
    fontWeight: '700',
});
