/**
 * このサーバーのユーザーを引く、と本人のアカウントの小さな更新。route は DB を知らないので、ここを通す。
 * 規則のある操作（表示名・プロフィール・公開環境）はそれぞれの service にある。
 */
import { accountDeletionRepository, fediverseAccountRepository, userRepository } from '@ubichill/db';
import { OFFICIAL_HANDLE } from '@ubichill/shared';

export const userService = {
    byId: (id: string) => userRepository.findById(id),
    byHandle: (handle: string) => userRepository.findByHandle(handle),
    /** 退会した ID か（二度と使わせない。WebFinger・actor は 410） */
    isHandleRetired: (handle: string) => accountDeletionRepository.isHandleRetired(handle),
    isUserRetired: (id: string) => accountDeletionRepository.isUserRetired(id),
    /** ID が使われているか（今のユーザーか、退会した ID） */
    async isHandleTaken(handle: string): Promise<boolean> {
        return !!(await userRepository.findByHandle(handle)) || accountDeletionRepository.isHandleRetired(handle);
    },
    /** プロフィールの項目つき（公開プロフィール・自分の情報の元） */
    profileById: (id: string) => userRepository.findProfileById(id),

    /** パスワードを Secret（OFFICIAL_ACCOUNT_PASSWORD）で管理している公式アカウントか（画面から変えさせない）。 */
    async isOfficialAccount(id: string): Promise<boolean> {
        return (await userRepository.findById(id))?.handle === OFFICIAL_HANDLE;
    },

    /** パスワードでログインできるか（本人確認・管理者の権限の判定に使う）。 */
    hasPassword: (id: string): Promise<boolean> => fediverseAccountRepository.hasPassword(id),

    /** パスワードを変えた（既定のパスワードのまま、の印を外す）。 */
    passwordChanged: (id: string): Promise<void> => userRepository.setPasswordChangeRequired(id, false),

    /** いま使っているもの以外のログインをすべて無効にする。無効にした数を返す。 */
    revokeOtherSessions: (id: string, keepSessionId: string): Promise<number> =>
        userRepository.revokeOtherSessions(id, keepSessionId),
};
