"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, Dataset, emptyFilters, FilterState, toApiFilter } from "./api";

type Ctx = {
  datasets: Dataset[];
  active: Dataset | null;
  setActiveId: (id: string) => void;
  refresh: (selectId?: string) => Promise<void>;
  loading: boolean;
  backendOk: boolean | null;
  draft: FilterState;
  setDraft: (f: FilterState) => void;
  applied: FilterState;
  apply: () => void;
  clear: () => void;
  applyFilters: (f: FilterState) => void;
  apiFilter: any;
  busy: number;
  track: <T>(p: Promise<T>) => Promise<T>;
  toast: (msg: string, err?: boolean) => void;
  toastMsg: { msg: string; err: boolean } | null;
  filteredCount: number | null;
  setFilteredCount: (n: number | null) => void;
};

const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [active, setActive] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<FilterState>(emptyFilters);
  const [applied, setApplied] = useState<FilterState>(emptyFilters);
  const [busy, setBusy] = useState(0);
  const [toastMsg, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  const [filteredCount, setFilteredCount] = useState<number | null>(null);
  const timer = useRef<any>(null);

  const toast = useCallback((msg: string, err = false) => {
    setToast({ msg, err });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), err ? 7000 : 3500);
  }, []);

  const track = useCallback(async <T,>(p: Promise<T>) => {
    setBusy((b) => b + 1);
    try { return await p; } finally { setBusy((b) => b - 1); }
  }, []);

  const loadFilters = (id: string) => {
    try {
      const raw = localStorage.getItem("nexus.filters." + id);
      const f = raw ? (JSON.parse(raw) as FilterState) : emptyFilters;
      setDraft(f); setApplied(f);
    } catch { setDraft(emptyFilters); setApplied(emptyFilters); }
  };

  const refresh = useCallback(async (selectId?: string) => {
    try {
      const list = await api<Dataset[]>("/api/datasets");
      setBackendOk(true);
      setDatasets(list);
      const stored = selectId || localStorage.getItem("nexus.active") || "";
      const id = list.find((d) => d.id === stored)?.id || list[0]?.id;
      if (id) {
        const full = await api<Dataset>("/api/datasets/" + id);
        setActive(full);
        localStorage.setItem("nexus.active", id);
        if (selectId || !active || active.id !== id) loadFilters(id);
      } else setActive(null);
    } catch {
      setBackendOk(false);
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const setActiveId = (id: string) => { refresh(id); };
  const persist = (f: FilterState) => { if (active) localStorage.setItem("nexus.filters." + active.id, JSON.stringify(f)); };
  const apply = () => { setApplied(draft); persist(draft); };
  const clear = () => { setDraft(emptyFilters); setApplied(emptyFilters); persist(emptyFilters); };
  const applyFilters = (f: FilterState) => { setDraft(f); setApplied(f); persist(f); };
  const apiFilter = useMemo(() => toApiFilter(applied), [applied]);

  return (
    <C.Provider value={{ datasets, active, setActiveId, refresh, loading, backendOk, draft, setDraft, applied, apply, clear, applyFilters, apiFilter, busy, track, toast, toastMsg, filteredCount, setFilteredCount }}>
      {children}
    </C.Provider>
  );
}
