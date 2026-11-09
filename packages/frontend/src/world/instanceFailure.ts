/** 入れなかった理由。 */
export interface InstanceFailure {
    message: string;
    /** 同じアカウントが別のタブ・端末で入り、この接続が切られた */
    replaced: boolean;
    /** 部屋が無い（閉じた・入れる人が限られていて見えない） */
    gone: boolean;
}

/** `fetchInstance` が部屋を見つけられなかったときに投げる。 */
export class InstanceNotFoundError extends Error {
    override readonly name = 'InstanceNotFoundError';
}
