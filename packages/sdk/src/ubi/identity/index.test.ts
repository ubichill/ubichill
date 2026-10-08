import { describe, expect, it, vi } from 'vitest';
import type { RpcFn } from '../types';
import { createIdentityModule } from './index';

describe('Ubi.identity', () => {
    it('IDENTITY_TOKEN を送り、取り消し用の signal を RPC に渡す', async () => {
        const rpc = vi.fn(async () => ({ token: 't', expiresAt: 1 })) as unknown as RpcFn & ReturnType<typeof vi.fn>;
        const signal = new AbortController().signal;
        const result = await createIdentityModule(rpc).token('https://api.example.com', { signal });
        expect(result).toEqual({ token: 't', expiresAt: 1 });
        expect(rpc).toHaveBeenCalledWith(
            { type: 'IDENTITY_TOKEN', payload: { audience: 'https://api.example.com' } },
            { signal },
        );
    });
});
