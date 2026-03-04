// PDF export — builds a formatted investor memo using jsPDF.
// Loaded dynamically from CDN to avoid adding jsPDF to the bundle.
// Called by ProsAndCons when user clicks "Download PDF".
import { C } from '../components/analyze/tokens';

// -- jsPDF loader - loads from CDN once, caches on window ---------------------
async function loadJsPDF() {
  if (typeof window === 'undefined') return null;
  if (window._jsPDFClass) return window._jsPDFClass;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  // jsPDF UMD exposes window.jspdf.jsPDF (2.x) or window.jsPDF (1.x)
  window._jsPDFClass = window.jspdf?.jsPDF || window.jsPDF || null;
  if (!window._jsPDFClass) throw new Error('jsPDF failed to load.');
  return window._jsPDFClass;
}

// -- PDF generator - builds a formatted investor memo -------------------------
export async function generateDealMemo(data) {
  const jsPDF = await loadJsPDF();
  if (!jsPDF) throw new Error('Could not load PDF library.');

  const doc   = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const W     = 612, H = 792;
  const PAD   = 48;
  const GREEN = [22, 102, 56];
  const DARK  = [13, 15, 15];
  const MUTED = [114, 114, 122];
  const SOFT  = [234, 234, 239];
  const WHITE = [255, 255, 255];
  const RED   = [166, 38, 38];
  const AMBER = [138, 88, 0];

  const s   = data._settings || {};
  const verdict = data.verdict === 'YES' ? 'BUY' : data.verdict === 'NO' ? 'PASS' : 'CAUTION';
  const vColor  = data.verdict === 'YES' ? GREEN : data.verdict === 'NO' ? RED : AMBER;
  const score   = data.overallScore ?? 0;
  const addr    = data.address || 'Property Analysis';
  const addrShort = addr.split(',')[0];

  // -- Helper: hex color fill ---
  function setFill(rgb)   { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
  function setStroke(rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }
  function setTxt(rgb)    { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

  // -- PAGE 1: Cover ---------------------------------------------------------

  // Dark green background
  setFill(GREEN); doc.rect(0, 0, W, H, 'F');

  // Subtle lighter circle for depth
  setFill([28, 115, 65]);
  doc.circle(W/2, 260, 200, 'F');

  // Nav bar
  setFill([12, 45, 25]);
  doc.rect(0, 0, W, 52, 'F');
  // Logo dot + name
  setFill([96, 204, 141]);
  doc.circle(PAD + 5, 26, 5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  setTxt(WHITE);
  doc.text('RentalIQ', PAD + 16, 30.5);
  // Tagline right
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setTxt([150, 200, 170]);
  doc.text('Deal Memo', W - PAD, 30.5, { align: 'right' });

  // Score ring
  const cx = W / 2, cy = 230, r = 72;
  // Ring bg
  doc.setLineWidth(10);
  setStroke([12, 45, 25]);
  doc.circle(cx, cy, r);
  // Ring progress
  const pct   = score / 100;
  const steps = Math.max(1, Math.round(pct * 60));
  const start = -Math.PI / 2;
  doc.setLineWidth(10);
  setStroke([96, 204, 141]);
  for (let i = 0; i < steps; i++) {
    const a1 = start + (i / 60) * 2 * Math.PI;
    const a2 = start + ((i + 1) / 60) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    doc.line(x1, y1, x2, y2);
  }
  // Score number
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(44);
  setTxt(WHITE);
  doc.text(String(score), cx, cy + 14, { align: 'center' });
  doc.setFontSize(12);
  setTxt([150, 200, 170]);
  doc.text('/ 100', cx, cy + 32, { align: 'center' });

  // Verdict pill
  const pillW = 100, pillH = 28, pillX = cx - pillW/2, pillY = cy + 50;
  setFill(vColor);
  doc.roundedRect(pillX, pillY, pillW, pillH, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  setTxt(WHITE);
  doc.text(verdict, cx, pillY + 18.5, { align: 'center' });

  // Address
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  setTxt(WHITE);
  doc.text(addrShort, cx, cy + 108, { align: 'center', maxWidth: W - PAD * 2 });
  // Full address smaller
  const cityLine = addr.includes(',') ? addr.split(',').slice(1).join(',').trim() : '';
  if (cityLine) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    setTxt([150, 200, 170]);
    doc.text(cityLine, cx, cy + 127, { align: 'center', maxWidth: W - PAD * 2 });
  }

  // Verdict summary
  if (data.verdictSummary) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11.5);
    setTxt([180, 220, 195]);
    const lines = doc.splitTextToSize(data.verdictSummary, W - 120);
    doc.text(lines, cx, cy + 152, { align: 'center' });
  }

  // Bottom stat bar
  const barH = 90;
  setFill([12, 45, 25]);
  doc.rect(0, H - barH, W, barH, 'F');

  const cfMetric = (data.keyMetrics||[]).find(m=>m.label==='Monthly Cash Flow');
  const cocMetric= (data.keyMetrics||[]).find(m=>m.label==='Cash-on-Cash');
  const capMetric= (data.keyMetrics||[]).find(m=>m.label==='Cap Rate');

  const stats = [
    { label:'Price',     value: data.assumedPrice || '-' },
    { label:'Rent/mo',   value: data.assumedRent  || '-' },
    { label:'Cash Flow', value: cfMetric?.value   || '-' },
    { label:'CoC',       value: cocMetric?.value  || '-' },
    { label:'Cap Rate',  value: capMetric?.value  || '-' },
  ];

  const colW = W / stats.length;
  stats.forEach((st, i) => {
    const x = colW * i + colW / 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    setTxt([120, 170, 140]);
    doc.text(st.label, x, H - barH + 22, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    setTxt(WHITE);
    doc.text(st.value, x, H - barH + 42, { align: 'center' });
  });

  // Footer line
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  setTxt([80, 120, 96]);
  const ts = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  doc.text(`Generated ${ts} · rentaliq.app`, cx, H - 14, { align: 'center' });

  // -- PAGE 2: Full Analysis -------------------------------------------------
  doc.addPage();
  let y = PAD;

  // White page bg
  setFill(WHITE);
  doc.rect(0, 0, W, H, 'F');

  // Page header
  setFill(GREEN);
  doc.rect(0, 0, W, 48, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setTxt(WHITE);
  doc.text('RentalIQ', PAD, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setTxt([180, 220, 195]);
  doc.text('Full Analysis Report', W - PAD, 30, { align: 'right' });
  y = 68;

  // Verdict banner
  const bannerColor = data.verdict==='YES'?[236,246,241]:data.verdict==='NO'?[253,240,240]:[253,244,232];
  const bannerBorder= data.verdict==='YES'?[150,204,176]:data.verdict==='NO'?[224,170,170]:[223,192,112];
  setFill(bannerColor);
  setStroke(bannerBorder);
  doc.setLineWidth(1);
  doc.roundedRect(PAD, y, W - PAD*2, 54, 8, 8, 'FD');
  // Score
  setFill(vColor);
  doc.roundedRect(PAD + 12, y + 12, 44, 30, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  setTxt(WHITE);
  doc.text(String(score), PAD + 34, y + 31, { align: 'center' });
  // Verdict label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  setTxt(DARK);
  doc.text(verdict, PAD + 70, y + 24);
  // Summary
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  setTxt(MUTED);
  if (data.verdictSummary) {
    doc.text(doc.splitTextToSize(data.verdictSummary, W - PAD*2 - 80), PAD + 70, y + 38, { maxWidth: W - PAD*2 - 80 });
  }
  y += 68;

  // Section title helper
  function sectionTitle(label) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    setTxt(MUTED);
    doc.text(label.toUpperCase(), PAD, y);
    setFill(SOFT);
    doc.rect(PAD, y + 3, W - PAD*2, 1, 'F');
    y += 14;
  }

  // Key metrics grid (2 rows × 4 cols)
  sectionTitle('Key Metrics');
  const metrics = data.keyMetrics || [];
  const mCols = 4, mW = (W - PAD*2 - (mCols-1)*8) / mCols;
  const mRows = Math.ceil(metrics.length / mCols);
  for (let row = 0; row < mRows; row++) {
    let mh = 0;
    for (let col = 0; col < mCols; col++) {
      const idx = row * mCols + col;
      if (idx >= metrics.length) continue;
      const m   = metrics[idx];
      const mx  = PAD + col * (mW + 8);
      const my  = y;
      const mStatus = m.status;
      const mBg  = mStatus==='good'?[236,246,241]:mStatus==='bad'?[253,240,240]:[250,250,252];
      const mBdr = mStatus==='good'?[150,204,176]:mStatus==='bad'?[224,170,170]:[221,221,228];
      const mValC= mStatus==='good'?GREEN:mStatus==='bad'?RED:DARK;
      setFill(mBg);
      setStroke(mBdr);
      doc.setLineWidth(0.75);
      doc.roundedRect(mx, my, mW, 50, 5, 5, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      setTxt(MUTED);
      doc.text(m.label, mx + 8, my + 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14.5);
      setTxt(mValC);
      doc.text(m.value, mx + 8, my + 33);
      if (m.note) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        setTxt(MUTED);
        doc.text(m.note, mx + 8, my + 44, { maxWidth: mW - 16 });
      }
      mh = 50;
    }
    y += mh + 8;
  }
  y += 4;

  // Score breakdown + expense breakdown side by side
  sectionTitle('Score Breakdown');
  const scoreData = data.scoreBreakdown || [];
  const expData   = data.expenseBreakdown || [];
  const leftW = (W - PAD*2 - 16) * 0.52;
  const rightW= (W - PAD*2 - 16) * 0.48;

  // Score bars (left col)
  const barStartX = PAD;
  let ly = y;
  scoreData.forEach(item => {
    const sc = item.score ?? 0;
    const barColor = sc >= 70 ? GREEN : sc >= 40 ? AMBER : RED;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setTxt(DARK);
    doc.text(item.name, barStartX, ly + 10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    setTxt(barColor);
    doc.text(String(sc), barStartX + leftW - 20, ly + 10, { align: 'right' });
    // Track bg
    setFill(SOFT);
    doc.roundedRect(barStartX, ly + 13, leftW - 24, 6, 3, 3, 'F');
    // Track fill
    setFill(barColor);
    if (sc > 0) doc.roundedRect(barStartX, ly + 13, (leftW - 24) * (sc/100), 6, 3, 3, 'F');
    ly += 26;
  });

  // Expense table (right col)
  const rx = PAD + leftW + 16;
  let ry = y;
  expData.forEach((exp, i) => {
    const isTotal = exp.label === 'Total Expenses';
    const rowBg   = isTotal ? SOFT : (i%2===0 ? WHITE : [248,248,251]);
    setFill(rowBg);
    doc.rect(rx, ry, rightW, 15, 'F');
    doc.setFont(isTotal ? 'helvetica' : 'helvetica', isTotal ? 'bold' : 'normal');
    doc.setFontSize(isTotal ? 9 : 8.5);
    setTxt(isTotal ? DARK : MUTED);
    doc.text(exp.label, rx + 6, ry + 10);
    doc.setFont('helvetica', isTotal ? 'bold' : 'normal');
    doc.setFontSize(isTotal ? 9 : 8.5);
    setTxt(isTotal ? RED : DARK);
    doc.text(exp.monthly, rx + rightW - 6, ry + 10, { align: 'right' });
    ry += 15;
  });

  y = Math.max(ly, ry) + 12;

  // Projection
  if (data.projection && y < H - 200) {
    const pdfHoldYrs = data._settings?.holdingYears || 5;
    sectionTitle(`${pdfHoldYrs}-Year Wealth Projection`);
    const proj = data.projection;
    const projStats = [
      { label: 'Appreciation',  value: proj[`appreciation${pdfHoldYrs}yr`] || proj.appreciation5yr },
      { label: 'Loan Paydown',  value: proj[`loanPaydown${pdfHoldYrs}yr`]  || proj.loanPaydown5yr },
      { label: 'Cash Flow',     value: proj[`cashflow${pdfHoldYrs}yr`]     || proj.cashflow5yr },
      { label: 'Total Return',  value: proj[`totalReturn${pdfHoldYrs}yr`]  || proj.totalReturn5yr },
      { label: 'Base IRR',      value: proj.annualizedReturnPct },
      { label: '+Rent Growth',  value: proj.rentGrowthIRR ? `${proj.rentGrowthIRR} (${data._settings?.rentGrowthRate ?? 2.5}%/yr)` : null },
      { label: 'Cash Invested', value: proj.cashInvested },
    ].filter(p => p.value && p.value !== 'N/A');

    const pCols = Math.min(projStats.length, 3);
    const pW    = (W - PAD*2 - (pCols-1)*8) / pCols;
    projStats.forEach((p, i) => {
      const col = i % pCols;
      const row = Math.floor(i / pCols);
      const px  = PAD + col * (pW + 8);
      const py  = y + row * 46;
      setFill([248, 252, 250]);
      setStroke(SOFT);
      doc.setLineWidth(0.75);
      doc.roundedRect(px, py, pW, 38, 5, 5, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      setTxt(MUTED);
      doc.text(p.label, px + 8, py + 12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      setTxt(GREEN);
      doc.text(p.value, px + 8, py + 29);
    });
    y += Math.ceil(projStats.length / pCols) * 46 + 10;
  }

  // Pros / Cons
  if ((data.pros?.length || data.cons?.length) && y < H - 160) {
    sectionTitle('Strengths & Risks');
    const halfW = (W - PAD*2 - 12) / 2;
    const proX  = PAD, conX = PAD + halfW + 12;
    let proY = y, conY = y;

    (data.pros || []).slice(0, 4).forEach(p => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      setTxt(GREEN);
      doc.text('✓', proX, proY + 9);
      setTxt(DARK);
      const lines = doc.splitTextToSize(p, halfW - 14);
      doc.text(lines, proX + 12, proY + 9);
      proY += lines.length * 11 + 4;
    });
    (data.cons || []).slice(0, 3).forEach(c => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      setTxt(RED);
      doc.text('✗', conX, conY + 9);
      setTxt(DARK);
      const lines = doc.splitTextToSize(c, halfW - 14);
      doc.text(lines, conX + 12, conY + 9);
      conY += lines.length * 11 + 4;
    });
    y = Math.max(proY, conY) + 10;
  }

  // AI Narrative - add a new page if needed so the full analysis is never silently cut
  if (data.narrative) {
    if (y > H - 120) { doc.addPage(); y = PAD; }
    sectionTitle('Investment Analysis');
    setFill([248, 252, 250]);
    setStroke([200, 228, 210]);
    doc.setLineWidth(1);
    const narLines = doc.splitTextToSize(data.narrative, W - PAD*2 - 24);
    const lineH = 13;
    const boxPad = 14;
    let remainingLines = narLines;
    let isFirstBox = true;
    while (remainingLines.length > 0) {
      const availH = (H - 48) - y;
      const fitsCount = Math.max(1, Math.floor((availH - boxPad * 2) / lineH));
      const chunk = remainingLines.slice(0, fitsCount);
      remainingLines = remainingLines.slice(fitsCount);
      const boxH = chunk.length * lineH + boxPad * 2;
      doc.roundedRect(PAD, y, W - PAD*2, boxH, 6, 6, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      setTxt(DARK);
      doc.text(chunk, PAD + 12, y + boxPad);
      y += boxH + 8;
      if (remainingLines.length > 0) {
        doc.addPage();
        y = PAD;
        // Continuation header
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        setTxt(MUTED);
        doc.text('Investment Analysis (continued)', PAD, y);
        y += 16;
        setFill([248, 252, 250]);
        setStroke([200, 228, 210]);
      }
    }
  }

  // Settings footer
  const settingsLine = [
    s.mode ? `Mode: ${s.mode}` : '',
    s.cashPurchase ? 'All-cash' : (s.downPaymentPct ? `${s.downPaymentPct}% down` : ''),
    s.interestRate && !s.cashPurchase ? `${s.interestRate}%` : '',
    s.investorGoal ? `Goal: ${s.investorGoal}` : '',
  ].filter(Boolean).join(' · ');

  if (settingsLine) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    setTxt(MUTED);
    doc.text(settingsLine, PAD, H - 28);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setTxt(MUTED);
  doc.text('rentaliq.app', W - PAD, H - 28, { align: 'right' });
  setFill(SOFT);
  doc.rect(PAD, H - 38, W - PAD*2, 1, 'F');

  // Filename: use address if available, fall back to price so file is never "RentalIQ_.pdf"
  const slugBase = addrShort !== 'Property Analysis'
    ? addrShort
    : (data.assumedPrice ? `Property_${data.assumedPrice.replace(/[^0-9]/g,'')}` : 'Analysis');
  const slug = slugBase.replace(/[^a-z0-9]/gi,'_').replace(/__+/g,'_').replace(/^_|_$/g,'').slice(0, 40) || 'Analysis';
  doc.save(`RentalIQ_${slug}.pdf`);
}
