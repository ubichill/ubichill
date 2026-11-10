import { type MediaOutputLevel, mediaOutput, normalizeMediaOutput } from '@ubichill/react';
import { useCallback, useSyncExternalStore } from 'react';
import { readSetting, SETTINGS_KEYS, writeSetting } from '@/lib/settings';

/** 保存しておいた音量・ミュートを全体の出力に戻す（起動時に 1 回）。 */
export function restoreMediaOutput(): void {
    mediaOutput.set(normalizeMediaOutput(readSetting<unknown>(SETTINGS_KEYS.mediaOutput, null)));
}

/** HUD の「音声」用。変えた値はすぐ全 video に掛かり、次に開いたときのために保存する。 */
export function useMediaOutput(): readonly [MediaOutputLevel, (patch: Partial<MediaOutputLevel>) => void] {
    const level = useSyncExternalStore(mediaOutput.subscribe, mediaOutput.get);
    const set = useCallback((patch: Partial<MediaOutputLevel>) => {
        mediaOutput.set(patch);
        writeSetting(SETTINGS_KEYS.mediaOutput, mediaOutput.get());
    }, []);
    return [level, set] as const;
}
