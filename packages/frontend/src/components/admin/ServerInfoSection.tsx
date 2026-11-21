import {
    SERVER_INFO_LIMITS,
    type ServerInfo,
    type ServerInfoSettings,
    UBICHILL_REPOSITORY_URL,
} from '@ubichill/shared';
import { useEffect, useId, useState } from 'react';
import { fetchServerInfoSettings, updateServerInfo } from '@/lib/admin/serverInfoApi';
import { type ServerInfoDraft, serverInfoChanged, serverInfoDraft } from '@/lib/admin/serverInfoForm';
import { css } from '@/styled-system/css';
import { adminButton, adminError, adminField, adminLabel } from './adminStyles';

type Field = {
    key: Exclude<keyof ServerInfo, 'name' | 'description'>;
    label: string;
    type: 'text' | 'email' | 'url';
    hint?: string;
};

const MAINTAINER: readonly Field[] = [
    { key: 'maintainerName', label: '管理者の名前', type: 'text' },
    { key: 'maintainerEmail', label: '管理者のメールアドレス', type: 'email' },
];

const LINKS: readonly Field[] = [
    { key: 'tosUrl', label: '利用規約の URL', type: 'url' },
    { key: 'privacyPolicyUrl', label: 'プライバシーポリシーの URL', type: 'url' },
    {
        key: 'inquiryUrl',
        label: '問い合わせ先の URL',
        type: 'url',
        hint: '問い合わせのフォームや、運営者の連絡先が載ったページ。',
    },
    {
        key: 'repositoryUrl',
        label: 'ソースコードの URL',
        type: 'url',
        hint: `手を加えて動かしているなら、そのソースコードの公開先。空なら ${UBICHILL_REPOSITORY_URL} を出します。`,
    },
    {
        key: 'impressumUrl',
        label: '運営者情報の URL',
        type: 'url',
        hint: 'ドイツなど、一部の国と地域では載せることが求められています（Impressum）。',
    },
];

/** サーバーの情報（管理者）。紹介のページ・ログインの画面・ほかのサーバー（NodeInfo）に出る。 */
export function ServerInfoSection() {
    const id = useId();
    const [settings, setSettings] = useState<ServerInfoSettings | null>(null);
    const [draft, setDraft] = useState<ServerInfoDraft | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        fetchServerInfoSettings()
            .then((current) => {
                setSettings(current);
                setDraft(serverInfoDraft(current.info));
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : '読み込めませんでした'));
    }, []);

    if (!settings || !draft) {
        return (
            <section className={section}>
                <h2 className={heading}>サーバーの情報</h2>
                {error && <p className={adminError}>{error}</p>}
            </section>
        );
    }

    const edit = (patch: Partial<ServerInfoDraft>) => {
        setSaved(false);
        setError(null);
        setDraft((d) => d && { ...d, ...patch });
    };

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            const next = await updateServerInfo(draft);
            setSettings(next);
            setDraft(serverInfoDraft(next.info));
            setSaved(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : '保存できませんでした');
        } finally {
            setBusy(false);
        }
    };

    const input = (field: Field) => (
        <label key={field.key} className={adminLabel} htmlFor={`${id}-${field.key}`}>
            {field.label}
            <input
                id={`${id}-${field.key}`}
                className={adminField()}
                type={field.type}
                inputMode={field.type === 'text' ? undefined : field.type}
                autoComplete="off"
                spellCheck={false}
                placeholder={field.type === 'url' ? 'https://' : undefined}
                value={draft[field.key]}
                disabled={busy}
                onChange={(e) => edit({ [field.key]: e.target.value })}
            />
            {field.hint && <span className={hint}>{field.hint}</span>}
        </label>
    );

    return (
        <section className={section}>
            <h2 className={heading}>サーバーの情報</h2>
            <p className={lead}>
                紹介のページとログインの画面に出します。ほかのサーバーにも伝わるので、公開してよいものだけを入れてください。
            </p>
            <form
                className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
                onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                }}
            >
                <label className={adminLabel} htmlFor={`${id}-name`}>
                    サーバー名
                    <input
                        id={`${id}-name`}
                        className={adminField()}
                        autoComplete="off"
                        maxLength={SERVER_INFO_LIMITS.name}
                        value={draft.name}
                        disabled={busy}
                        required
                        onChange={(e) => edit({ name: e.target.value })}
                    />
                </label>
                <label className={adminLabel} htmlFor={`${id}-description`}>
                    サーバーの紹介
                    <textarea
                        id={`${id}-description`}
                        className={adminField({ multiline: true })}
                        rows={4}
                        maxLength={SERVER_INFO_LIMITS.description}
                        value={draft.description}
                        disabled={busy}
                        onChange={(e) => edit({ description: e.target.value })}
                    />
                    <span className={hint}>どんな人が集まる場所か。空なら Ubichill の紹介を出します。</span>
                </label>
                <div className={pair}>{MAINTAINER.map(input)}</div>
                {LINKS.map(input)}
                {error && (
                    <p className={adminError} role="alert">
                        {error}
                    </p>
                )}
                <div className={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
                    <button
                        type="submit"
                        className={adminButton({ tone: 'primary' })}
                        disabled={busy || !serverInfoChanged(settings.info, draft)}
                    >
                        {busy ? '保存しています...' : '保存'}
                    </button>
                    <span role="status" className={hint}>
                        {saved ? '保存しました' : ''}
                    </span>
                </div>
            </form>
        </section>
    );
}

const section = css({ p: '4', bg: 'surface', borderRadius: '12px' });
const heading = css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '1' });
const lead = css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6', mb: '3' });
const hint = css({ fontSize: '12px', fontWeight: '400', color: 'textMuted', lineHeight: '1.6' });
const pair = css({ display: 'grid', gridTemplateColumns: { base: '1fr', md: '1fr 1fr' }, gap: '4' });
