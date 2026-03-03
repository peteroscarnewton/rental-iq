// /api/deals/email - sends an HTML analysis report to the user's email via Resend REST API
// NOTE: This route uses the Resend REST API directly (fetch to api.resend.com) — requires RESEND_API_KEY + EMAIL_FROM_DOMAIN.
// Magic-link auth emails (sign in) are sent separately via nodemailer SMTP in pages/api/auth/[...nextauth].js — requires EMAIL_SERVER + EMAIL_FROM.
// POST { analysisData, shareUrl? } → { success }

import { getServerSession }   from 'next-auth/next';
import { authOptions }        from '../auth/[...nextauth]';
import { rateLimitWithAuth }  from '../../../lib/rateLimit.js';

const VERDICT_COLOR = { YES: '#166638', NO: '#a62626', MAYBE: '#8a5800' };
const VERDICT_BG    = { YES: '#ecf6f1', NO: '#fdf0f0', MAYBE: '#fdf4e8' };

function buildEmailHtml(data, recipientEmail, shareUrl) {
  const verdict      = (data.verdict || 'MAYBE').toUpperCase();
  const score        = data.overallScore || 0;
  const vColor       = VERDICT_COLOR[verdict] || VERDICT_COLOR.MAYBE;
  const vBg          = VERDICT_BG[verdict]    || VERDICT_BG.MAYBE;
  const address      = data.address || data.assumedPrice || 'Property Analysis';
  const city         = data._settings?.city || '';
  const keyMetrics   = (data.keyMetrics || []).slice(0, 8);
  const narrative    = data.narrative || '';
  const price        = data.assumedPrice || '';
  const rent         = data.assumedRent  || '';
  const s            = data._settings || {};

  const metricsRows = keyMetrics.map(m => {
    const color = m.status === 'good' ? '#166638' : m.status === 'bad' ? '#a62626' : '#8a5800';
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eaeaef;font-size:13px;color:#72727a">${m.label}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eaeaef;font-size:13px;font-weight:600;color:${color};text-align:right">${m.value}</td>
      </tr>`;
  }).join('');

  const shareSection = shareUrl ? `
    <div style="margin:24px 0;padding:16px 20px;background:#f5f5f8;border-radius:10px;font-size:13px;color:#72727a">
      <strong style="color:#0d0d0f">Share this analysis:</strong><br/>
      <a href="${shareUrl}" style="color:#166638;word-break:break-all">${shareUrl}</a>
    </div>` : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

    <!-- Header -->
    <div style="padding:24px 28px 20px;border-bottom:1px solid #eaeaef">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#72727a;margin-bottom:4px">RentalIQ Analysis</div>
      <div style="font-size:20px;font-weight:700;color:#0d0d0f;line-height:1.2">${address}${city ? `<span style="font-size:14px;font-weight:400;color:#72727a"> · ${city}</span>` : ''}</div>
    </div>

    <!-- Verdict -->
    <div style="padding:24px 28px;background:${vBg};border-bottom:1px solid #eaeaef">
      <div style="display:inline-block;background:${vColor};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:4px 12px;border-radius:100px;margin-bottom:10px">${verdict}</div>
      <div style="font-size:13px;color:#72727a">
        RentalIQ Score: <strong style="color:${vColor}">${score}/100</strong>
        ${price ? ` · Price: <strong style="color:#0d0d0f">${price}</strong>` : ''}
        ${rent  ? ` · Rent: <strong style="color:#0d0d0f">${rent}/mo</strong>` : ''}
      </div>
    </div>

    <!-- Key Metrics -->
    <div style="padding:0 0 4px">
      <div style="padding:16px 28px 8px;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#72727a">Key Metrics</div>
      <table style="width:100%;border-collapse:collapse">${metricsRows}</table>
    </div>

    <!-- Narrative -->
    ${narrative ? `
    <div style="padding:20px 28px;border-top:1px solid #eaeaef">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#72727a;margin-bottom:10px">AI Analysis</div>
      <div style="font-size:13.5px;color:#0d0d0f;line-height:1.7">${narrative.replace(/\n/g,'<br/>')}</div>
    </div>` : ''}

    ${shareSection}

    <!-- Settings used -->
    <div style="padding:16px 28px;background:#f5f5f8;font-size:11.5px;color:#72727a;line-height:1.8">
      ${s.cashPurchase ? 'Cash purchase' : `${s.downPaymentPct || 20}% down · ${s.interestRate || 7.25}% rate`}
      ${s.selfManage ? ' · Self-managed' : ' · With property manager'}
      ${s.investorGoal ? ` · Goal: ${s.investorGoal}` : ''}
    </div>

    <!-- Footer -->
    <div style="padding:16px 28px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eaeaef">
      Sent by RentalIQ · Not financial advice<br/>
      <a href="${process.env.NEXTAUTH_URL || 'https://rentaliq.app'}" style="color:#166638">Analyze another property →</a>
    </div>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: 'Not authenticated' });

  // Rate limit - 5 emails/min per user (enough for legitimate use, stops spam)
  if (!rateLimitWithAuth(req, true, { authedMax: 5, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const { analysisData, shareUrl } = req.body;
  if (!analysisData) return res.status(400).json({ error: 'analysisData required' });

  // Support RESEND_API_KEY directly (preferred).
  // Fallback: extract password from EMAIL_SERVER smtp:// URL — only works when
  // you're using Resend SMTP (smtp://resend:YOUR_KEY@smtp.resend.com:587). If
  // you're using any other SMTP provider this path will extract the wrong
  // password and Resend will reject it with a 403. Set RESEND_API_KEY instead.
  let apiKey = process.env.RESEND_API_KEY || null;
  if (!apiKey) {
    const smtpUrl = process.env.EMAIL_SERVER;
    if (!smtpUrl) return res.status(500).json({ error: 'Email not configured. Set RESEND_API_KEY in your environment variables.' });
    try {
      const parsed = new URL(smtpUrl);
      apiKey = parsed.password || null;
      // Resend API keys always start with 're_'
      if (apiKey && !apiKey.startsWith('re_')) {
        console.warn('email.js: Extracted SMTP password does not look like a Resend API key. Set RESEND_API_KEY explicitly.');
        return res.status(500).json({ error: 'Email not configured correctly. Set RESEND_API_KEY in your environment variables.' });
      }
    } catch (_) {
      return res.status(500).json({ error: 'EMAIL_SERVER is not a valid URL' });
    }
  }
  if (!apiKey) return res.status(500).json({ error: 'Email API key not configured. Set RESEND_API_KEY.' });

  try {
    const html    = buildEmailHtml(analysisData, session.user.email, shareUrl);
    const address = analysisData.address || analysisData.assumedPrice || 'Property';
    const verdict = (analysisData.verdict || 'MAYBE').toUpperCase();

    // Send via Resend REST API (simpler than SMTP on serverless)
    const emailRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'RentalIQ <reports@' + (process.env.EMAIL_FROM_DOMAIN || 'rentaliq.app') + '>',
        to:      [session.user.email],
        subject: `${verdict}: ${address} - Your RentalIQ Report`,
        html,
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!emailRes.ok) {
      const err = await emailRes.json().catch(() => ({}));
      throw new Error(err?.message || `Email API error ${emailRes.status}`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Email report error:', err);
    return res.status(500).json({ error: err.message || 'Failed to send email' });
  }
}

export const config = { maxDuration: 20 };
