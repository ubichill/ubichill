/**
 * ログインの「メールアドレスまたは ID」の入力の読み方。`@` を含めばメールアドレス、そうでなければ ID
 * （小文字にして探す。`Alice` も `alice` として探す）。
 */
export type SignInIdentifier = { kind: 'email'; email: string } | { kind: 'handle'; handle: string };

export function parseSignInIdentifier(input: string): SignInIdentifier {
    const trimmed = input.trim();
    if (trimmed.includes('@')) return { kind: 'email', email: trimmed };
    return { kind: 'handle', handle: trimmed.toLowerCase() };
}
