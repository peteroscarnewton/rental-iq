// Client-side market data baseline — cold-start fallback only.
//
// This object is used before /api/market-data responds. Once the API
// responds, setMarketData() in marketHelpers.js replaces it entirely.
//
// Keep in sync with:
//   lib/marketData.js → BASELINE.stateTaxRates  (same Tax Foundation 2024 source)
//   lib/insuranceRateFetcher.js → INS_RATE_BASELINE (same NAIC 2022 + DOI source)

export const MD_BASELINE = {
  // State effective property tax rates — Tax Foundation 2024 + Lincoln Institute
  stateTaxRates: {
    AL:0.41,AK:1.04,AZ:0.63,AR:0.64,CA:0.75,CO:0.51,CT:1.79,DE:0.57,FL:0.91,GA:0.91,
    HI:0.30,ID:0.47,IL:2.08,IN:0.85,IA:1.57,KS:1.41,KY:0.86,LA:0.56,ME:1.09,MD:1.09,
    MA:1.17,MI:1.32,MN:1.12,MS:0.78,MO:1.01,MT:0.74,NE:1.73,NV:0.55,NH:1.89,NJ:2.23,
    NM:0.80,NY:1.73,NC:0.82,ND:0.98,OH:1.56,OK:0.90,OR:0.97,PA:1.49,RI:1.53,SC:0.57,
    SD:1.14,TN:0.67,TX:1.63,UT:0.58,VT:1.83,VA:0.82,WA:0.98,WV:0.59,WI:1.61,WY:0.61,DC:0.55,
  },

  // State homeowner insurance rates — NAIC 2022 + DOI rate actions through 2025
  stateInsRates: {
    FL:3.50,LA:3.20,OK:1.85,TX:2.20,KS:1.65,MS:1.60,AL:1.50,AR:1.30,SC:1.25,NC:1.15,
    GA:1.10,CO:1.15,TN:1.00,MO:1.20,NE:1.25,MN:0.90,IA:1.00,SD:1.00,ND:0.95,
    OH:0.80,IN:0.85,MI:0.90,WI:0.80,IL:0.85,KY:0.85,WV:0.75,VA:0.80,MD:0.80,DE:0.75,
    PA:0.78,NJ:0.95,NY:0.90,CT:0.85,RI:0.85,MA:0.80,VT:0.72,NH:0.78,ME:0.78,
    AZ:0.78,NV:0.68,UT:0.70,ID:0.65,MT:0.68,WY:0.68,NM:0.78,
    CA:0.85,OR:0.70,WA:0.68,AK:0.75,HI:0.38,DC:0.78,
  },

  stateAppreciation: {
    FL:4.5,TX:4.2,CA:3.8,AZ:3.8,CO:3.5,WA:4.5,OR:3.2,ID:3.2,NV:4.0,NC:4.5,GA:4.5,
    TN:4.0,SC:4.2,VA:3.8,MD:3.8,MA:4.5,NY:3.5,NJ:3.8,IL:2.5,OH:3.2,MI:3.5,PA:3.0,
    IN:3.2,MO:3.0,WI:3.5,MN:3.8,IA:2.8,KS:2.5,NE:3.0,SD:3.2,ND:2.8,MT:3.8,WY:3.0,
    UT:3.8,NM:3.5,AK:2.0,HI:4.2,KY:2.8,WV:2.0,AR:3.0,AL:3.0,MS:2.5,LA:2.2,OK:2.8,
  },

  cityAppreciation: {
    'san francisco':4.2,'san jose':4.5,'oakland':3.8,'los angeles':4.5,'san diego':4.8,
    'sacramento':3.5,'fresno':3.2,'bakersfield':3.0,'austin':3.2,'dallas':4.5,
    'houston':4.0,'san antonio':4.0,'fort worth':4.5,'el paso':3.5,'miami':5.0,
    'tampa':3.5,'orlando':4.0,'jacksonville':4.2,'fort lauderdale':5.0,'seattle':4.8,
    'bellevue':5.0,'portland':3.2,'spokane':3.5,'denver':3.5,'colorado springs':3.8,
    'boise':3.2,'salt lake city':3.8,'provo':3.5,'new york':4.0,'brooklyn':4.5,
    'manhattan':3.5,'boston':4.8,'providence':4.2,'philadelphia':3.5,'pittsburgh':2.8,
    'newark':3.8,'chicago':2.8,'minneapolis':3.8,'kansas city':3.2,'columbus':3.8,
    'indianapolis':3.0,'cincinnati':2.8,'cleveland':2.2,'detroit':2.5,'milwaukee':3.0,
    'st. louis':2.5,'memphis':2.2,'louisville':2.8,'atlanta':4.5,'charlotte':4.5,
    'nashville':4.0,'raleigh':4.5,'durham':4.2,'birmingham':2.8,'new orleans':2.5,
    'phoenix':4.0,'tucson':3.8,'las vegas':4.0,'albuquerque':3.5,'henderson':4.0,
    'washington':4.0,'baltimore':3.5,'richmond':3.8,'virginia beach':3.5,
  },

  mortgageRates:     { rate30yr: 6.87, rate15yr: 6.14, rate5arm: 6.25 },
  rentGrowthDefault: 3.2,
  capexPpiMultiplier:1.38,

  // Phase 5 baselines
  treasuryYield: { rate: 4.62, asOf: null, source: 'baseline' },
  sp500Returns:  { return10yr: 12.4, return5yr: 13.8, return3yr: 8.7, asOf: null, source: 'baseline' },
  pmiRates:      { ltv95_97: 0.95, ltv90_95: 0.68, ltv85_90: 0.45, ltv80_85: 0.24 },

  stateClosingCosts: {
    DC:4.5,NY:4.2,MD:3.8,PA:3.5,DE:3.4,NJ:3.2,CT:3.0,MA:2.8,WA:2.8,MN:2.7,
    IL:2.6,VT:2.5,NH:2.5,ME:2.4,RI:2.3,CA:2.4,NC:2.3,GA:2.2,SC:2.2,VA:2.2,
    TN:2.1,KY:2.1,OH:2.1,MI:2.0,WI:2.0,AR:2.0,NV:2.0,CO:1.9,IN:1.9,IA:1.9,
    NE:1.9,LA:1.9,MO:1.9,AL:1.8,MS:1.8,OK:1.8,KS:1.8,ID:1.8,UT:1.8,AZ:1.8,
    SD:1.7,ND:1.7,MT:1.8,WY:1.7,NM:1.9,HI:2.5,AK:1.7,WV:2.0,TX:1.8,FL:1.9,
    OR:2.3,_nationalAvg:2.1,
  },
};
