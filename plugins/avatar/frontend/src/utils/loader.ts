import type { CursorState } from '@ubichill/shared';
import yaml from 'js-yaml';

/**
 * CRD-style YAML avatar definition
 */
export interface AvatarYAML {
    apiVersion: string;
    kind: 'Avatar';
    metadata: {
        name: string;
        displayName: string;
        description?: string;
        version?: string;
        author?: {
            name: string;
            url?: string;
        };
    };
    spec: {
        // 全状態共通の画像 (これが設定されている場合は states を無視)
        image?: string;
        // 状態ごとの画像マッピング
        states?: Partial<Record<CursorState, string>>;
    };
}

export interface AvatarIndexYAML {
    apiVersion: string;
    kind: 'AvatarIndex';
    metadata: {
        name: string;
        version?: string;
    };
    templates: string[];
}

/**
 * 内部で使うテンプレート形式
 */
export interface ParsedTemplate {
    id: string;
    name: string;
    description?: string;
    // 全状態共通の場合は image のみ、状態別の場合は mappings のみ
    image?: string;
    mappings?: Record<CursorState, string>;
}

/**
 * YAMLファイルからアバター定義をパース
 */
export async function loadAvatarFromYAML(yamlPath: string): Promise<ParsedTemplate> {
    const response = await fetch(yamlPath);
    const yamlText = await response.text();
    const data = yaml.load(yamlText) as AvatarYAML;

    if (data.kind !== 'Avatar') {
        throw new Error(`Invalid kind: ${data.kind}. Expected Avatar`);
    }

    const template: ParsedTemplate = {
        id: data.metadata.name,
        name: data.metadata.displayName,
        description: data.metadata.description,
    };

    // spec.image が設定されていれば全状態共通
    if (data.spec.image) {
        template.image = data.spec.image;
    }
    // spec.states が設定されていれば状態別
    else if (data.spec.states) {
        template.mappings = data.spec.states as Record<CursorState, string>;
    } else {
        throw new Error(`Template ${data.metadata.name} has neither image nor states`);
    }

    return template;
}

/**
 * index.yamlからアバター一覧を読み込む
 */
export async function loadAvatarIndex(indexPath: string): Promise<ParsedTemplate[]> {
    const response = await fetch(indexPath);
    if (!response.ok) {
        throw new Error(`Failed to fetch avatar index: ${response.status}`);
    }
    const yamlText = await response.text();
    const index = yaml.load(yamlText) as AvatarIndexYAML;

    if (index.kind !== 'AvatarIndex') {
        throw new Error(`Invalid kind: ${index.kind}. Expected AvatarIndex`);
    }

    // 各アバターファイルを並列で読み込む
    // indexPathから基底ディレクトリを取得
    const basePath = indexPath.substring(0, indexPath.lastIndexOf('/'));
    const templates = await Promise.all(
        index.templates.map((templatePath) => {
            const fullPath = `${basePath}/${templatePath}`;
            return loadAvatarFromYAML(fullPath);
        }),
    );

    return templates;
}

/**
 * テンプレートを適用して、全状態のURLマッピングを生成
 */
export function applyTemplate(template: ParsedTemplate, fallbackImage?: string): Record<CursorState, string> {
    const allStates: CursorState[] = ['default', 'pointer', 'text', 'wait', 'help', 'not-allowed', 'move', 'grabbing'];

    const result: Record<CursorState, string> = {} as Record<CursorState, string>;

    if (template.image) {
        // 全状態共通の場合
        for (const state of allStates) {
            result[state] = template.image;
        }
    } else if (template.mappings) {
        // 状態別の場合
        for (const state of allStates) {
            result[state] = template.mappings[state] || fallbackImage || '';
        }
    }

    return result;
}
