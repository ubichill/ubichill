import { PortalDataSchema, parsePortalTarget, readCoreData } from '@ubichill/core-components';
import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { partButton, partButtonLabel } from './partStyles';
import { usePortalNavigation } from './portalNavigation';
import { surfacePlacement } from './surfacePlacement';

const DEFAULT_LABEL = '入口';

/**
 * `core:portal` の面。押すと、行き先のワールドへ移る（移り方は SNS の画面が決める。usePortalNavigation）。
 * 行き先が無い・移り方が渡されていない（world.html・エディタ）ときは押せない。
 */
export const CorePortal: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const go = usePortalNavigation();
    const parsed = readCoreData(PortalDataSchema, entity.data ?? {});
    const entityId = entity.entityId ?? entity.id;
    const label = (parsed.success && parsed.data.label.trim()) || DEFAULT_LABEL;
    const target = parsed.success ? parsePortalTarget(parsed.data.world) : null;
    return (
        <div data-portal={entityId} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
            <button
                type="button"
                className={partButton}
                disabled={!go || !target}
                onClick={() => {
                    if (go && target) go(target, label);
                }}
            >
                <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <path d="m10 17 5-5-5-5" />
                    <path d="M15 12H3" />
                </svg>
                <span className={partButtonLabel}>{label}</span>
            </button>
        </div>
    );
};
