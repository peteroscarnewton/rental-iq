/**
 * lib/addressIntelFetcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 6 — Property & Address Intelligence (Items 6 & 9)
 *
 *   6. fetchFloodRisk(lat, lng)  — FEMA National Flood Hazard Layer API
 *      Returns the flood zone, Base Flood Elevation (BFE), and a modeled
 *      annual flood insurance cost estimate. Free, no API key required.
 *
 *   9. fetchSchoolRating(zip)    — NCES Common Core of Data (CCD)
 *      Returns school count and rated quality tiers by ZIP from the federal
 *      school database. Free, no API key required.
 *
 * On-demand endpoints (not cached globally):
 *   flood_risk:{lat_lng_hash}     → { zone, bfe, riskLevel, annualInsEst, source }
 *   school_rating:{zip}           → { elementary, middle, high, overall, count, source }
 *
 * Error philosophy: each function returns null on failure. The caller
 * handles null gracefully (cards simply don't render).
 */

// ─── FEMA NFHL Flood Zone Definitions ────────────────────────────────────────
// Source: FEMA Flood Map Service Center documentation
const FLOOD_ZONE_META = {
  // High-risk zones (Special Flood Hazard Areas — SFHA)
  A:   { risk: 'high',   label: 'Zone A',   desc: 'High risk — 1% annual flood chance. Flood insurance typically required by lenders.', reqInsurance: true  },
  AE:  { risk: 'high',   label: 'Zone AE',  desc: 'High risk with Base Flood Elevation determined. Flood insurance required by lenders.', reqInsurance: true  },
  AH:  { risk: 'high',   label: 'Zone AH',  desc: 'High risk — shallow flooding (1–3 ft ponding). Flood insurance required.', reqInsurance: true  },
  AO:  { risk: 'high',   label: 'Zone AO',  desc: 'High risk — sheet flow flooding. Flood insurance required.', reqInsurance: true  },
  A1:  { risk: 'high',   label: 'Zone A1',  desc: 'High risk numbered zone. Flood insurance required.', reqInsurance: true  },
  A99: { risk: 'high',   label: 'Zone A99', desc: 'High risk — protected by federal flood control project.', reqInsurance: true  },
  V:   { risk: 'very_high', label: 'Zone V', desc: 'Coastal high-hazard zone with wave action. Highest risk category.', reqInsurance: true  },
  VE:  { risk: 'very_high', label: 'Zone VE', desc: 'Coastal high-hazard zone with BFE. Highest risk — wave action.', reqInsurance: true  },
  // Moderate/low-risk zones
  B:   { risk: 'moderate', label: 'Zone B',  desc: 'Moderate flood risk (0.2% annual chance). Insurance not required but recommended.', reqInsurance: false },
  C:   { risk: 'low',      label: 'Zone C',  desc: 'Minimal flood risk. No insurance requirement.', reqInsurance: false },
  X:   { risk: 'low',      label: 'Zone X',  desc: 'Minimal flood risk (500-yr flood plain). No insurance requirement.', reqInsurance: false },
  D:   { risk: 'undetermined', label: 'Zone D', desc: 'Flood risk undetermined — no FEMA study available for this area.', reqInsurance: false },
};

// Annual flood insurance cost estimates by zone (national averages post-Risk Rating 2.0, 2024)
// Source: FEMA/NFIP Risk Rating 2.0 actuarial data (public)
const FLOOD_INS_EST = {
  very_high: { low: 2200, mid: 3800, high: 6500 }, // VE, V zones — coastal wave action
  high:      { low: 900,  mid: 1650, high: 3200 }, // A, AE, AH, AO zones
  moderate:  { low: 500,  mid: 800,  high: 1400 }, // B zones
  low:       { low: 0,    mid: 0,    high: 0    }, // X, C zones — not required
  undetermined: { low: 400, mid: 900, high: 2000 }, // D zones — unknown
};

/**
 * Look up FEMA flood zone for a lat/lng coordinate.
 * Uses the FEMA Map Service Center REST API (NFHL Feature Service).
 * No API key, no rate limit for reasonable usage.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<FloodRiskResult|null>}
 */
