/* Match reusable visual operators. This never changes the expression AST. */
(function (root) {
  'use strict';
  // Rectangular minimum-cost assignment. Every row gets one distinct column.
  // O(n^3), bounded by the expression validator's 96-node limit.
  function assignment(cost) {
    const n=cost.length, m=cost[0].length;
    const u=Array(n+1).fill(0),v=Array(m+1).fill(0),p=Array(m+1).fill(0),way=Array(m+1).fill(0);
    for(let i=1;i<=n;i++) {
      p[0]=i;let j0=0;
      const min=Array(m+1).fill(Infinity),used=Array(m+1).fill(false);
      do {
        used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;
        for(let j=1;j<=m;j++) if(!used[j]) {
          const cur=cost[i0-1][j-1]-u[i0]-v[j];
          if(cur<min[j]){min[j]=cur;way[j]=j0;}
          if(min[j]<delta){delta=min[j];j1=j;}
        }
        for(let j=0;j<=m;j++) if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;
        j0=j1;
      } while(p[j0]!==0);
      do {const j1=way[j0];p[j0]=p[j1];j0=j1;} while(j0);
    }
    const result=Array(n);
    for(let j=1;j<=m;j++) if(p[j])result[p[j]-1]=j-1;
    return result;
  }
  function cost(a,b,distance) {
    const overlap=Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));
    const union=Math.max(a.end,b.end)-Math.min(a.start,b.start);
    return Math.hypot(a.x-b.x,a.y-b.y)/distance + .22*(1-overlap/union) +
      .12*Math.abs(Math.log2(a.scale/b.scale)) + (a.role===b.role ? 0 : .08) + (a.exiting ? .15 : 0);
  }
  // Result maps each destination index to a source index, or -1 for a new glyph.
  function match(previous,next,distance=1000) {
    const result=Array(next.length).fill(-1);
    for(const kind of new Set(next.map(x=>x.kind))) {
      const old=previous.map((x,i)=>({...x,index:i})).filter(x=>x.kind===kind);
      const fresh=next.map((x,i)=>({...x,index:i})).filter(x=>x.kind===kind);
      if(!old.length)continue;
      const reverse=old.length<fresh.length, rows=reverse?old:fresh, cols=reverse?fresh:old;
      const matches=assignment(rows.map(a=>cols.map(b=>reverse?cost(a,b,distance):cost(b,a,distance))));
      matches.forEach((col,row)=>{
        const a=rows[row],b=cols[col];
        result[reverse?b.index:a.index]=reverse?a.index:b.index;
      });
    }
    return result;
  }
  const api=Object.freeze({match});
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else root.FormulaSymbols=api;
})(typeof window==='undefined'?globalThis:window);
