import { z } from 'zod';

const LayerSchema = z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/, 'layer は小文字英数 + - _ のみ');
const Vec2Schema = z.object({ x: z.number(), y: z.number() }).strict();

const CommonColliderSchema = z.object({
    offset: Vec2Schema.default({ x: 0, y: 0 }),
    isTrigger: z.boolean().default(true),
    layer: LayerSchema.default('default'),
    mask: z.array(LayerSchema).min(1).max(32).default(['default']),
});

export const RectColliderSchema = CommonColliderSchema.extend({
    shape: z.literal('rect'),
    size: z.object({ w: z.number().positive(), h: z.number().positive() }).strict(),
}).strict();

export const CircleColliderSchema = CommonColliderSchema.extend({
    shape: z.literal('circle'),
    radius: z.number().positive(),
}).strict();

/** `core:collider` のdata。未知キーを拒否し、過大なlayer/mask入力を防ぐ。 */
export const ColliderDataSchema = z.discriminatedUnion('shape', [RectColliderSchema, CircleColliderSchema]);