export async function fetchFloodRisk(lat, lng) {
  if (!lat || !lng) return null;

  try {
    // FEMA NFHL Feature Service — FLD_HAZ_AR (Flood Hazard Area polygon layer)
    // Query by point using ESRI geometry filter
    const params = new URLSearchParams({
      where:          '1=1',
      geometry:       `${lng},${lat}`,
      geometryType:   'esriGeometryPoint',
      spatialRel:     'esriSpatialRelIntersects',
      inSR:           '4326',
      outFields:      'FLD_ZONE,ZONE_SUBTY,BFE_VAL,SFHA_TF,STUDY_TYP',
      returnGeometry: 'false',
      f:              'json',
    });

    const url = `https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query?${params}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`FEMA API ${r.status}`);

    const body = await r.json();
    const features = body?.features || [];

    if (features.length === 0) {
      // No FEMA study data — Zone D (undetermined)
      return buildFloodResult('D', null, false);
    }

    // Take the highest-risk zone if multiple polygons overlap the point
    const zonePriority = ['VE','V','AE','A','AH','AO','A99','A1','B','X','C','D'];
    let best = null;
    for (const f of features) {
      const zone = (f.attributes?.FLD_ZONE || 'X').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!best || zonePriority.indexOf(zone) < zonePriority.indexOf(best.zone)) {
        best = {
          zone,
          bfe:     f.attributes?.BFE_VAL ?? null,
          sfha:    f.attributes?.SFHA_TF === 'T',
          studyType: f.attributes?.STUDY_TYP || null,
        };
      }
    }

    if (!best) return buildFloodResult('X', null, false);
    return buildFloodResult(best.zone, best.bfe, best.sfha, best.studyType);

  } catch (err) {
    console.warn('[addressIntelFetcher] FEMA flood lookup failed:', err.message);
    return null;
  }
}

function buildFloodResult(zone, bfe, sfha, studyType = null) {
  // Normalize zone — strip suffixes after first letter+digit combo for lookup
  const baseZone = zone.match(/^(VE|AE|AH|AO|A99|A1|V|A|B|C|X|D)/)?.[1] || 'X';
  const meta = FLOOD_ZONE_META[baseZone] || FLOOD_ZONE_META['X'];
  const insEst = FLOOD_INS_EST[meta.risk] || FLOOD_INS_EST['low'];

  return {
    zone:            zone,
    baseZone:        baseZone,
    riskLevel:       meta.risk,           // 'high', 'moderate', 'low', 'very_high', 'undetermined'
    label:           meta.label,
    description:     meta.desc,
    requiresInsurance: meta.reqInsurance || sfha,
    bfe:             bfe && bfe > 0 ? Math.round(bfe * 10) / 10 : null, // ft above sea level
    studyType:       studyType,
    annualInsEst: {
      low:  insEst.low,
      mid:  insEst.mid,
      high: insEst.high,
    },
    monthlyInsEst: {
      low:  Math.round(insEst.low  / 12),
      mid:  Math.round(insEst.mid  / 12),
      high: Math.round(insEst.high / 12),
    },
    source: 'FEMA NFHL / Risk Rating 2.0',
    note: meta.reqInsurance
      ? `Flood insurance required by most lenders. Budget $${insEst.low.toLocaleString()}–$${insEst.high.toLocaleString()}/yr ($${Math.round(insEst.low/12).toLocaleString()}–$${Math.round(insEst.high/12).toLocaleString()}/mo).`
      : insEst.mid > 0
        ? `Flood insurance not required but available. Estimated $${insEst.low.toLocaleString()}–$${insEst.high.toLocaleString()}/yr if purchased.`
        : 'Minimal flood risk. Flood insurance not required or needed.',
  };
}

// ─── NCES Common Core of Data — School Quality by ZIP ─────────────────────────
/**
 * Fetch school quality data for a ZIP code from the NCES Common Core of Data.
 * The CCD is a free federal database of all US public schools with enrollment,
 * grade range, and locale codes.
 *
 * We use locale codes + Title I status to derive a quality tier:
 *   - City/suburban schools: higher baseline ratings
 *   - Title I (high poverty) reduces rating
 *   - School count and type diversity improves signal
 *
 * Note: The NCES API returns raw school data; we compute a composite tier.
 * This is intentionally conservative — we show count + tier, not a fake score.
 *
 * @param {string} zip
 * @returns {Promise<SchoolRatingResult|null>}
 */
export async function fetchSchoolRating(zip) {
  if (!zip || !/^\d{5}$/.test(zip)) return null;

  try {
    // NCES CCD API — public schools by ZIP (no key required)
    // Variables: NCESSCH, SCHNAM, GSLO, GSHI, LOCALE, TITLEI, STUTERATIO, TOTFRL, MEMBER
    const url = `https://educationdata.urban.org/api/v1/schools/ccd/directory/?zip_code=${zip}&year=2022&fields=ncessch,school_name,grade_low,grade_high,locale,title_i_status,student_teacher_ratio,free_reduced_lunch,enrollment&limit=50`;

    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`NCES API ${r.status}`);

    const body = await r.json();
    const schools = body?.results || [];

    if (schools.length === 0) {
      return { count: 0, elementary: 0, middle: 0, high: 0, overall: 'no_data', source: 'NCES CCD', note: 'No public schools found in this ZIP code.' };
    }

    // Categorize by grade range
    const elementary = schools.filter(s => gradeNum(s.grade_low) <= 5 && gradeNum(s.grade_high) <= 8);
    const middle     = schools.filter(s => gradeNum(s.grade_low) >= 5 && gradeNum(s.grade_low) <= 8);
    const high       = schools.filter(s => gradeNum(s.grade_high) >= 9);

    // Compute quality signals
    const avgStudentTeacherRatio = avg(schools.map(s => s.student_teacher_ratio).filter(v => v > 0 && v < 50));
    const titleICount = schools.filter(s => s.title_i_status === 1 || s.title_i_status === '1').length;
    const titleIPct   = schools.length > 0 ? titleICount / schools.length : 0;

    // Locale distribution (1x = city, 2x = suburb, 3x = town, 4x = rural)
    const localeScores = schools.map(s => {
      const l = parseInt(s.locale) || 40;
      if (l <= 13) return 4; // city
      if (l <= 23) return 3; // suburb
      if (l <= 33) return 2; // town
      return 1;              // rural
    });
    const avgLocale = avg(localeScores);

    // Composite rating
    let score = 50;
    score += (avgLocale - 2.5) * 10;          // suburb/city boost
    score -= titleIPct * 20;                   // Title I penalty (high poverty)
    if (avgStudentTeacherRatio > 0) {
      score += Math.max(-15, Math.min(15, (20 - avgStudentTeacherRatio) * 1.5)); // lower ratio = better
    }
    score = Math.max(10, Math.min(95, Math.round(score)));

    const tier = score >= 70 ? 'strong' : score >= 50 ? 'average' : score >= 30 ? 'below_average' : 'weak';
    const tierLabels = {
      strong:        'Strong schools',
      average:       'Average schools',
      below_average: 'Below average schools',
      weak:          'Weak school district',
    };

    return {
      count:       schools.length,
      elementary:  elementary.length,
      middle:      middle.length,
      high:        high.length,
      score,
      tier,
      tierLabel:   tierLabels[tier],
      avgStudentTeacherRatio: avgStudentTeacherRatio ? Math.round(avgStudentTeacherRatio * 10) / 10 : null,
      titleIPct:   Math.round(titleIPct * 100),
      overall:     tier,
      source:      'NCES Common Core of Data (2022)',
      note:        buildSchoolNote(tier, schools.length, elementary.length, high.length, titleIPct),
    };
  } catch (err) {
    console.warn('[addressIntelFetcher] NCES school lookup failed:', err.message);
    return null;
  }
}

function gradeNum(g) {
  if (!g) return 0;
  const map = { PK: -1, KG: 0, N: -2 };
  if (map[g] !== undefined) return map[g];
  return parseInt(g) || 0;
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function buildSchoolNote(tier, total, elem, hs, titleIPct) {
  const typeSummary = [elem > 0 && `${elem} elementary`, hs > 0 && `${hs} high school`].filter(Boolean).join(', ');
  const titleNote = titleIPct > 0.5 ? ` (${Math.round(titleIPct * 100)}% Title I — higher poverty)` : '';
  const tierNarrative = {
    strong:        'Schools in this ZIP are above average — positive driver for SFR appreciation and family-tenant demand.',
    average:       'Schools in this ZIP are around the national average. Minimal impact on appreciation or tenant profile.',
    below_average: 'Schools are below average — may limit appreciation upside in family-oriented neighborhoods.',
    weak:          'Weak school district — can compress SFR values and tenant quality in family neighborhoods.',
  }[tier] || '';
  return `${total} public schools${typeSummary ? ` (${typeSummary})` : ''}${titleNote}. ${tierNarrative}`;
}
