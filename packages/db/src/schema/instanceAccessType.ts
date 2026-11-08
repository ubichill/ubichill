import { pgEnum } from 'drizzle-orm/pg-core';

/** インスタンスの公開範囲（shared の AccessType と同じ値）。instances とホームの設定（user_settings）で使う。 */
export const instanceAccessTypeEnum = pgEnum('instance_access_type', [
    'public',
    'friend_plus',
    'friend_only',
    'invite_only',
]);
