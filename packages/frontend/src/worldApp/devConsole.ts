import type { DevFailure } from '@ubichill/shared';
import type { ConsoleInput } from '@/lib/console/console';

/** dev サーバーが知らせる問題（ビルドの失敗・参照の問題・ワールドの問題）を、コンソールの記録にする。 */
export function devFailureLog(failure: DevFailure): ConsoleInput {
    switch (failure.kind) {
        case 'build':
            return { level: 'error', source: failure.mod, message: `ビルドに失敗しました: ${failure.message}` };
        case 'reference':
            return { level: 'warning', source: '参照', message: failure.message };
        case 'world':
            return { level: 'error', source: 'ワールド', message: failure.message };
    }
}

/** 同じ問題かを比べるための値。 */
export const devFailureKey = (failure: DevFailure): string => JSON.stringify(failure);
