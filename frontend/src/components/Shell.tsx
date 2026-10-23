"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Bell, BookOpen, Brain, ChevronsLeft, ChevronsRight, Database, FileText, Home, LayoutDashboard, Settings, ShieldAlert, Table2 } from "lucide-react";
import { useApp } from "@/lib/state";
import { fmtDate } from "@/lib/format";

type NavItem = { href: string; label: string; icon: any; tag?: string };

const NAV: NavItem[] = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/datasets", label: "Bases de datos", icon: Database },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cross", label: "Análisis cruzado", icon: BarChart3, tag: "Nuevo" },
  { href: "/explorer", label: "Explorador", icon: Table2 },
  { href: "/risks", label: "Análisis de riesgos", icon: ShieldAlert },
  { href: "/ai", label: "NEXUS AI", icon: Brain },
  { href: "/reports", label: "Report Studio", icon: FileText },
  { href: "/manual", label: "Manual de usuario", icon: BookOpen },
  { href: "/settings", label: "Configuración", icon: Settings },
];



export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { datasets, active, setActiveId, busy, backendOk, toastMsg } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(localStorage.getItem("nexus.collapsed") === "1"); }, []);
  const toggle = () => { setCollapsed(!collapsed); localStorage.setItem("nexus.collapsed", collapsed ? "0" : "1"); };

  return (
    <div className={"shell" + (collapsed ? " collapsed" : "")}>
      <aside className="sidebar" aria-label="Navegación principal">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div className="brand-text">
            <div className="brand-name">NEXUS</div>
            <div className="brand-sub">INTELLIGENCE</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => {
            const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} className={on ? "active" : ""} title={n.label} aria-current={on ? "page" : undefined} id={"nav-" + (n.href.slice(1) || "home")}>
                <Icon size={18} />
                <span className="label">{n.label}</span>
                {n.tag && <span className="tag">{n.tag}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="side-foot">
          <button onClick={toggle} id="sidebar-toggle" aria-label={collapsed ? "Expandir menú" : "Contraer menú"}>
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            <span className="label">Contraer menú</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="ds">
            <b>{active ? active.name : "Sin conjunto de datos activo"}</b>
            <span>
              {active
                ? `Periodo: ${active.periods?.join(", ") || "—"} · Corte: ${active.cutoff || "—"} · Actualizado: ${fmtDate(active.updated_at)}`
                : "Importe un archivo para comenzar"}
            </span>
          </div>
          {datasets.length > 1 && (
            <select className="select hide-sm" value={active?.id} onChange={(e) => setActiveId(e.target.value)} aria-label="Cambiar conjunto de datos" id="dataset-switcher">
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <div className="spacer" />
          <span className="status-pill" id="load-status" role="status">
            <span className={"dot " + (backendOk === false ? "err" : busy > 0 ? "busy" : "ok")} />
            {backendOk === false ? "Backend desconectado" : busy > 0 ? "Procesando…" : "Listo"}
          </span>
          <button className="btn icon ghost" aria-label="Notificaciones" title="Sin notificaciones nuevas"><Bell size={17} /></button>
          <div className="avatar" title="Usuario local (autenticación pendiente)">UL</div>
        </header>
        <main className="content">{children}</main>
      </div>
      {toastMsg && <div className={"toast" + (toastMsg.err ? " err" : "")} role="alert">{toastMsg.msg}</div>}
    </div>
  );
}
