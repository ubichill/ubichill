import { roleRepository, userRepository } from '@ubichill/db';
import { selfDomain } from '../authors/authorKeys';
import { federation } from '../federation';
import { createRoleService } from './roles';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/** 本番の DB につないだロールの窓口。 */
export const roleService = createRoleService({
    roles: roleRepository,
    users: userRepository,
    localDomain: selfDomain,
    hiddenUserIds: [SYSTEM_USER_ID],
    publicRolesChanged: (userIds) => {
        for (const id of userIds) federation?.profileChanged(id);
    },
});
