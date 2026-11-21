/**
 * メールの送り方。環境変数で選ぶ: SMTP_URL があれば SMTP（自前のメールサーバー・Resend の SMTP・Gmail など）、
 * 無ければ RESEND_API_KEY で Resend の API、どちらも無ければ送らない（呼び手はログだけ出す）。
 */
import nodemailer from 'nodemailer';
import { Resend } from 'resend';

export type MailTransport =
    | {
          kind: 'smtp';
          host: string;
          port: number;
          /** smtps://（最初から TLS） */
          secure: boolean;
          /** smtp:// で STARTTLS を必須にするか（手元のメールサーバー以外は必須） */
          requireTLS: boolean;
          auth: { user: string; pass: string } | null;
      }
    | { kind: 'resend'; apiKey: string }
    | { kind: 'none' };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 環境変数から送り方を決める（SMTP を優先する）。SMTP_URL は config で smtp:・smtps: に限ってある。 */
export function mailTransportFrom(env: { smtpUrl?: string; resendApiKey?: string }): MailTransport {
    if (env.smtpUrl) {
        const url = new URL(env.smtpUrl);
        const secure = url.protocol === 'smtps:';
        return {
            kind: 'smtp',
            // IPv6 の [::1] は角括弧を外して渡す
            host: url.hostname.replace(/^\[|\]$/g, ''),
            port: url.port ? Number(url.port) : secure ? 465 : 587,
            secure,
            // パスワードを平文で流さない。手元の確認用（Mailpit など）だけ TLS なしを許す
            requireTLS: !secure && !LOOPBACK.has(url.hostname),
            auth: url.username
                ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
                : null,
        };
    }
    if (env.resendApiKey) return { kind: 'resend', apiKey: env.resendApiKey };
    return { kind: 'none' };
}

export interface Mailer {
    /** 送る手段があるか（無ければ呼び手は送らずにログだけ出す） */
    readonly configured: boolean;
    readonly kind: MailTransport['kind'];
    /** 送る。送れなければ投げる */
    send(input: { to: string; subject: string; text: string }): Promise<void>;
}

export function createMailer(transport: MailTransport, from: string): Mailer {
    switch (transport.kind) {
        case 'smtp': {
            const smtp = nodemailer.createTransport({
                host: transport.host,
                port: transport.port,
                secure: transport.secure,
                requireTLS: transport.requireTLS,
                ...(transport.auth ? { auth: transport.auth } : {}),
            });
            return {
                configured: true,
                kind: 'smtp',
                send: async (input) => {
                    await smtp.sendMail({ from, ...input });
                },
            };
        }
        case 'resend': {
            const resend = new Resend(transport.apiKey);
            return {
                configured: true,
                kind: 'resend',
                // Resend は API の失敗（キーの誤り・送信元の未確認など）を投げずに `error` で返すので、ここで投げる
                send: async (input) => {
                    const { error } = await resend.emails.send({ from, ...input });
                    if (error) throw new Error(`メールを送れませんでした: ${error.name} ${error.message}`);
                },
            };
        }
        case 'none':
            return {
                configured: false,
                kind: 'none',
                send: async () => {
                    throw new Error('メールの送り方が設定されていません（SMTP_URL か RESEND_API_KEY）');
                },
            };
    }
}
