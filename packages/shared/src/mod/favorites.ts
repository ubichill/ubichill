import { z } from 'zod';
import { PackageAuthorSchema, type PackageDescriptor, PackageIdSchema } from './packageRef';

/**
 * お気に入りの mod。カタログと同じく作者と ID で指し、版と取得先は持たない（見るたびに作者のカタログで引く）。
 * 鍵の文字列は作者参照（`@作者@サーバー/ID`、formatPackageRef）。
 */
export const ModFavoriteRefSchema = z.object({ author: PackageAuthorSchema, id: PackageIdSchema });
export type ModFavoriteRef = z.infer<typeof ModFavoriteRefSchema>;

/** 自分のお気に入りの mod。作者のカタログで今の版を引けたものと、引けないもの（本人が整理できるように）。 */
export interface FavoriteMods {
    mods: PackageDescriptor[];
    unavailable: ModFavoriteRef[];
}
