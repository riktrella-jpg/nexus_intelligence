"""Dashboard Nexus v2: streamlit run dashboard_v2.py"""
import sqlite3,csv,io
from pathlib import Path
from decimal import Decimal
import streamlit as st
DB=Path(__file__).parent/'resultados_v2'/'nexus_v2.sqlite'
st.set_page_config(page_title='Nexus | Motor inferido v2',layout='wide')
st.title('Nexus Intelligence · Monto contratado inferido')
st.caption('Reglas: contrato + clave + monto + cantidad + precio. No se suman filas equivalentes. Estimación basada solo en columnas.')
if not DB.exists():st.error('Ejecuta motor_nexus_v2.py para generar la base.');st.stop()
with sqlite3.connect(DB) as c:
 instituciones=[r[0] for r in c.execute('SELECT DISTINCT institucion FROM contratos ORDER BY institucion')]
 sel=st.selectbox('Institución',['Todas']+instituciones)
 criterio=st.selectbox('Estado',['Todos','INFERIDO_COMPLETO','PARCIAL_CON_PENDIENTES','PENDIENTE_TOTAL'])
 where=[];args=[]
 if sel!='Todas':where.append('institucion=?');args.append(sel)
 if criterio!='Todos':where.append('estado=?');args.append(criterio)
 query='SELECT institucion, contrato, proveedor, filas, partidas, monto_inferido, monto_revision, pendientes, estado, razon FROM contratos'
 if where:query+=' WHERE '+' AND '.join(where)
 data=c.execute(query,args).fetchall()
 total=sum((Decimal(x[5]) for x in data if x[5]),Decimal('0'))
 completos=sum(x[8]=='INFERIDO_COMPLETO' for x in data)
 a,b,d=st.columns(3);a.metric('Contratos agrupados',len(data));b.metric('Completamente inferidos',completos);d.metric('Con pendientes',len(data)-completos)
 st.metric('Importe conciliado de partidas (no total contractual certificado)',f'${total:,.2f}')
 st.warning('Los contratos PARCIALES muestran solo su componente inferido; no deben interpretarse como el importe total del contrato. Los importes en revisión pueden incluir duplicados.')
 headers=['Institución','Contrato','Proveedor','Filas','Candidatos de partida','Importe conciliado','Monto pendiente referencial','Pendientes','Estado','Observación']
 st.dataframe([dict(zip(headers,row)) for row in data],use_container_width=True,hide_index=True)
 buffer=io.StringIO();w=csv.writer(buffer);w.writerow(headers);w.writerows(data)
 st.download_button('Exportar resultados filtrados',buffer.getvalue().encode('utf-8-sig'),file_name='reporte_nexus_v2.csv',mime='text/csv')
