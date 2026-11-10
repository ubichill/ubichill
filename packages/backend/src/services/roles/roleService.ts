import { roleRepository, userRepository } from '@ubichill/db';
import { selfDomain } from '../authors/authorKeys';
import { SYSTEM_USER_ID } from '../users/systemUser';
import { createRoleService } from './roles';

/** 本番の DB につないだロールの窓口。 */
export const roleService = createRoleService({
    roles: roleRepository,
    users: userRepository,
    localDomain: selfDomain,
    hiddenUserIds: [SYSTEM_USER_ID],
});
