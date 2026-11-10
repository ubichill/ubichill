import { DOMAIN_POLICY_LABELS } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import {
    type DomainPolicy,
    fetchDomainPolicies,
    fetchFederationServers,
    setDomainPolicy,
} from '@/lib/admin/federationApi';
import { css, cva } from '@/styled-system/css';
import { domainFromInput, type ServerRow, serverRows } from './serverRows';

const POLICIES: readonly DomainPolicy[] = ['allow', 'limit', 'block'];

/**
 * ほかのサーバーとの付き合い方（管理者）。どの ubichill のサーバーとも、フレンド・招待・来訪でつながるのが既定で、
 * 問題のあるサーバーだけを絞る。連合しないにすると、そのサーバーの人とのフレンドも切れる。
 */
export function ServerPoliciesSection() {
    const confirm = useConfirm();
    const [rows, setRows] = useState<ServerRow[] | null>(null);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [servers, policies] = await Promise.all([fetchFederationServers(), fetchDomainPolicies()]);
            setRows(serverRows(servers, policies, Date.now()));
        } catch (e) {
            setError(e instanceof Error ? e.message : '読み込めませんでした');
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const apply = async (domain: string, policy: DomainPolicy) => {
        if (
            policy === 'block' &&
            !(await confirm(`${domain} と連合しないようにしますか？ このサーバーの人とのフレンドも切れます。`))
        ) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await setDomainPolicy(domain, policy);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : '変えられませんでした');
        } finally {
            setBusy(false);
        }
    };

    const domain = domainFromInput(draft);

    return (
        <section className={section}>
            <h2 className={heading}>ほかのサーバー</h2>
            <p className={lead}>
                どの ubichill のサーバーの人とも、フレンド・招待・来訪でつながります。問題のあるサーバーだけを絞れます。
            </p>
            <form
                className={css({ display: 'flex', gap: '2', flexWrap: 'wrap', mb: '3' })}
                onSubmit={(e) => {
                    e.preventDefault();
                    if (!domain) return;
                    void apply(domain, 'limit').then(() => setDraft(''));
                }}
            >
                <input
                    className={input}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="spam.example"
                    aria-label="絞るサーバーのドメイン"
                />
                <button type="submit" className={button({ tone: 'primary' })} disabled={busy || !domain}>
                    絞る
                </button>
            </form>
            {error && <p className={css({ fontSize: '13px', color: 'errorText', mb: '2' })}>{error}</p>}
            {rows && rows.length === 0 && (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                    まだどのサーバーともつながっていません。
                </p>
            )}
            {rows && rows.length > 0 && (
                <ul className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
                    {rows.map((row) => (
                        <li key={row.domain} className={rowStyle} data-policy={row.policy}>
                            <span className={css({ color: 'textMuted', display: 'flex' })}>
                                <HudIcon name="globe" size={18} />
                            </span>
                            <span className={domainText}>{row.domain}</span>
                            {row.unreachable && <span className={badge}>届かない</span>}
                            <select
                                className={select}
                                value={row.policy}
                                disabled={busy}
                                aria-label={`${row.domain} との付き合い方`}
                                onChange={(e) => {
                                    const next = POLICIES.find((p) => p === e.target.value);
                                    if (next) void apply(row.domain, next);
                                }}
                            >
                                {POLICIES.map((p) => (
                                    <option key={p} value={p}>
                                        {DOMAIN_POLICY_LABELS[p]}
                                    </option>
                                ))}
                            </select>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

const section = css({ mb: '6', p: '4', bg: 'surface', borderRadius: '12px' });
const heading = css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '1' });
const lead = css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6', mb: '3' });

const input = css({
    flex: 1,
    minWidth: '200px',
    px: '3',
    py: '2',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    fontSize: '14px',
    bg: 'background',
    color: 'text',
});

const button = cva({
    base: {
        padding: '8px 14px',
        border: 'none',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease',
        _disabled: { opacity: 0.4, cursor: 'not-allowed' },
    },
    variants: {
        tone: { primary: { bg: 'primary', color: 'textOnPrimary', _hover: { bg: 'primaryHover' } } },
    },
});

const rowStyle = css({
    display: 'flex',
    alignItems: 'center',
    gap: '3',
    px: '3',
    py: '2',
    borderRadius: '8px',
    bg: 'background',
    '&[data-policy=block]': { opacity: 0.7 },
});

const domainText = css({
    flex: 1,
    minWidth: 0,
    fontSize: '14px',
    fontWeight: '600',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const badge = css({
    flexShrink: 0,
    px: '1.5',
    py: '0.5',
    borderRadius: '4px',
    bg: 'errorBg',
    color: 'errorText',
    fontSize: '11px',
    fontWeight: '700',
});

const select = css({
    flexShrink: 0,
    px: '2',
    py: '1.5',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    bg: 'surface',
    color: 'text',
    fontSize: '13px',
    cursor: 'pointer',
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});
