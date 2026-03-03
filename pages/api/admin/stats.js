// /api/admin/stats - returns aggregate analytics for the admin dashboard
// Access is gated by ADMIN_EMAILS env var (comma-separated list)
// GET → { users, deals, revenue, verdicts, topCities, dailySignups, dailyAnalyses, tokenHealth }

import { getServerSession }  from 'next-auth/next';
import { authOptions }       from '../auth/[...nextauth]';
import { getSupabaseAdmin }  from '../../../lib/supabase';
import { rateLimitWithAuth } from '../../../lib/rateLimit.js';

function isAdmin(email) {
  const adminList = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
  return adminList.includes((email || '').toLowerCase());
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: 'Not authenticated' });
  if (!isAdmin(session.user.email)) return res.status(403).json({ error: 'Admin only' });

  // Rate limit even admin - prevents accidental polling loops hammering 9 concurrent queries
  if (!rateLimitWithAuth(req, true, { authedMax: 20, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  const db = getSupabaseAdmin();

  try {
    // Run all queries in parallel
    const [
      usersRes,
      dealsRes,
      purchasesRes,
      verdictsRes,
      topCitiesRes,
      dailySignupsRes,
      dailyDealsRes,
      tokenSumRes,
      recentUsersRes,
    ] = await Promise.all([

      // Total user count + token stats
      db.from('users').select('id, tokens, created_at', { count: 'exact' }),

      // Total deal count
      db.from('deals').select('id, verdict, score, city, created_at, user_id', { count: 'exact' }),

      // Total revenue
      db.from('purchases').select('tokens_added, amount_cents, created_at'),

      // Verdict distribution
      db.from('deals').select('verdict').not('verdict', 'is', null),

      // Top cities (raw, we'll aggregate in JS)
      db.from('deals').select('city').not('city', 'is', null).not('city', 'eq', ''),

      // Daily signups - last 30 days
      db.from('users')
        .select('created_at')
        .gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString())
        .order('created_at'),

      // Daily analyses - last 30 days
      db.from('deals')
        .select('created_at')
        .gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString())
        .order('created_at'),

      // Token economy: sum of all user tokens
      db.from('users').select('tokens'),

      // Recent 10 users for activity feed
      db.from('users')
        .select('email, tokens, created_at')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    // -- Users ------------------------------------------------------------------
    const users = usersRes.data || [];
    const totalUsers = usersRes.count || users.length;
    const tokenBuckets = { zero: 0, one: 0, few: 0, many: 0 };
    let totalTokensHeld = 0;
    for (const u of users) {
      totalTokensHeld += (u.tokens || 0);
      if      (u.tokens === 0) tokenBuckets.zero++;
      else if (u.tokens === 1) tokenBuckets.one++;
      else if (u.tokens <= 5)  tokenBuckets.few++;
      else                     tokenBuckets.many++;
    }

    // -- Deals ------------------------------------------------------------------
    const deals = dealsRes.data || [];
    const totalDeals = dealsRes.count || deals.length;
    const scores = deals.filter(d => d.score != null).map(d => d.score);
    const avgScore = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0) / scores.length) : null;

    // -- Revenue ----------------------------------------------------------------
    const purchases = purchasesRes.data || [];
    const totalRevenueCents = purchases.reduce((s, p) => s + (p.amount_cents || 0), 0);
    const totalTokensSold   = purchases.reduce((s, p) => s + (p.tokens_added || 0), 0);
    const totalPurchases    = purchases.length;

    // Revenue last 30 days
    const thirtyDaysAgo = Date.now() - 30 * 86400_000;
    const recentRevenue = purchases
      .filter(p => new Date(p.created_at).getTime() > thirtyDaysAgo)
      .reduce((s, p) => s + (p.amount_cents || 0), 0);

    // -- Verdict distribution ---------------------------------------------------
    const verdictCounts = { YES: 0, NO: 0, MAYBE: 0 };
    for (const d of (verdictsRes.data || [])) {
      if (d.verdict in verdictCounts) verdictCounts[d.verdict]++;
    }

    // -- Top cities -------------------------------------------------------------
    const cityMap = {};
    for (const d of (topCitiesRes.data || [])) {
      const city = (d.city || '').trim();
      if (city) cityMap[city] = (cityMap[city] || 0) + 1;
    }
    const topCities = Object.entries(cityMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([city, count]) => ({ city, count }));

    // -- Daily time-series (last 30 days, bucketed by day) --------------------
    function bucketByDay(rows, field = 'created_at') {
      const map = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400_000);
        const key = d.toISOString().slice(0, 10);
        map[key] = 0;
      }
      for (const row of (rows || [])) {
        const key = (row[field] || '').slice(0, 10);
        if (key in map) map[key]++;
      }
      return Object.entries(map).map(([date, count]) => ({ date, count }));
    }

    const dailySignups  = bucketByDay(dailySignupsRes.data);
    const dailyAnalyses = bucketByDay(dailyDealsRes.data);

    // -- Activation rate (users who ran at least 1 analysis) -------------------
    const dealUserIds = new Set((dealsRes.data || []).map(d => d.user_id).filter(Boolean));
    const activatedUsers = dealUserIds.size;
    const activationRate = totalUsers > 0 ? Math.round(activatedUsers / totalUsers * 100) : 0;

    // -- Phase 4: Fallback audit + law change queue ---------------------------
    let fallbackAudit   = null;
    let pendingLawChanges = [];
    let marketSnapshot  = null;
    try {
      const { data: auditRows } = await db
        .from('market_data_cache')
        .select('key, value, fetched_at')
        .or('key.like._fallback_audit:%,key.eq.landlord_laws_pending_changes,key.eq.market_snapshot:current');

      for (const row of (auditRows || [])) {
        if (row.key === 'landlord_laws_pending_changes') {
          pendingLawChanges = (row.value || []).filter(c => c.status === 'pending_review');
        } else if (row.key === 'market_snapshot:current') {
          marketSnapshot = { timestamp: row.value?.timestamp, mortgageRate: row.value?.mortgageRate };
        } else if (row.key.startsWith('_fallback_audit:')) {
          if (!fallbackAudit) fallbackAudit = {};
          const dataKey = row.key.replace('_fallback_audit:', '');
          fallbackAudit[dataKey] = { sourceUsed: row.value?.sourceUsed, timestamp: row.value?.timestamp };
        }
      }
    } catch {
      // Phase 4 data is supplemental — don't fail the whole stats call
    }

    res.status(200).json({
      users: {
        total:          totalUsers,
        activated:      activatedUsers,
        activationRate,
        tokenBuckets,
        totalTokensHeld,
        recent:         recentUsersRes.data || [],
      },
      deals: {
        total:    totalDeals,
        avgScore,
        verdicts: verdictCounts,
        topCities,
      },
      revenue: {
        totalCents:    totalRevenueCents,
        last30DayCents: recentRevenue,
        totalTokensSold,
        totalPurchases,
      },
      timeseries: {
        dailySignups,
        dailyAnalyses,
      },
      // Phase 4 additions
      dataHealth: {
        fallbackAudit,        // which data sources are using backup feeds
        pendingLawChanges,    // landlord law changes awaiting human review
        marketSnapshot,       // last weekly digest snapshot
      },
    });

  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
}

export const config = { maxDuration: 20 };
