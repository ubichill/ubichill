import { requireAdmin, requireAuth } from '../middleware/auth';
import { roleService } from '../services/roles/roleService';
import { createAdminRouter } from './admin';

export const router = createAdminRouter({ requireAuth, requireAdmin, roles: roleService });
