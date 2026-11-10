import { describe, expect, it } from 'vitest';
import type { DomainPolicyRecord, FederationServer } from '@/lib/admin/federationApi';
import { domainFromInput, serverRows } from './serverRows';

const NOW = Date.parse('2026-11-07T00:00:00Z');
const server = (domain: string, extra: Partial<FederationServer> = {}): FederationServer => ({
    domain,
    software: 'ubichill',
    version: '1',
    federationVersion: 1,
    firstSeenAt: '2026-11-01T00:00:00Z',
    lastSeenAt: '2026-11-06T00:00:00Z',
    lastSuccessAt: '2026-11-06T00:00:00Z',
    failingSince: null,
    pausedUntil: null,
    policy: 'allow',
    ...extra,
});
const policy = (domain: string, p: 'limit' | 'block'): DomainPolicyRecord => ({
    domain,
    policy: p,
    reason: null,
    createdAt: '2026-11-01T00:00:00Z',
});

describe('serverRows', () => {
    it('絞っているサーバーを先に、ほかは最近連絡のあった順', () => {
        const rows = serverRows(
            [
                server('old.example', { lastSeenAt: '2026-11-01T00:00:00Z' }),
                server('new.example', { lastSeenAt: '2026-11-06T12:00:00Z' }),
                server('spam.example'),
            ],
            [policy('spam.example', 'block'), policy('quiet.example', 'limit')],
            NOW,
        );
        expect(rows.map((r) => [r.domain, r.policy])).toEqual([
            ['spam.example', 'block'],
            ['quiet.example', 'limit'],
            ['new.example', 'allow'],
            ['old.example', 'allow'],
        ]);
    });

    it('親ドメインの方針で絞られているサーバーは、サーバー側の方針を出す', () => {
        const rows = serverRows(
            [server('a.spam.example', { policy: 'block' })],
            [policy('spam.example', 'block')],
            NOW,
        );
        expect(rows.find((r) => r.domain === 'a.spam.example')?.policy).toBe('block');
    });

    it('続けて失敗している・止めているサーバーは届かない印を付ける（止める時刻が過ぎたら外す）', () => {
        const rows = serverRows(
            [
                server('down.example', { failingSince: '2026-11-05T00:00:00Z' }),
                server('paused.example', { pausedUntil: '2026-11-07T01:00:00Z' }),
                server('resumed.example', { pausedUntil: '2026-11-06T00:00:00Z' }),
            ],
            [],
            NOW,
        );
        expect(Object.fromEntries(rows.map((r) => [r.domain, r.unreachable]))).toEqual({
            'down.example': true,
            'paused.example': true,
            'resumed.example': false,
        });
    });
});

describe('domainFromInput', () => {
    it('ドメイン・URL・アカウントからドメインを取り出す', () => {
        expect(domainFromInput('Spam.Example')).toBe('spam.example');
        expect(domainFromInput('https://spam.example/@bob')).toBe('spam.example');
        expect(domainFromInput('@bob@spam.example')).toBe('spam.example');
        expect(domainFromInput('localhost:3201')).toBe('localhost:3201');
    });

    it('ドメインとして読めないものは null', () => {
        expect(domainFromInput('')).toBeNull();
        expect(domainFromInput('not a domain')).toBeNull();
        expect(domainFromInput('-bad.example')).toBeNull();
        expect(domainFromInput('javascript:alert(1)')).toBeNull();
    });
});
