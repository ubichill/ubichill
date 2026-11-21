/**
 * ログインの「メールアドレスまたは ID」を、better-auth のパスワードのログイン（メールアドレスで引く）に渡す
 * メールアドレスにする。ID の持ち主がいなければ、誰のものでもないアドレスにする（メールアドレスで入れたときと
 * 同じ「メールアドレスかパスワードが違う」で断り、ID があるかを明かさない）。
 */
import { parseSignInIdentifier } from '@ubichill/shared';

/** どのユーザーのものでもないアドレス（`.invalid` は使われない TLD。メールなしユーザーの `@sso.invalid` とも別） */
export const UNKNOWN_HANDLE_EMAIL = 'no-such-user@handle.invalid';

/** ID の長さの上限より長いものは探さない */
const MAX_HANDLE_LENGTH = 64;

export interface SignInEmailDeps {
    /** その ID のユーザーのメールアドレス（いなければ null） */
    findEmailByHandle(handle: string): Promise<string | null>;
}

/** 入力が ID なら、渡すメールアドレス。メールアドレスなら null（そのまま渡す）。 */
export function createSignInEmailResolver(deps: SignInEmailDeps): (input: string) => Promise<string | null> {
    return async (input) => {
        const parsed = parseSignInIdentifier(input);
        if (parsed.kind === 'email') return null;
        if (!parsed.handle || parsed.handle.length > MAX_HANDLE_LENGTH) return UNKNOWN_HANDLE_EMAIL;
        return (await deps.findEmailByHandle(parsed.handle)) ?? UNKNOWN_HANDLE_EMAIL;
    };
}
