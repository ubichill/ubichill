import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createMailer, mailTransportFrom } from './mail';

describe('メールの送り方', () => {
    it('SMTP_URL があれば SMTP を使う（Resend のキーがあっても）。資格情報は URL のエンコードを戻す', () => {
        expect(
            mailTransportFrom({ smtpUrl: 'smtps://user%40example.com:p%2Fss@smtp.example.com', resendApiKey: 're_x' }),
        ).toEqual({
            kind: 'smtp',
            host: 'smtp.example.com',
            port: 465,
            secure: true,
            requireTLS: false,
            auth: { user: 'user@example.com', pass: 'p/ss' },
        });
    });

    it('smtp:// は STARTTLS を必須にする（パスワードを平文で流さない）。手元のメールサーバーだけ TLS なしを許す', () => {
        expect(mailTransportFrom({ smtpUrl: 'smtp://u:p@mail.example.com:2525' })).toMatchObject({
            port: 2525,
            secure: false,
            requireTLS: true,
        });
        expect(mailTransportFrom({ smtpUrl: 'smtp://mail.example.com' })).toMatchObject({ port: 587, auth: null });
        for (const host of ['localhost:1025', '127.0.0.1:1025', '[::1]:1025']) {
            expect(mailTransportFrom({ smtpUrl: `smtp://${host}` })).toMatchObject({ requireTLS: false });
        }
        // 名前が localhost で始まるだけの外のホストは手元扱いにしない
        expect(mailTransportFrom({ smtpUrl: 'smtp://localhost.example.com' })).toMatchObject({ requireTLS: true });
    });

    it('SMTP が無ければ Resend、どちらも無ければ送らない', () => {
        expect(mailTransportFrom({ resendApiKey: 're_x' })).toEqual({ kind: 'resend', apiKey: 're_x' });
        expect(mailTransportFrom({ smtpUrl: '', resendApiKey: '' })).toEqual({ kind: 'none' });
    });

    it('送る手段が無いときは、送ろうとすると投げる（届かないメールを送ったことにしない）', async () => {
        const mailer = createMailer({ kind: 'none' }, 'Ubichill <noreply@example.com>');
        expect(mailer.configured).toBe(false);
        await expect(mailer.send({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow();
    });

    it('SMTP で送る（手元の最小の SMTP サーバーで、宛先・送信元・件名が届くことを確かめる）', async () => {
        const received: string[] = [];
        const server = createServer((socket) => {
            const state = { data: false };
            socket.write('220 test ESMTP\r\n');
            socket.on('data', (chunk) => {
                for (const line of chunk.toString().split('\r\n').filter(Boolean)) {
                    received.push(line);
                    if (state.data) {
                        if (line === '.') {
                            state.data = false;
                            socket.write('250 queued\r\n');
                        }
                    } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250 test\r\n');
                    else if (/^DATA/i.test(line)) {
                        state.data = true;
                        socket.write('354 go\r\n');
                    } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
                    else socket.write('250 ok\r\n');
                }
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as { port: number }).port;
        try {
            const mailer = createMailer(
                mailTransportFrom({ smtpUrl: `smtp://127.0.0.1:${port}` }),
                'Ubichill <noreply@example.com>',
            );
            await mailer.send({ to: 'alice@example.com', subject: 'Code', text: 'your code is 123456' });
            expect(received).toContain('RCPT TO:<alice@example.com>');
            expect(received.some((l) => l.startsWith('MAIL FROM:<noreply@example.com>'))).toBe(true);
            expect(received).toContain('Subject: Code');
            expect(received).toContain('your code is 123456');
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
