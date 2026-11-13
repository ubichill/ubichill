import { PROTOCOL_VERSION } from '../mod/protocol';
import type { WorldRequirements } from '../schemas/world.schema';

export type WorldCompatibility =
    | { level: 'ok' }
    /** ワールドがこの Host より新しい ubichill に固定されている（Host が古い）。 */
    | { level: 'newer'; required: number; host: number; message: string };

/**
 * 保存するときに書く要件。mod の版と同じく固定し、エディタ・CLI は勝手に上げない（上げるのは作者が選んだとき）。
 * 書かれていないワールドだけ、今の版で固定する。
 */
export function worldRequirementsFor(
    existing: WorldRequirements | undefined,
    hostProtocol: number = PROTOCOL_VERSION,
): WorldRequirements {
    return existing ?? { protocol: hostProtocol };
}

/** 作者が選べる ubichill の版（新しい順）。下げると使っている機能を持たない Host でも黙って開かれるので、今の版から上だけ。 */
export function selectableProtocolVersions(current: number, hostProtocol: number = PROTOCOL_VERSION): number[] {
    const top = Math.max(current, hostProtocol);
    return Array.from({ length: top - current + 1 }, (_, i) => top - i);
}

/**
 * この Host でワールドを開けるか。古い版に固定したワールドは、そのまま古い版として動かす（Host は足すだけで互換を保つ）ので知らせない。
 * 新しい版に固定したワールドだけ、この Host に無い機能を使っている可能性を知らせる。
 */
export function checkWorldCompatibility(
    requires: WorldRequirements | undefined,
    hostProtocol: number = PROTOCOL_VERSION,
): WorldCompatibility {
    const required = requires?.protocol ?? 0;
    if (required <= hostProtocol) return { level: 'ok' };
    return {
        level: 'newer',
        required,
        host: hostProtocol,
        message: `このワールドは新しい ubichill（v${required}）で作られています。このサーバー（v${hostProtocol}）では一部が動かない可能性があります。`,
    };
}
