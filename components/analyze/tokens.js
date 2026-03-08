// Design tokens — single source of truth for all colors, shadows, and spacing
export const C = {
  bg:'#f5f5f8', white:'#ffffff', border:'#dddde4', text:'#0d0d0f', muted:'#72727a', soft:'#eaeaef',
  green:'#166638', greenBg:'#ecf6f1', greenBorder:'#96ccb0',
  red:'#a62626', redBg:'#fdf0f0', redBorder:'#e0aaaa',
  amber:'#8a5800', amberBg:'#fdf4e8', amberBorder:'#dfc070',
  blue:'#1649a0', blueBg:'#edf1fc', blueBorder:'#a0beed',
  shadow:'0 1px 2px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.06)',
  shadowSm:'0 1px 2px rgba(0,0,0,0.04)',
  shadowLg:'0 12px 48px rgba(0,0,0,0.11), 0 2px 8px rgba(0,0,0,0.05)',
  textSecondary:'#444444', textBody:'#555555',
};

export const VERDICT_CFG = {
  YES:   {color:C.green, label:'BUY',     sub:'Meets return thresholds. Worth pursuing.'},
  NO:    {color:C.red,   label:'PASS',    sub:'Does not meet return thresholds.'},
  MAYBE: {color:C.amber, label:'CAUTION', sub:'Marginal deal. Review assumptions carefully.'},
};

export const MODES = {
  conservative:{label:'Conservative',color:C.amber,desc:'Higher vacancy & reserves.'},
  moderate:    {label:'Moderate',    color:C.blue, desc:'Balanced assumptions.'},
  aggressive:  {label:'Aggressive',  color:C.green,desc:'Lower reserves.'},
};

export const MODE_DEFAULTS = {
  conservative:{vacancy:10,maintenance:1.5},
  moderate:    {vacancy:8, maintenance:1.0},
  aggressive:  {vacancy:5, maintenance:0.5},
};

export const LOADING_STEPS = [
  'Pulling HUD FMR + Census rent data for this market...',
  'Calculating mortgage, NOI, DSCR, and cash flow...',
  'Scoring location, market growth, and landlord laws...',
  'Computing IRR and wealth projection...',
];

export const EMPTY_FIELDS = {
  url:'', price:'', rent:'', beds:'', baths:'', sqft:'', year:'',
  city:'', taxAnnual:'', hoaMonthly:'', propertyType:'sfr',
  aduRent:'',           // ADU / guest house monthly rent (sfr_adu only)
  unitCount:'',         // number of units (duplex=2, triplex=3, fourplex=4)
  houseHack: false,     // owner occupies one unit
  unitRents: [],        // per-unit rents for mixed multifamily ['1200','950','1400','1100']
  listingDescription:'',// full listing description (scraped or user-pasted)
};

export const SAMPLE_DEAL = {
  url: '', price:'129000', rent:'1350', beds:'3', baths:'1',
  sqft:'1240', year:'1962', city:'Cleveland, OH',
  taxAnnual:'2100', hoaMonthly:'0', propertyType:'sfr',
};

export const EMPTY_ADV = {
  selfManage:false, vacancyOverride:'', capexOverride:'', maintenanceOverride:'',
  appreciationOverride:'', mgmtRateOverride:'', closingCostPct:'', rentGrowthOverride:'',
};

export const EMPTY_PROFILE = {
  cashPurchase:false, downPaymentPct:'20', interestRate:'6.87',
  loanType:'30yr_fixed', holdingYears:'5', goal:'balanced',
};

export const LOAN_TYPES = [
  {key:'30yr_fixed',    label:'30yr Fixed', years:30},
  {key:'15yr_fixed',    label:'15yr Fixed', years:15},
  {key:'5_1_arm',       label:'5/1 ARM',    years:30},
  {key:'interest_only', label:'Int-Only',   years:30},
];

export const PROPERTY_TYPES = [
  { key:'sfr',      label:'SFR',      desc:'Single-family'  },
  { key:'sfr_adu',  label:'SFR+ADU',  desc:'+ guest house'  },
  { key:'duplex',   label:'Duplex',   desc:'2 units'        },
  { key:'triplex',  label:'Triplex',  desc:'3 units'        },
  { key:'fourplex', label:'Fourplex', desc:'4 units'        },
  { key:'condo',    label:'Condo',    desc:'HOA common'     },
];

// How many rentable units each type has (excluding owner unit in house hack)
export const UNIT_COUNT = {
  sfr: 1, sfr_adu: 2, duplex: 2, triplex: 3, fourplex: 4, condo: 1,
};

// Whether a property type supports house-hacking
export const SUPPORTS_HOUSEHACK = new Set(['sfr_adu','duplex','triplex','fourplex']);

export const HOLDING_YEARS_OPTIONS = [3, 5, 7, 10, 20];

export const GOAL_WEIGHTS = {
  cashflow:    {cashflow:0.40,location:0.20,onePercent:0.20,market:0.10,landlord:0.10},
  appreciation:{cashflow:0.10,location:0.30,onePercent:0.05,market:0.40,landlord:0.15},
  balanced:    {cashflow:0.25,location:0.25,onePercent:0.15,market:0.25,landlord:0.10},
  tax:         {cashflow:0.20,location:0.25,onePercent:0.10,market:0.30,landlord:0.15},
};

// Shared style object for all text inputs — avoids repeating 8 properties per field
export const inputBase = {
  background:C.white, border:`1.5px solid ${C.border}`, borderRadius:10,
  padding:'11px 14px', fontSize:14, fontFamily:"'DM Sans',system-ui,sans-serif",
  color:C.text, outline:'none', width:'100%',
  transition:'border-color 0.2s, background 0.2s', WebkitAppearance:'none',
};

// Utility: clamp a value between lo and hi
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Utility: map a 0-100 score to a semantic color
export const scoreColor = v => v >= 68 ? C.green : v >= 45 ? C.amber : C.red;
