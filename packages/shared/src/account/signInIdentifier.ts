/**
 * ログインの「メールアドレスまたは ID」の入力の読み方。`@` を含めばメールアドレス、そうでなければ ID
 * （先頭の `@` は外し、小文字にする。`@alice` も `Alice` も `alice` として探す）。
 */
export type SignInIdentifier = { kind: 'email'; email: string } | { kind: 'handle'; handle: string };

export function parseSignInIdentifier(input: string): SignInIdentifier {
    const trimmed = input.trim();
    const withoutAt = trimmed.replace(/^@/, '');
    if (withoutAt.includes('@')) return { kind: 'email', email: trimmed };
    return { kind: 'handle', handle: withoutAt.toLowerCase() };
}
