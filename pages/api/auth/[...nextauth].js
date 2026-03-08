// NOTE on email routing: This file sends magic-link sign-in emails via nodemailer SMTP (EMAIL_SERVER + EMAIL_FROM env vars).
// Deal report emails are sent separately via Resend REST API in pages/api/deals/email.js (RESEND_API_KEY + EMAIL_FROM_DOMAIN).
// Both can use Resend: SMTP → smtp://resend:YOUR_KEY@smtp.resend.com:587, REST → RESEND_API_KEY directly.
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

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
  // Cookie config: on Vercel preview deployments NEXTAUTH_URL won't match the
  // deployment URL, which causes the secure/domain cookie to be rejected.
  // Setting useSecureCookies based on whether we're actually on HTTPS prevents
  // the cookie from being silently dropped on preview URLs.
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.session-token'
        : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  pages: {
    signIn:  '/auth',
    signOut: '/auth',
    error:   '/auth',  // OAuth/callback errors redirect to our branded page with ?error=
  },
};

export default NextAuth(authOptions);

export const config = { maxDuration: 15 };
