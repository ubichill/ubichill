import { requireAdmin, requireAuth } from '../../middleware/auth';
import { roleService } from '../../services/roles/roleService';
import { createAdminRouter } from './router';

export const router = createAdminRouter({ requireAuth, requireAdmin, roles: roleService });
