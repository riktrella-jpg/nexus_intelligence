import React, { useState } from 'react';

/** Nexus / OIC: revisión dual · archivos originales preservados.
 * apiBase opcional: proxy del frontend o backend en dominio distinto.
 */
export default function SuministroRevision({apiBase=''}) {
  const [file,setFile]=useState(null);
  const [modo,setModo]=useState('ambos');
  const [fecha,setFecha]=useState('2026-10-31');
  const [hoja,setHoja]=useState('');
  const [dias,setDias]=useState(15);
  const [extras,setExtras]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [summary,setSummary]=useState(null);
  const css={root:{fontFamily:'Inter,Arial,sans-serif',color:'#1b334f'},panel:{padding:24,
     background:'#fff',border:'1px solid #dce3ed',borderRadius:12,boxShadow:'0 3px 14px #14243b09'},
    label:{fontWeight:650,fontSize:13,display:'block'},input:{display:'block',width:'100%',
     boxSizing:'border-box',marginTop:8,padding:'11px 12px',background:'#fbfcfe',border:'1px solid #bccad8',borderRadius:7},
    btn:{border:0,padding:'13px 22px',fontWeight:750,color:'#fff',borderRadius:9,
     background:'linear-gradient(120deg,#233b60,#6d2e4a)',cursor:'pointer'},
    metric:{border:'1px solid #dfe4ed',borderRadius:9,padding:13,minWidth:140,flex:'1 0 140px'}};
  const n=(header)=>Number(summary?.headers?.[header]||0);
  async function submit(e) {
    e.preventDefault();if(!file || busy)return;
    setBusy(true);setError('');setSummary(null);
    try {
      const f=new FormData();f.append('archivo',file);f.append('modo',modo);
      f.append('fecha_corte',fecha);f.append('hoja',hoja);
      f.append('dias_pendiente',String(dias));f.append('validaciones_adicionales',String(extras));
      const r=await fetch(`${apiBase}/api/oic/suministro/revisar`,{method:'POST',body:f});
      if(!r.ok){let msg=`Error HTTP ${r.status}`;try{const j=await r.json();msg=j.detail||msg;}catch{}throw Error(msg);}
      const blob=await r.blob(),link=document.createElement('a'),url=URL.createObjectURL(blob);
      link.href=url;link.download=`NEXUS_OIC_SUMINISTRO_${modo}_${fecha}.xlsx`;
      document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),12000);
      const keys=['X-OIC-Registros','X-OIC-Medicamentos','X-OIC-Material','X-OIC-Hallazgos',
        'X-OIC-Errores','X-OIC-Revisar','X-OIC-Informativos','X-OIC-OK'];
      setSummary({headers:Object.fromEntries(keys.map(k=>[k,r.headers.get(k)||'0']))});
    } catch(e){setError(e.message||'No fue posible procesar el Excel.');}
    finally {setBusy(false);}
  }
  return <section style={css.root}>
    <header style={{...css.panel,color:'#fff',background:'linear-gradient(110deg,#173450,#63293f)',marginBottom:17}}>
      <div style={{fontSize:12,fontWeight:800,letterSpacing:1.3,color:'#dabb7e'}}>CONTROL DE CALIDAD OIC · SUMINISTRO</div>
      <h2 style={{margin:'9px 0'}}>Revisión de Medicamentos y Material de Curación</h2>
      <p style={{opacity:.86,margin:0,fontSize:14}}>17 reglas AE–AU por registro · Controles adicionales · Señalamiento amarillo de celdas afectadas · Libro original intacto.</p>
    </header>
    <form style={css.panel} onSubmit={submit}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:16}}>
        <label style={css.label}>Layout institucional (.xlsx)
          <input style={css.input} required type="file" accept=".xlsx" onChange={e=>setFile(e.target.files?.[0]||null)}/>
        </label>
        <label style={css.label}>Tipo de revisión
          <select style={css.input} value={modo} onChange={e=>setModo(e.target.value)}>
            <option value="ambos">Medicamentos + Material de Curación</option>
            <option value="medicamentos">Solo Medicamentos</option>
            <option value="material_curacion">Solo Material de Curación</option>
          </select>
        </label>
        <label style={css.label}>Fecha de corte
          <input style={css.input} type="date" required value={fecha} onChange={e=>setFecha(e.target.value)}/>
        </label>
        <label style={css.label}>Hoja (opcional)
          <input style={css.input} value={hoja} placeholder="Automático: base" onChange={e=>setHoja(e.target.value)}/>
        </label>
        <label style={css.label}>Plazo de alerta (días)
          <input style={css.input} type="number" min={0} max={3650} value={dias} onChange={e=>setDias(e.target.value)}/>
        </label>
      </div>
      <label style={{fontSize:13,margin:'17px 0',display:'flex',gap:10,alignItems:'center'}}>
        <input type="checkbox" checked={extras} onChange={e=>setExtras(e.target.checked)}/>
        Incluir controles complementarios (cantidades, importes, proveedores, secuencia y tipo de suministro)
      </label>
      <button style={{...css.btn,opacity:busy?.6:1}} type="submit" disabled={busy||!file}>
        {busy?'Analizando registros y preparando Excel…':'Revisar layout y descargar Excel'}
      </button>
      {error&&<p role="alert" style={{color:'#a5233b',fontWeight:700}}>{error}</p>}
    </form>
    {summary&&<div style={{...css.panel,marginTop:18}}>
      <h3 style={{margin:'0 0 14px'}}>Resultado de la revisión</h3>
      <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
        {[
          ['Registros','X-OIC-Registros'],['Medicamentos','X-OIC-Medicamentos'],
          ['Material de Curación','X-OIC-Material'],['Hallazgos','X-OIC-Hallazgos'],
          ['Filas ERROR','X-OIC-Errores'],['Filas REVISAR','X-OIC-Revisar'],
          ['INFORMATIVO','X-OIC-Informativos'],['OK','X-OIC-OK']
        ].map(([title,k])=><div key={k} style={css.metric}>
          <strong style={{fontSize:22}}>{n(k).toLocaleString('es-MX')}</strong>
          <div style={{fontSize:12,color:'#5f7287'}}>{title}</div>
        </div>)}
      </div>
      <p style={{fontSize:13,color:'#53657a'}}>El Excel descargado incluye REVISION OIC, OBSERVACIONES OIC y RESUMEN OIC, además de la hoja institucional sin cambios. Una fila puede tener varios hallazgos.</p>
    </div>}
  </section>;
}
