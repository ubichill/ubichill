import { z } from 'zod';

/** 動画を枠にどう収めるか。contain は黒帯を出して全体を見せ、cover は枠を埋めて端を切る。 */
export const MEDIA_FITS = ['contain', 'cover'] as const;

/**
 * `core:media` の data。動画を描く「場所」だけを持つ（Unity の MeshRenderer に当たる）。
 * 何を再生するかは、参照フィールドでこの Entity を指した mod が決める。未知キーは拒否する。
 */
export const MediaDataSchema = z
    .object({
        fit: z.enum(MEDIA_FITS).default('contain'),
    })
    .strict();
