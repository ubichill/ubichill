import { EXTERNAL_WORK_STATUSES } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ API_BASE: 'https://ubichill.example' }));

import { describeExternalWorkStatus } from './externalWorksApi';

describe('describeExternalWorkStatus', () => {
    it('ユーザーページに出るのは公開済みだけで、ほかは理由と次の行動を案内する', () => {
        const described = EXTERNAL_WORK_STATUSES.map((status) => ({ status, ...describeExternalWorkStatus(status) }));
        expect(described.filter((d) => d.ok).map((d) => d.status)).toEqual(['published']);
        expect(new Set(described.map((d) => d.label)).size).toBe(EXTERNAL_WORK_STATUSES.length);
        for (const d of described.filter((x) => !x.ok)) expect(d.hint.length).toBeGreaterThan(0);
    });
});
