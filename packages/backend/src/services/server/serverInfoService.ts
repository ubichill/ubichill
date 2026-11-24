/** 本番の DB につないだサーバーの情報。規則は serverInfo.ts。 */
import { serverInfoRepository, userRepository } from '@ubichill/db';
import { appConfig } from '../../config';
import { brandingService } from './brandingService';
import { createServerInfo } from './serverInfo';

export const serverInfoService = createServerInfo({
    repository: serverInfoRepository,
    countPeople: () => userRepository.countPeople(),
    branding: () => brandingService.branding(),
    registrationOpen: appConfig.registrationOpen,
});
