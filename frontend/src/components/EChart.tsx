"use client";
import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import * as echarts from "echarts";

export type EChartHandle = { png: () => string | undefined };

const EChart = forwardRef<EChartHandle, { option: any; onClick?: (p: any) => void }>(function EChart({ option, onClick }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current, undefined, { renderer: "canvas" });
    inst.current = chart;
    chart.on("click", (p) => clickRef.current?.(p));
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); chart.dispose(); inst.current = null; };
  }, []);

  useEffect(() => { inst.current?.setOption(option, { notMerge: true }); }, [option]);
  useImperativeHandle(ref, () => ({ png: () => inst.current?.getDataURL({ pixelRatio: 2, backgroundColor: "#fff" }) }));
  return <div ref={el} style={{ width: "100%", height: "100%", minHeight: 280 }} role="img" aria-label="Gráfica interactiva" />;
});
export default EChart;
