import { resetFavorites } from '@/components/worlds/useFavorites';
import { resetWorldsCache } from '@/components/worlds/useInstances';
import { signOut } from '@/lib/auth-client';
import { resetHome } from '@/lib/home/homeStore';
import { resetModFavorites } from '@/lib/mods/modFavorites';
import { resetBlocks } from '@/lib/social/blocks';

/**
 * サインアウトし、持ち主ごとに覚えている状態を捨てる（SPA の遷移のままなので、次の人に前の人の一覧を使わない）。
 * 覚える状態を足したら、ここにも足す。
 */
export async function signOutAndReset(forgetSession: () => void): Promise<void> {
    const { error } = await signOut();
    if (error) throw new Error(error.message || 'ログアウトに失敗しました');
    forgetSession();
    resetHome();
    resetBlocks();
    resetFavorites();
    resetModFavorites();
    resetWorldsCache();
}
