import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { rateLimitWithAuth } from '../../../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });

  // Rate limit - prevents flooding the DB with saves
  if (!rateLimitWithAuth(req, true, { authedMax: 20, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const { analysisData } = req.body;
  if (!analysisData) return res.status(400).json({ error: 'Missing analysisData' });

  try {
    const db = getSupabaseAdmin();

    // Extract top-level fields for easy querying/display in dashboard
    const { data: deal, error } = await db
      .from('deals')
      .insert({
        user_id:  session.user.id,
        address:  analysisData.address || 'Address not available',
        city:     analysisData.city     || null,
        verdict:  analysisData.verdict  || 'MAYBE',
        score:    parseInt(analysisData.overallScore, 10) || 0,
        price:    analysisData.assumedPrice || null,
        rent:     analysisData.assumedRent  || null,
        cashflow: analysisData.keyMetrics?.find(m => m.label === 'Monthly Cash Flow')?.value || null,
        coc:      analysisData.keyMetrics?.find(m => m.label === 'Cash-on-Cash')?.value      || null,
        dscr:     analysisData.keyMetrics?.find(m => m.label === 'DSCR')?.value              || null,
        cap_rate: analysisData.keyMetrics?.find(m => m.label === 'Cap Rate')?.value          || null,
        data:     analysisData,  // full jsonb blob
      })
      .select('id')
      .single();

    if (error) throw error;

    return res.status(200).json({ id: deal.id });
  } catch (err) {
    console.error('Save deal error:', err);
    return res.status(500).json({ error: 'Failed to save deal' });
  }
}
