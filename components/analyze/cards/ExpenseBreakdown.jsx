import { useState, useEffect } from 'react';
import { C, clamp, scoreColor } from '../tokens';
import { Label, Card, Pill, AnimatedBar } from '../InputComponents';

export function ExpenseBreakdown({data}) {
  const rows=data.expenseBreakdown||[];
  if (!rows.length) return null;
  const total=rows[rows.length-1];
  const items=rows.slice(0,-1);
  return (
    <Card>
      <Label>Monthly Expense Breakdown</Label>
      {items.map((row,i)=>(
        <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:`1px solid ${C.border}`}}>
          <span style={{fontSize:13.5,color:C.textSecondary}}>{row.label}</span>
          <span style={{fontSize:14,fontWeight:500,color:C.text,fontFamily:"'Instrument Serif',Georgia,serif"}}>{row.monthly}</span>
        </div>
      ))}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 0 4px'}}>
        <span style={{fontSize:14,fontWeight:700,color:C.text}}>Total Expenses</span>
        <span style={{fontSize:20,color:C.red,fontFamily:"'Instrument Serif',Georgia,serif"}}>{total.monthly}</span>
      </div>
      <div style={{fontSize:12,color:C.muted,marginTop:10}}>Income: {data.assumedRent} · Cash flow = Income − Expenses</div>
    </Card>
  );
}

