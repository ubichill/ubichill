/**
 * ログイン画面に並べるサーバーの一覧（読むだけ）。ログイン画面を開くたびに DB を読まないよう 30 秒覚える。
 * 変えた backend はすぐ捨て、ほかの backend には知らせで捨てさせる（届かなくても 30 秒で揃う）。
 */
import { featuredServerRepository } from '@ubichill/db';
import { backendEvents } from '../../cluster/backendEvents';

const TTL_MS = 30_000;
const cache: { at: number; value: Promise<string[]> | null } = { at: 0, value: null };

const forget = () => {
    cache.value = null;
};

backendEvents.on('auth.featured-servers.changed', forget);

export const featuredServerList = {
    get(): Promise<string[]> {
        if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
        const value = featuredServerRepository.list();
        value.catch(forget);
        cache.at = Date.now();
        cache.value = value;
        return value;
    },

    changed(): void {
        forget();
        backendEvents.broadcast({ type: 'auth.featured-servers.changed' });
    },
};
