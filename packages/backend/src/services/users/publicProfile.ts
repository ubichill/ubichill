import { type StoredProfileFields, type UserProfile, userProfileOf } from '@ubichill/shared';
import { selfAccount } from '../authors/authorKeys';
import { roleService } from '../roles/roleService';

/** このサーバーの人の公開プロフィール（作者アカウントと公開ロール込み）。自分・ほかの人・関係付きのどれもここから作る。 */
export const publicProfileOf = async (user: StoredProfileFields): Promise<UserProfile> =>
    userProfileOf(user, selfAccount(user.handle), await roleService.publicRolesOf(user.id));
