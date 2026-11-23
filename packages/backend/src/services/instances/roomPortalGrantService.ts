/** 部屋へのポータルを置く許可の実体（部屋・ワールドの解決・管理トークンの鍵をつなぐ）。規則と手順は roomPortalGrant.ts。 */
import { instanceRepository } from '@ubichill/db';
import { appConfig } from '../../config';
import { selfDomain } from '../authors/authorKeys';
import { worldRegistry } from '../worlds/worldRegistry';
import { createRoomPortalGrants } from './roomPortalGrant';
import { roomPortalGrantKey, signRoomPortalGrant } from './roomPortalGrantToken';

const key = roomPortalGrantKey(appConfig.runtime.token);

export const roomPortalGrants = createRoomPortalGrants({
    selfDomain,
    findRoom: (id) => instanceRepository.findById(id),
    resolveWorld: (ref) => worldRegistry.resolveRefDetailed(ref),
    sign: (claims) => signRoomPortalGrant(key, claims),
    now: Date.now,
});
