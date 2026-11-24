import { brandingService } from '../../services/server/brandingService';
import { serverInfoService } from '../../services/server/serverInfoService';
import { userService } from '../../services/users/userService';
import { createServerRouter } from './router';

export const router = createServerRouter({
    overview: () => serverInfoService.overview(),
    image: (variant, hash) => brandingService.image(variant, hash),
    directory: () => userService.discoverable(),
});
