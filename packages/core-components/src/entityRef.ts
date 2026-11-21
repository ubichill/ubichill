import { z } from 'zod';

/** ほかの Entity の ID（ワールドの Entity の ID と同じ kebab-case）。空は「まだ選んでいない」。 */
export const EntityIdRef = z
    .string()
    .max(50)
    .regex(/^[a-z0-9-]*$/, 'Entity の ID を指してください');
