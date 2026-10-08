import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isRelationCapableBlock, type BlockGraphSnapshot, type BlockId, type RelationDirection, type RelationNeighborhood } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { blockName, blockRole } from "./model.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { blockColorStyle, blockTypeLabel, EnvironmentBadge } from "./presentation.js";

const nodeWidth = 180;
const nodeHeight = 64;

export function RelationGraphView({ snapshot, definitions, neighborhood, direction, depth, onDirection, onDepth, onFocus, onLocate, onClose }: {
  snapshot: BlockGraphSnapshot;
  definitions: EnvironmentDefinition[];
  neighborhood: RelationNeighborhood;
  direction: RelationDirection;
  depth: number | "all";
  onDirection(value: RelationDirection): void;
  onDepth(value: number | "all"): void;
  onFocus(id: BlockId): void;
  onLocate(id: BlockId): void;
  onClose(): void;
}) {
  const blocks = useMemo(() => new Map(snapshot.blocks.map((block) => [block.id, block])), [snapshot.blocks]);
  const nodes = useMemo(() => neighborhood.blockIds.map((id) => blocks.get(id)).filter((block): block is NonNullable<typeof block> => !!block && blockRole(block).toLocaleLowerCase() !== "paragraph"), [neighborhood.blockIds, blocks]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [selected, setSelected] = useState<BlockId | null>(neighborhood.focusId);
  const [scale, setScale] = useState(1);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const previous = useRef<Record<string, { x: number; y: number }>>({});
  const stageRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const width = stage.offsetWidth;
      const height = stage.offsetHeight;
      setViewport((current) => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setSelected(neighborhood.focusId), [neighborhood.focusId]);
  useEffect(() => {
    const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ positions: Record<string, { x: number; y: number }> }>) => {
      previous.current = event.data.positions;
      setPositions(event.data.positions);
    };
    const nodeIds = new Set(nodes.map((block) => block.id));
    worker.postMessage({ nodes: nodes.map((block) => ({ id: block.id })), edges: neighborhood.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)), previous: previous.current });
    return () => worker.terminate();
  }, [nodes, neighborhood.edges]);
  const width = Math.max(0, ...Object.values(positions).map((position) => position.x + nodeWidth + 42));
  const height = Math.max(0, ...Object.values(positions).map((position) => position.y + nodeHeight + 42));
  const centerView = useCallback((targetScale: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.scrollTo({
      left: Math.max(0, (width * targetScale - stage.clientWidth) / 2),
      top: Math.max(0, (height * targetScale - stage.clientHeight) / 2),
    });
  }, [width, height]);
  const fitView = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !stage.clientWidth || !stage.clientHeight || !width || !height) return;
    const nextScale = Math.max(.45, Math.min(1, (stage.clientWidth - 24) / width, (stage.clientHeight - 24) / height));
    setScale(nextScale);
    requestAnimationFrame(() => centerView(nextScale));
  }, [width, height, centerView]);
  useEffect(() => {
    if (!width || !height) return;
    const frame = requestAnimationFrame(fitView);
    return () => cancelAnimationFrame(frame);
  }, [width, height, viewport.width, viewport.height, fitView]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => centerView(scale));
    return () => cancelAnimationFrame(frame);
  }, [scale, centerView, viewport.width, viewport.height]);
  const selectedBlock = selected ? blocks.get(selected) : undefined;
  const selectedCanBeFocused = !!selectedBlock && isRelationCapableBlock(selectedBlock);
  return <div className="relation-graph-backdrop" role="dialog" aria-modal="true" aria-label={t("relation.graphTitle")}>
    <section className="relation-graph-view">
      <header><div><small>{neighborhood.focusId ? t("relation.focusedView") : t("relation.fullView")}</small><strong>{neighborhood.focusId ? blockName(blocks.get(neighborhood.focusId)!) : t("relation.graphTitle")}</strong></div><button onClick={onClose} title={t("common.close")}>×</button></header>
      <div className="relation-graph-controls">
        <div className="relation-direction">{(["prerequisite", "both", "consequence"] as const).map((value) => <button className={direction === value ? "active" : ""} key={value} onClick={() => onDirection(value)}>{t(`relation.${value}`)}</button>)}</div>
        <label>{t("relation.depth")}<select value={String(depth)} onChange={(event) => onDepth(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="1">1</option><option value="2">2</option><option value="all">{t("relation.all")}</option></select></label>
        <button onClick={fitView}>{t("relation.fitView")}</button><button onClick={() => setScale((value) => Math.max(.45, value - .1))}>−</button><span>{Math.round(scale * 100)}%</span><button onClick={() => setScale((value) => Math.min(1.8, value + .1))}>＋</button>
      </div>
      <div ref={stageRef} className="relation-graph-stage"><div className="relation-graph-surface" style={{ width: width * scale, height: height * scale }}><div className="relation-graph-canvas" style={{ width, height, left: "50%", top: "50%", transform: `translate(${-width * scale / 2}px, ${-height * scale / 2}px) scale(${scale})` }}>
        <svg width={width} height={height} aria-hidden="true"><defs><marker id="relation-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker></defs>{neighborhood.edges.map((edge) => {
          const from = positions[edge.from]; const to = positions[edge.to];
          if (!from || !to) return null;
          const x1 = from.x + nodeWidth; const y1 = from.y + nodeHeight / 2; const x2 = to.x; const y2 = to.y + nodeHeight / 2; const bend = Math.max(35, (x2 - x1) / 2);
          return <path key={`${edge.from}:${edge.to}`} d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`} markerEnd="url(#relation-arrow)"/>;
        })}</svg>
        {nodes.map((block) => { const position = positions[block.id]; if (!position) return null; const canFocus = isRelationCapableBlock(block); return <button key={block.id} className={`relation-graph-node ${block.id === neighborhood.focusId ? "focus" : ""} ${block.id === selected ? "selected" : ""}`} style={{ ...blockColorStyle(block, definitions), left: position.x, top: position.y }} title={canFocus ? undefined : t("relation.invalid.virtual-endpoint")} onClick={() => setSelected(block.id)} onDoubleClick={() => { if (canFocus) onFocus(block.id); }}><small>{blockTypeLabel(block, definitions)}</small><strong>{blockName(block)}</strong>{block.label && <span>{block.label}</span>}</button>; })}
      </div></div></div>
      <aside className="relation-graph-selection">{selectedBlock ? <><EnvironmentBadge block={selectedBlock} definitions={definitions}/><strong>{blockName(selectedBlock)}</strong><span>{selectedBlock.label || selectedBlock.fileId || ""}</span><div><button disabled={!selectedCanBeFocused} title={selectedCanBeFocused ? t("relation.setFocus") : t("relation.invalid.virtual-endpoint")} onClick={() => onFocus(selectedBlock.id)}>{t("relation.setFocus")}</button><button onClick={() => onLocate(selectedBlock.id)}>{t("relation.locateDocument")}</button></div></> : <span>{t("relation.selectNode")}</span>}</aside>
    </section>
  </div>;
}
