/**
 * SNS の Host が使う mod の取得元。`VITE_MOD_CDN_URL` があれば外部 CDN / GitHub Pages、無ければ自ホストの `/mods`。
 * ワールドを動かす画面（InstancePage）と World Editor がこれを `src/world` に渡す。
 */
import { DEV_HOST, type ModSource } from '@/world';

export const MOD_CDN_URL: string = (import.meta.env.VITE_MOD_CDN_URL ?? '').replace(/\/$/, '') || '/mods';

export const HOST_MOD_SOURCE: ModSource = { baseUrl: MOD_CDN_URL, devHost: DEV_HOST };
