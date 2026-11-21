import {
    BOT_CHECK_ACTIONS,
    BOT_PROTECTION_PROVIDER_LABELS,
    type BotProtectionProvider,
    type BotProtectionSettings,
} from '@ubichill/shared';
import { useCallback, useEffect, useId, useState } from 'react';
import { BotCheck } from '@/components/auth/BotCheck';
import { type Choice, ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { fetchBotProtectionSettings, updateBotProtection } from '@/lib/admin/botProtectionApi';
import {
    type BotProtectionDraft,
    botProtectionDraftState,
    canReuseSecret,
    draftFrom,
} from '@/lib/admin/botProtectionForm';
import { css } from '@/styled-system/css';
import { adminButton, adminError, adminField, adminLabel } from './adminStyles';

type ProviderChoice = BotProtectionProvider | 'none';

const CHOICES: ReadonlyArray<Choice<ProviderChoice>> = [
    { value: 'none', label: '使わない' },
    { value: 'turnstile', label: BOT_PROTECTION_PROVIDER_LABELS.turnstile },
    { value: 'hcaptcha', label: BOT_PROTECTION_PROVIDER_LABELS.hcaptcha },
];

/** 鍵を作るページ */
const KEY_PAGES: Readonly<Record<BotProtectionProvider, { url: string; label: string }>> = {
    turnstile: { url: 'https://dash.cloudflare.com/?to=/:account/turnstile', label: 'Cloudflare のダッシュボード' },
    hcaptcha: { url: 'https://dashboard.hcaptcha.com/sites', label: 'hCaptcha のダッシュボード' },
};

/** サイトキーを打ち終えてからウィジェットを作る（1 文字ごとに作り直さない） */
const SETTLE_MS = 600;

/**
 * ボット対策（管理者）。新規登録（メールアドレス・フェディバース）とパスワードでのログインで、ボットでないことを Turnstile か hCaptcha で
 * 確かめる。保存の前に、入れた鍵の組でウィジェットを通してもらい、サーバーで確かめてから保存する。
 */
export function BotProtectionSection() {
    const id = useId();
    const [settings, setSettings] = useState<BotProtectionSettings | null>(null);
    const [draft, setDraft] = useState<BotProtectionDraft | null>(null);
    const [settledSiteKey, setSettledSiteKey] = useState('');
    // 送ったトークンは使えなくなるので、失敗したらウィジェットを作り直す
    const [round, setRound] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        fetchBotProtectionSettings()
            .then((current) => {
                setSettings(current);
                setDraft(draftFrom(current));
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : '読み込めませんでした'));
    }, []);

    const siteKey = draft?.siteKey.trim() ?? '';
    useEffect(() => {
        const timer = setTimeout(() => setSettledSiteKey(siteKey), SETTLE_MS);
        return () => clearTimeout(timer);
    }, [siteKey]);

    const setToken = useCallback((token: string | null) => setDraft((d) => d && { ...d, token }), []);

    if (!settings || !draft) {
        return (
            <section className={section}>
                <h2 className={heading}>ボット対策</h2>
                {error && <p className={adminError}>{error}</p>}
            </section>
        );
    }

    const state = botProtectionDraftState(settings, draft);
    const provider = draft.provider;
    const showCheck =
        provider !== null &&
        siteKey !== '' &&
        settledSiteKey === siteKey &&
        state.kind !== 'unchanged' &&
        !(state.kind === 'incomplete' && state.missing === 'siteKey');

    // ウィジェットの callback と同じ描画の間に入っても、届いたトークンを古い draft で消さない
    const edit = (patch: Partial<BotProtectionDraft>) => {
        setSaved(false);
        setError(null);
        setDraft((d) => d && { ...d, ...patch });
    };

    const choose = (next: ProviderChoice) => {
        const chosen = next === 'none' ? null : next;
        // 保存済みのサービスに戻したら、そのサイトキーに戻す
        edit({
            provider: chosen,
            siteKey: chosen !== null && settings.config?.provider === chosen ? settings.config.siteKey : '',
            secret: '',
            token: null,
        });
    };

    const save = async () => {
        if (state.kind !== 'ready') return;
        setBusy(true);
        setError(null);
        try {
            const next = await updateBotProtection(state.update);
            setSettings(next);
            setDraft(draftFrom(next));
            setSaved(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : '保存できませんでした');
            setRound((n) => n + 1);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className={section}>
            <h2 className={heading}>ボット対策</h2>
            <p className={lead}>
                新規登録（メールアドレス・フェディバース）とパスワードでのログインで、ボットでないことを確かめます。
            </p>
            {!settings.secretReadable && (
                <p className={adminError} role="alert">
                    保存したシークレットキーを読めないため、新規登録とパスワードでのログインを止めています（サーバーの秘密を入れ替えたときなど）。シークレットキーを入れ直すか、使わないにしてください。
                </p>
            )}
            <form
                className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}
                onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                }}
            >
                <ChoiceGroup
                    label="ボット対策のサービス"
                    choices={CHOICES}
                    value={provider ?? 'none'}
                    disabled={busy}
                    onChange={choose}
                />
                {provider !== null && (
                    <>
                        <label className={adminLabel} htmlFor={`${id}-site`}>
                            サイトキー
                            <input
                                id={`${id}-site`}
                                className={adminField()}
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                value={draft.siteKey}
                                disabled={busy}
                                onChange={(e) => edit({ siteKey: e.target.value })}
                            />
                        </label>
                        <label className={adminLabel} htmlFor={`${id}-secret`}>
                            シークレットキー
                            <input
                                id={`${id}-secret`}
                                className={adminField()}
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={canReuseSecret(settings, provider) ? '保存済み（変えるときだけ入力）' : ''}
                                value={draft.secret}
                                disabled={busy}
                                onChange={(e) => edit({ secret: e.target.value })}
                            />
                        </label>
                        <p className={hint}>
                            <a className={link} href={KEY_PAGES[provider].url} target="_blank" rel="noreferrer">
                                {KEY_PAGES[provider].label}
                            </a>
                            で作ります。ホスト名には {window.location.hostname} を入れてください。
                        </p>
                    </>
                )}
                {showCheck && provider !== null && (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '1.5' })}>
                        <p className={hint}>保存の前に、この鍵で確かめます。</p>
                        <BotCheck
                            key={`${provider}:${settledSiteKey}:${round}`}
                            provider={provider}
                            siteKey={settledSiteKey}
                            action={BOT_CHECK_ACTIONS.settings}
                            onToken={setToken}
                            failureHint="サイトキーと、サービスの側に入れたホスト名を確かめてください。"
                        />
                    </div>
                )}
                {error && (
                    <p className={adminError} role="alert">
                        {error}
                    </p>
                )}
                <div className={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
                    <button
                        type="submit"
                        className={adminButton({ tone: 'primary' })}
                        disabled={busy || state.kind !== 'ready'}
                    >
                        {busy ? '確かめています...' : '保存'}
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
const hint = css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6' });
const link = css({ color: 'primary', textDecoration: 'underline' });
