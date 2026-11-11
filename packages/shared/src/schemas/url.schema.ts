import { z } from 'zod';

/** 公開 package の取得先。開発用 http の例外は、この信頼境界へ持ち込まない。 */
export const PublicPackageUrlSchema = z
    .string()
    .max(2048)
    .regex(/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[^\s#@\\]*)?$/, '公開 package は https の URL を指定してください');
