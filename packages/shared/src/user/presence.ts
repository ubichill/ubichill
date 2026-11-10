/**
 * オンライン状態（フレンドの現在地）をフレンドにどこまで見せるかの純粋な知識。
 *
 * - location: いる場所まで（部屋の公開範囲でフレンドに見える部屋なら、その部屋）
 * - online  : オンラインかどうかだけ（部屋にいても場所は伏せる）
 * - hidden  : 見せない（オフラインに見える）
 *
 * 同じ部屋にいる人には、この設定に関係なく見える（部屋の参加者として）。
 */
import { z } from 'zod';
import type { PresenceStatus } from '../federation/ubichill/rpc';
import type { FavoritesVisibility } from './favoritesVisibility';

export const PRESENCE_VISIBILITIES = ['location', 'online', 'hidden'] as const;
export const PresenceVisibilitySchema = z.enum(PRESENCE_VISIBILITIES);
export type PresenceVisibility = z.infer<typeof PresenceVisibilitySchema>;

export const DEFAULT_PRESENCE_VISIBILITY: PresenceVisibility = 'location';

/** 本人の設定に合わせて、フレンドから見た状態（連合の現在地と同じ語）を狭める（部屋の規則で見えても、本人が見せない分は伏せる）。 */
export function limitPresence(status: PresenceStatus, visibility: PresenceVisibility): PresenceStatus {
    if (visibility === 'hidden') return 'offline';
    if (visibility === 'online' && status === 'in_room') return 'private';
    return status;
}

/** 設定の「プライバシー」で一緒に出す設定（`GET /api/v1/users/me/privacy`。変えるのはそれぞれの API）。 */
export interface PrivacySettings {
    favoritesVisibility: FavoritesVisibility;
    presenceVisibility: PresenceVisibility;
}
