/**
 * ワールドのメディア全体の出力（音量・ミュート）。利用者が HUD の「音声」で決め、すべての `<video>` に掛ける。
 * mod が `Ubi.media.setVolume()` で決めた音量に掛け合わせるだけで、mod から見える音量（state.volume）は mod が決めた値のまま。
 */
export interface MediaOutputLevel {
    readonly volume: number;
    readonly muted: boolean;
}

export const DEFAULT_MEDIA_OUTPUT: MediaOutputLevel = { volume: 1, muted: false };

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1);

/** 保存した値など、形の分からない入力を出力の設定にする（壊れていれば既定）。 */
export function normalizeMediaOutput(input: unknown): MediaOutputLevel {
    if (typeof input !== 'object' || input === null) return DEFAULT_MEDIA_OUTPUT;
    const { volume, muted } = input as { volume?: unknown; muted?: unknown };
    return {
        volume: typeof volume === 'number' ? clamp01(volume) : DEFAULT_MEDIA_OUTPUT.volume,
        muted: typeof muted === 'boolean' ? muted : DEFAULT_MEDIA_OUTPUT.muted,
    };
}

/** `<video>` に実際に設定する音量。 */
export function effectiveVolume(requested: number, level: MediaOutputLevel): number {
    return clamp01(requested) * clamp01(level.volume);
}

export interface MediaOutputStore {
    get(): MediaOutputLevel;
    set(patch: Partial<MediaOutputLevel>): void;
    subscribe(listener: (level: MediaOutputLevel) => void): () => void;
}

export function createMediaOutputStore(initial: MediaOutputLevel = DEFAULT_MEDIA_OUTPUT): MediaOutputStore {
    const listeners = new Set<(level: MediaOutputLevel) => void>();
    const current = { level: normalizeMediaOutput(initial) };
    return {
        get: () => current.level,
        set(patch) {
            const next = normalizeMediaOutput({ ...current.level, ...patch });
            if (next.volume === current.level.volume && next.muted === current.level.muted) return;
            current.level = next;
            for (const listener of listeners) listener(next);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

/** host 全体で 1 つ（ワールドの中のメディアはすべてこれに従う）。 */
export const mediaOutput = createMediaOutputStore();
