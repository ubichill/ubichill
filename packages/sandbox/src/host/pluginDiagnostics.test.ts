import { UbiErrorCode } from '@ubichill/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    type PluginDiagnostic,
    reportDiagnostic,
    resetDiagnosticHandler,
    resetDiagnosticThrottleForTests,
    setDiagnosticHandler,
} from './pluginDiagnostics';

const diag = (message: string): PluginDiagnostic => ({
    level: 'warn',
    pluginId: 'pen',
    code: UbiErrorCode.CAPABILITY_DENIED,
    message,
});

describe('reportDiagnostic レート制限（毎フレーム console 洪水の防止）', () => {
    afterEach(() => {
        resetDiagnosticHandler();
        resetDiagnosticThrottleForTests();
    });

    it('同一診断の連投は 1 回に抑制される', () => {
        const handler = vi.fn();
        setDiagnosticHandler(handler);
        reportDiagnostic(diag('権限が許可されていません: SCENE_UPDATE_ENTITY'));
        reportDiagnostic(diag('権限が許可されていません: SCENE_UPDATE_ENTITY'));
        reportDiagnostic(diag('権限が許可されていません: SCENE_UPDATE_ENTITY'));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('異なるメッセージは個別に通る', () => {
        const handler = vi.fn();
        setDiagnosticHandler(handler);
        reportDiagnostic(diag('a'));
        reportDiagnostic(diag('b'));
        expect(handler).toHaveBeenCalledTimes(2);
    });
});
