import type { InitialEntity } from '@ubichill/shared';
import { css } from '@/styled-system/css';
import type { AvailableEntityKind } from '../../hooks/useAvailableEntityKinds';
import { ComponentCard, ComponentPicker } from './ComponentCard';
import { EntityHeader } from './EntityHeader';
import { NumField, Section } from './primitives';
import { TagsEditor } from './TagsEditor';

interface EntityInspectorProps {
    entity: InitialEntity;
    /** Hierarchy 等から渡される「最初に展開しておく Component の index」。 */
    initiallyExpandedComponentIndex: number | null;
    availableKinds: AvailableEntityKind[];
    /** true なら子 Entity (transform は親基準の相対座標) */
    isChild: boolean;
    /** W/H の上限として使うワールドサイズ。 */
    worldSize?: { width: number; height: number };
    onChange: (updater: (prev: InitialEntity) => InitialEntity) => void;
    onAddComponent: (type: string) => void;
    onDeleteComponent: (componentIndex: number) => void;
    onDeleteEntity: () => void;
    onRenameEntity: (newId: string) => void;
}

/**
 * Entity 編集ペインのトップレベル composer。
 * 各セクションは個別ファイルに分割済 (EntityHeader / TagsEditor / ComponentCard 等)。
 */
export function EntityInspector({
    entity,
    initiallyExpandedComponentIndex,
    availableKinds,
    isChild,
    worldSize,
    onChange,
    onAddComponent,
    onDeleteComponent,
    onDeleteEntity,
    onRenameEntity,
}: EntityInspectorProps) {
    const t = entity.transform;
    const updateTransform = (patch: Partial<typeof t>) =>
        onChange((prev) => ({ ...prev, transform: { ...prev.transform, ...patch } }));
    const maxW = worldSize?.width;
    const maxH = worldSize?.height;

    return (
        <div
            className={css({
                bg: 'surface',
                borderRadius: '12px',
                p: '4',
                display: 'flex',
                flexDirection: 'column',
                gap: '4',
            })}
        >
            <EntityHeader entity={entity} onDelete={onDeleteEntity} onRename={onRenameEntity} />

            <Section label={isChild ? 'Transform (親基準)' : 'Transform'}>
                <div className={css({ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '2' })}>
                    <NumField label="X" value={t.x} onChange={(v) => updateTransform({ x: v })} />
                    <NumField label="Y" value={t.y} onChange={(v) => updateTransform({ y: v })} />
                    <NumField
                        label="W"
                        value={t.w ?? 0}
                        max={maxW}
                        onChange={(v) => updateTransform({ w: v || undefined })}
                    />
                    <NumField
                        label="H"
                        value={t.h ?? 0}
                        max={maxH}
                        onChange={(v) => updateTransform({ h: v || undefined })}
                    />
                    <NumField label="Z" value={t.z ?? 0} onChange={(v) => updateTransform({ z: v })} />
                    <NumField
                        label="Rotation"
                        value={t.rotation ?? 0}
                        onChange={(v) => updateTransform({ rotation: v })}
                    />
                </div>
            </Section>

            <Section label="Tags">
                <TagsEditor
                    tags={entity.tags ?? []}
                    onChange={(next) => onChange((prev) => ({ ...prev, tags: next }))}
                />
            </Section>

            <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                <div className={css({ fontSize: '12px', fontWeight: '600', color: 'text' })}>Components</div>
                {entity.components.length === 0 ? (
                    <div className={css({ fontSize: '12px', color: 'textSubtle' })}>
                        コンポーネントがありません。下から追加するか、アセットからドロップしてください。
                    </div>
                ) : (
                    entity.components.map((c, ci) => (
                        <ComponentCard
                            key={`${c.type}-${ci}`}
                            component={c}
                            componentIndex={ci}
                            dataFields={availableKinds.find((k) => k.kind === c.type)?.dataFields}
                            known={availableKinds.some((k) => k.kind === c.type)}
                            initiallyExpanded={ci === initiallyExpandedComponentIndex}
                            onChange={onChange}
                            onDelete={() => onDeleteComponent(ci)}
                        />
                    ))
                )}
                <ComponentPicker availableKinds={availableKinds} onAdd={onAddComponent} />
            </div>
        </div>
    );
}
