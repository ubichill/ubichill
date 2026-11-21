import { z } from 'zod';

/** `core:spawn` の data。部屋に入ったとき、この Entity が画面の中心に来るようにする印。設定は無い。 */
export const SpawnDataSchema = z.object({}).strict();
