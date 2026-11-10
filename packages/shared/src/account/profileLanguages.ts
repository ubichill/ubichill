/**
 * プロフィールの「話せる言語」。決まった一覧から選ぶ（自由入力にすると表記が揃わず、検索や絞り込みに使えない）。
 * コードは BCP 47、名前はその言語自身での呼び名（読めない人にも自分の言語が見つけられるように）。
 */
import { z } from 'zod';

export const PROFILE_LANGUAGES = [
    { code: 'ja', label: '日本語' },
    { code: 'en', label: 'English' },
    { code: 'zh-Hans', label: '简体中文' },
    { code: 'zh-Hant', label: '繁體中文' },
    { code: 'ko', label: '한국어' },
    { code: 'es', label: 'Español' },
    { code: 'pt', label: 'Português' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'it', label: 'Italiano' },
    { code: 'ru', label: 'Русский' },
    { code: 'uk', label: 'Українська' },
    { code: 'pl', label: 'Polski' },
    { code: 'nl', label: 'Nederlands' },
    { code: 'sv', label: 'Svenska' },
    { code: 'tr', label: 'Türkçe' },
    { code: 'ar', label: 'العربية' },
    { code: 'hi', label: 'हिन्दी' },
    { code: 'id', label: 'Bahasa Indonesia' },
    { code: 'ms', label: 'Bahasa Melayu' },
    { code: 'th', label: 'ไทย' },
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'fil', label: 'Filipino' },
    { code: 'jsl', label: '日本手話' },
    { code: 'ase', label: 'American Sign Language' },
] as const;

export type ProfileLanguageCode = (typeof PROFILE_LANGUAGES)[number]['code'];

export const PROFILE_LANGUAGE_CODES = PROFILE_LANGUAGES.map((l) => l.code) as readonly ProfileLanguageCode[];

export const MAX_PROFILE_LANGUAGES = 5;

const LANGUAGE_CODE_SET: ReadonlySet<string> = new Set(PROFILE_LANGUAGE_CODES);

export const isProfileLanguageCode = (value: unknown): value is ProfileLanguageCode =>
    typeof value === 'string' && LANGUAGE_CODE_SET.has(value);

/** その言語自身での呼び名。一覧に無いコードはそのまま返す。 */
export function profileLanguageLabel(code: string): string {
    return PROFILE_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/** 選んだ言語（最大 {@link MAX_PROFILE_LANGUAGES} 件・重複なし・並びは選んだ順）。 */
export const ProfileLanguagesSchema = z
    .array(z.string())
    .max(MAX_PROFILE_LANGUAGES, `言語は ${MAX_PROFILE_LANGUAGES} 件まで選べます`)
    .refine((codes) => codes.every(isProfileLanguageCode), '選べない言語が含まれています')
    .refine((codes) => new Set(codes).size === codes.length, '同じ言語が 2 回あります')
    .transform((codes) => codes.filter(isProfileLanguageCode));

/** 保存してある言語（jsonb）を表示用にする。一覧から外したコードは出さない。 */
export function profileLanguagesView(stored: unknown): ProfileLanguageCode[] {
    if (!Array.isArray(stored)) return [];
    return [...new Set(stored.filter(isProfileLanguageCode))].slice(0, MAX_PROFILE_LANGUAGES);
}
