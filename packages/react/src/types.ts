import type { WorldEntity } from '@ubichill/shared';
import type React from 'react';
import type { ReactNode } from 'react';

export interface WidgetComponentProps<TData = unknown, TEphemeral = unknown> {
    entity: WorldEntity<TData>;
    isLocked: boolean;
    update: (patch: Partial<WorldEntity<TData>>) => void;
    ephemeral?: TEphemeral;
    broadcast?: (data: TEphemeral) => void;
}

export interface WidgetDefinition<TData = unknown, TEphemeral = unknown> {
    id: string;
    name: string;
    icon?: ReactNode;
    defaultSize: { w: number; h: number };
    defaultData: TData;
    Component: React.FC<WidgetComponentProps<TData, TEphemeral>>;
    SingletonComponent?: React.FC;
    configPath?: string;
}
