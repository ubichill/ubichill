import { MIN_COMPATIBLE_PROTOCOL_VERSION, PROTOCOL_VERSION } from '../mod/protocol';
import type { WorldRequirements } from '../schemas/world.schema';

export type WorldCompatibility =
    | { level: 'ok' }
    /** ワールドがこの Host より新しい ubichill で保存された（Host が古い）。 */
    | { level: 'newer'; required: number; host: number; message: string }
    /** 互換を切った版より前に保存された（今は MIN_COMPATIBLE_PROTOCOL_VERSION が 0 なので起きない）。 */
    | { level: 'outdated'; required: number; host: number; message: string };

/**
 * 保存するときに書く要件。今の Host の版より下げない
 * （新しい Host で保存したワールドを古い Host で保存し直しても、新しい機能を使っている印を消さない）。
 */
export function worldRequirementsFor(
    existing: WorldRequirements | undefined,
    hostProtocol: number = PROTOCOL_VERSION,
): WorldRequirements {
    return { protocol: Math.max(existing?.protocol ?? 0, hostProtocol) };
}

/** この Host でワールドを開けるか。要件の無いワールドは 0（版を書くようになる前に保存したもの）とみなす。 */
export function checkWorldCompatibility(
    requires: WorldRequirements | undefined,
    hostProtocol: number = PROTOCOL_VERSION,
    minCompatible: number = MIN_COMPATIBLE_PROTOCOL_VERSION,
): WorldCompatibility {
    const required = requires?.protocol ?? 0;
    if (required > hostProtocol)
        return {
            level: 'newer',
            required,
            host: hostProtocol,
            message: `このワールドは新しい ubichill（v${required}）で作られています。このサーバー（v${hostProtocol}）では一部が動かない可能性があります。`,
        };
    if (required < minCompatible)
        return {
            level: 'outdated',
            required,
            host: hostProtocol,
            message: `このワールドは古い ubichill（v${required}）で作られています。このサーバー（v${hostProtocol}）は v${minCompatible} より前のワールドの一部に対応していません。`,
        };
    return { level: 'ok' };
}
