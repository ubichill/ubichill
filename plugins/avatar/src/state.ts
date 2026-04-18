import type { AppAvatarDef } from '@ubichill/sdk';

export interface TemplateEntry {
    id: string;
    name: string;
    directory: string;
    mappings: Partial<Record<string, string>>;
}

// ============================================================
// settings.worker 専用ストア
// ============================================================
export const settings = {
    templates: [] as TemplateEntry[],
    currentTemplateId: null as string | null,
    templatesLoaded: false,
    thumbnailUrls: new Map<string, string>(),
    dirty: true,
    cursorStyle: 'default',
    avatar: { states: {} } as AppAvatarDef,
    zIndex: 9998,
};
