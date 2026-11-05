import React, { useState } from 'react';

/** Componente React reutilizable. El backend tiene que servir /api/oic/...
 *  Si el frontend y backend usan distintos hosts, configurar proxy/rewrite en NEXUS.
 *  No pone datos de los contratos en servicios externos.
 */
type Hallazgo = {
  fila: number; celda: string; contrato: string; categoria: string;
  regla: string; campo: string; detalle: string; accion: string;
  celdas_relacionadas: string[];
};
type Resultado = {
  archivo: string; hoja: string; registros: number; inconsistencias: number;
  filas_observadas: number; por_gravedad: Record<string, number>;
  por_regla: Record<string, number>; hallazgos_muestra: Hallazgo[];
};
type Preview = { fecha_corte: string; archivos: Resultado[]; errores: {archivo:string;error:string}[] };

const brand = '#682138';
const navy = '#193B59';
const gold = '#C5AA72';

function getErrorMessage(data: any): string {
  const d = data?.detail ?? data;
  return typeof d === 'string' ? d : (d?.mensaje || JSON.stringify(d) || 'No fue posible analizar.');
}

export default function ModuloRescisionesOIC({ apiBase = '' }: {apiBase?: string}) {
  const [files, setFiles] = useState<File[]>([]);
  const [cutoff, setCutoff] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const endpoint = (suffix: string) => `${apiBase}/api/oic/rescisiones/${suffix}`;
  const formData = () => {
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    form.append('fecha_corte', cutoff);
    return form;
  };

  async function analyze() {
    if (!files.length || !cutoff) return;
    setBusy(true); setError(''); setPreview(null);
    try {
      const response = await fetch(endpoint('previsualizar'), {method:'POST', body:formData()});
      const data = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(data));
      setPreview(data as Preview);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function exportExcel() {
    if (!files.length || !cutoff) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint('exportar'), {method:'POST', body:formData()});
      if (!response.ok) throw new Error(getErrorMessage(await response.json()));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = files.length === 1 ? 'Layout_REVISION_OIC.xlsx' : 'Devoluciones_OIC_NEXUS.zip';
      document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  const button: React.CSSProperties = { border:'none', background:brand, color:'#fff',
    borderRadius:7, cursor:busy?'wait':'pointer', padding:'12px 22px', fontWeight:700 };
  const card: React.CSSProperties = { background:'#fff', border:'1px solid #DEE4EB',
    borderRadius:12, padding:20, marginBottom:18 };

  return <section style={{fontFamily:'Segoe UI,Arial,sans-serif',color:navy,maxWidth:1250,margin:'0 auto'}}>
    <header style={{background:brand,color:'white',borderRadius:12,padding:'22px 26px',marginBottom:18}}>
      <h2 style={{fontSize:23,margin:'0 0 6px'}}>REVISIÓN OIC · RESCISIONES</h2>
      <div style={{fontSize:13,opacity:.88}}>NEXUS Intelligence · Validación por diccionario, fechas, cantidades y montos</div>
    </header>
    <div style={card}>
      <h3 style={{marginTop:0}}>1 · Seleccionar layouts institucionales</h3>
      <p style={{color:'#667587',fontSize:14}}>Carga uno o varios archivos XLSX. Cada uno se procesa por separado sin modificar sus hojas originales.</p>
      <input type="file" multiple accept=".xlsx" onChange={e=>{
        setFiles(Array.from(e.target.files || []));setPreview(null);setError('');
      }} style={{display:'block',width:'100%',marginBottom:16}} />
      <label style={{fontWeight:700,display:'block',marginBottom:5}}>Fecha de corte</label>
      <input type="date" required value={cutoff} onChange={e=>setCutoff(e.target.value)}
        style={{padding:10,border:'1px solid #B5C0CB',borderRadius:5,marginBottom:18}}/>
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        <button disabled={busy || !files.length || !cutoff} style={{...button, opacity:(busy || !files.length || !cutoff) ? 0.6 : 1}}
          onClick={analyze}>{busy?'Procesando…':'ANALIZAR Y PREVISUALIZAR'}</button>
        <button disabled={busy || !files.length || !cutoff} style={{...button,background:navy, opacity:(busy || !files.length || !cutoff) ? 0.6 : 1}}
          onClick={exportExcel}>EXPORTAR EXCEL OBSERVADO</button>
      </div>
      {error && <p role="alert" style={{color:'#9B1C30',fontSize:13}}>{error}</p>}
    </div>
    {preview && <div style={card}>
      <h3 style={{marginTop:0}}>2 · Resultado de las validaciones</h3>
      {preview.archivos.map((r,index)=><div key={index} style={{borderTop:`2px solid ${gold}`,paddingTop:14,marginBottom:22}}>
        <b>{r.archivo}</b>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',margin:'14px 0'}}>
          {[['Registros',r.registros],['Filas observadas',r.filas_observadas],['Inconsistencias',r.inconsistencias]].map(([key,value])=><div key={String(key)}
            style={{background:'#EFF3F7',borderRadius:8,padding:13,minWidth:135}}>
            <small style={{display:'block',color:'#657486'}}>{key}</small><strong style={{fontSize:21}}>{value}</strong></div>)}
        </div>
        <div style={{maxHeight:330,overflow:'auto',border:'1px solid #DCE2E8',borderRadius:6}}>
          <table style={{borderCollapse:'collapse',width:'100%',fontSize:12,textAlign:'left'}}>
            <thead><tr style={{background:navy,color:'white'}}>{['Fila','Contrato','Regla','Campo','Observación'].map(x=><th key={x} style={{padding:9,position:'sticky',top:0,background:navy}}>{x}</th>)}</tr></thead>
            <tbody>{r.hallazgos_muestra.map((h,i)=><tr key={i} style={{borderBottom:'1px solid #E7EBEF'}}>
              <td style={{padding:8}}>{h.fila}</td><td style={{padding:8}}>{h.contrato}</td>
              <td style={{padding:8}}>{h.regla}</td><td style={{padding:8}}>{h.campo}</td>
              <td style={{padding:8}}>{h.detalle}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p style={{fontSize:12,color:'#687586'}}>Se muestra una muestra de hasta 60 hallazgos. El Excel incluye todas las observaciones y colorea de amarillo las celdas involucradas.</p>
      </div>)}
      {!!preview.errores?.length && <p role="alert" style={{color:'#9B1C30'}}>Archivos omitidos: {preview.errores.map(e=>`${e.archivo}: ${e.error}`).join('; ')}</p>}
    </div>}
  </section>;
}
