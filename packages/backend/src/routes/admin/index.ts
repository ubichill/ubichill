import { requireAdmin, requireAuth } from '../../middleware/auth';
import { botProtectionService } from '../../services/auth/botProtection/botProtectionService';
import { featuredServerService } from '../../services/auth/fediverse/featuredServerService';
import { roleService } from '../../services/roles/roleService';
import { createAdminRouter } from './router';

export const router = createAdminRouter({
    requireAuth,
    requireAdmin,
    roles: roleService,
    featuredServers: featuredServerService,
    botProtection: botProtectionService,
});
