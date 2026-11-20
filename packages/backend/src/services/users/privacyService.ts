/** プライバシーの設定（お気に入りの公開範囲・オンライン状態の見せ方）。見せてよいかの規則は shared の social/presence.ts。 */
import { userSettingsRepository } from '@ubichill/db';
import type { PresenceVisibility, PrivacySettings } from '@ubichill/shared';

export const privacyService = {
    async settingsOf(userId: string): Promise<PrivacySettings> {
        const [favoritesVisibility, presenceVisibility] = await Promise.all([
            userSettingsRepository.getFavoritesVisibility(userId),
            userSettingsRepository.getPresenceVisibility(userId),
        ]);
        return { favoritesVisibility, presenceVisibility };
    },

    setPresenceVisibility: (userId: string, visibility: PresenceVisibility): Promise<void> =>
        userSettingsRepository.setPresenceVisibility(userId, visibility),
};
