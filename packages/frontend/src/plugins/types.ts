import type { WorldEntity } from '@ubichill/shared';
import type React from 'react';
import type { ReactNode } from 'react';

// すべてのウィジェットが守るべきルール
export interface WidgetDefinition<T = unknown> {
    // ID (例: "ubichill-pen", "ubichill-clock")
    id: string;

    // 表示名 (ツールバー用)
    name: string;
    icon: ReactNode;

    // デフォルトサイズと初期データ
    defaultSize: { w: number; h: number };
    defaultData: T;

    // メインコンポーネント
    // Coreからデータと更新関数が渡される
    Component: React.FC<{
        entity: WorldEntity<T>;
        isLocked: boolean;
        // ↓これを呼ぶだけで通信できる（useEntityを隠蔽）
        update: (patch: Partial<WorldEntity<T>>) => void;
        // Ephemeral updates (cursor/drawing)
        ephemeral?: unknown;
        broadcast?: (data: unknown) => void;
    }>;
}
