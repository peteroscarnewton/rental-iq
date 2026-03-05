// NOTE on email routing: This file sends magic-link sign-in emails via nodemailer SMTP (EMAIL_SERVER + EMAIL_FROM env vars).
// Deal report emails are sent separately via Resend REST API in pages/api/deals/email.js (RESEND_API_KEY + EMAIL_FROM_DOMAIN).
// Both can use Resend: SMTP → smtp://resend:YOUR_KEY@smtp.resend.com:587, REST → RESEND_API_KEY directly.
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import EmailProvider from 'next-auth/providers/email';
import { getSupabaseAdmin } from '../../../lib/supabase';

// We manage users in Supabase manually via callbacks
// rather than using @next-auth/supabase-adapter (avoids version conflicts)
async function getOrCreateUser(email, name, image) {
  const db = getSupabaseAdmin();

  // Check if user exists
  const { data: existing } = await db
    .from('users')
    .select('id, email, tokens, name, image')
    .eq('email', email)
    .single();

  if (existing) {
    // Update name/image if changed (Google profile updates)
    if (name && (existing.name !== name || existing.image !== image)) {
      await db.from('users').update({ name, image }).eq('email', email);
    }
    return existing;
  }

  // New user - create with 2 free tokens: 1 for Analyze + 1 for Scout AI search
  const { data: created, error } = await db
    .from('users')
    .insert({ email, name: name || email.split('@')[0], image, tokens: 2 })
    .select('id, email, tokens, name, image')
    .single();

  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return created;
}

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    EmailProvider({
      server:       process.env.EMAIL_SERVER,
      from:         process.env.EMAIL_FROM || 'RentalIQ <noreply@rentaliq.app>',
      sendVerificationRequest: async ({ identifier: email, url, provider }) => {
        // Branded HTML magic-link email
        const { createTransport } = await import('nodemailer');
        const transport = createTransport(provider.server);
        const baseUrl   = process.env.NEXTAUTH_URL || 'https://rentaliq.app';

        const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <div style="max-width:480px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="padding:28px 32px 24px;border-bottom:1px solid #eaeaef">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:0">
        <div style="width:8px;height:8px;background:#166638;border-radius:50%"></div>
        <span style="font-size:14px;font-weight:700;color:#0d0d0f;letter-spacing:-0.01em">RentalIQ</span>
      </div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#0d0d0f;margin:0 0 10px;letter-spacing:-0.02em">
        Your sign-in link
      </h1>
      <p style="font-size:14px;color:#72727a;line-height:1.65;margin:0 0 28px">
        Click the button below to sign in to RentalIQ. This link expires in 24 hours and can only be used once.
      </p>
      <a href="\${url}" style="display:block;background:#166638;color:#ffffff;text-decoration:none;border-radius:10px;padding:14px 24px;font-size:14px;font-weight:700;text-align:center;letter-spacing:-0.01em">
        Sign in to RentalIQ →
      </a>
      <p style="font-size:12px;color:#aaa;margin:20px 0 0;text-align:center;line-height:1.6">
        If you didn't request this, you can safely ignore this email.<br/>
        Not working? Copy this link: <a href="\${url}" style="color:#166638;word-break:break-all">\${url}</a>
      </p>
    </div>
    <div style="padding:16px 32px;background:#f5f5f8;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eaeaef">
      RentalIQ · Not financial advice ·
      <a href="\${baseUrl}" style="color:#166638;text-decoration:none">rentaliq.app</a>
    </div>
  </div>
</body>
</html>`;

        await transport.sendMail({
          to:      email,
          from:    provider.from,
          subject: 'Sign in to RentalIQ',
          html,
          text:    `Sign in to RentalIQ:\n${url}\n\nIf you didn't request this, ignore this email.`,
        });
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      try {
        await getOrCreateUser(user.email, user.name, user.image);
        return true;
      } catch (err) {
        console.error('signIn callback error:', err);
        return false;
      }
    },

    async session({ session, token }) {
      // Attach DB user data to session so client components can read it
      if (session?.user?.email) {
        try {
          const db = getSupabaseAdmin();
          const { data: dbUser } = await db
            .from('users')
            .select('id, tokens')
            .eq('email', session.user.email)
            .single();

          if (dbUser) {
            session.user.id     = dbUser.id;
            session.user.tokens = dbUser.tokens;
          }
        } catch (err) {
          console.error('session callback error:', err);
        }
      }
      return session;
    },

    async jwt({ token, user }) {
      if (user) token.email = user.email;
      return token;
    },
  },

  session: { strategy: 'jwt' },
  secret:  process.env.NEXTAUTH_SECRET,
  pages: {
    signIn:  '/auth',
    signOut: '/auth',
    error:   '/auth',  // OAuth/callback errors redirect to our branded page with ?error=
  },
};

export default NextAuth(authOptions);

export const config = { maxDuration: 15 };
