// /sitemap.xml - dynamically generated, includes public share pages
import { getSupabaseAdmin } from '../lib/supabase';

export async function getServerSideProps({ res }) {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://rentaliq.app';

  // Static pages
  const staticPages = [
    { url: baseUrl,                   changefreq: 'monthly', priority: '1.0' },
    { url: `${baseUrl}/analyze`,      changefreq: 'daily',  priority: '0.9' },
    { url: `${baseUrl}/scout`,        changefreq: 'weekly', priority: '0.8' },
  ];

  // Public shared deals
  let sharedPages = [];
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('no db');
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('deals')
      .select('share_token, created_at')
      .eq('is_public', true)
      .not('share_token', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500);

    if (data) {
      sharedPages = data.map(d => ({
        url:        `${baseUrl}/share/${d.share_token}`,
        changefreq: 'monthly',
        priority:   '0.5',
        lastmod:    d.created_at?.slice(0, 10),
      }));
    }
  } catch (_) {}

  const allPages = [...staticPages, ...sharedPages];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(p => `  <url>
    <loc>${p.url}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
    ${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ''}
  </url>`).join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'text/xml');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.write(xml);
  res.end();

  return { props: {} };
}

export default function Sitemap() { return null; }
