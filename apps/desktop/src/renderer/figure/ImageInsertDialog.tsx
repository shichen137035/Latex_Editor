import { useEffect, useMemo, useState } from "react";
import type { ProjectTreeNode } from "@latex-editor/contracts";

const imagePattern = /\.(?:png|jpe?g|webp|svg|pdf)$/i;

export type ImageInsertChoice =
  | { kind: "empty" }
  | { kind: "project"; path: string }
  | { kind: "local" }
  | { kind: "multi"; rows: number; columns: number };

export function projectImagePaths(nodes: ProjectTreeNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "file"
    ? imagePattern.test(node.relativePath) ? [node.relativePath] : []
    : projectImagePaths(node.children ?? []));
}

export function ImageInsertDialog({ tree, replacement = false, onChoose, onClose }: { tree: ProjectTreeNode[]; replacement?: boolean; onChoose(choice: ImageInsertChoice): void; onClose(): void }) {
  const [view, setView] = useState<"choices" | "project" | "multi">("choices");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  const [preset, setPreset] = useState("2x2");
  const images = useMemo(() => projectImagePaths(tree).filter((path) => path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [tree, query]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  const chooseProject = () => { if (selected) onChoose({ kind: "project", path: selected }); };
  const chooseGrid = () => {
    const safeRows = Math.max(1, Math.min(6, Math.floor(rows)));
    const safeColumns = Math.max(1, Math.min(6, Math.floor(columns)));
    onChoose({ kind: "multi", rows: safeRows, columns: safeColumns });
  };
  const changePreset = (value: string) => {
    setPreset(value);
    if (value === "custom") return;
    const [nextRows, nextColumns] = value.split("x").map(Number);
    setRows(nextRows ?? 2);
    setColumns(nextColumns ?? 2);
  };
  return <div className="image-insert-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="image-insert-dialog" role="dialog" aria-modal="true" aria-label={replacement ? "Choose replacement image" : "Insert image"}>
      <header><div><small>FIGURE</small><h2>{replacement ? "Choose replacement image" : "Insert image"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header>
      {view === "choices" && <div className="image-insert-choices">
        {!replacement && <button onClick={() => onChoose({ kind: "empty" })}><b>□</b><span><strong>Empty figure</strong><small>Create a figure block without choosing an image yet.</small></span></button>}
        <button onClick={() => setView("project")}><b>▧</b><span><strong>Project image</strong><small>Reference an existing image without copying it.</small></span></button>
        <button onClick={() => onChoose({ kind: "local" })}><b>↥</b><span><strong>Local image</strong><small>Choose a local file and copy it into the project figures folder.</small></span></button>
        {!replacement && <button onClick={() => setView("multi")}><b>⊞</b><span><strong>Multiple images</strong><small>Create an empty grid and fill each cell later.</small></span></button>}
      </div>}
      {view === "project" && <div className="image-project-picker">
        <button className="image-dialog-back" onClick={() => setView("choices")}>← Back</button>
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter project images…"/>
        <div className="image-project-list">{images.length ? images.map((path) => <button className={selected === path ? "selected" : ""} key={path} onClick={() => setSelected(path)} onDoubleClick={() => onChoose({ kind: "project", path })}><span>▧</span><code>{path}</code></button>) : <p>No supported images were found in this project.</p>}</div>
        <footer><button onClick={onClose}>Cancel</button><button className="primary" disabled={!selected} onClick={chooseProject}>Use image</button></footer>
      </div>}
      {view === "multi" && <div className="image-multi-picker"><button className="image-dialog-back" onClick={() => setView("choices")}>← Back</button><p>Choose the grid size. Empty cells can be filled from Preview.</p><label><span>Common layouts</span><select value={preset} onChange={(event) => changePreset(event.target.value)}><option value="1x2">1 × 2</option><option value="2x2">2 × 2</option><option value="2x3">2 × 3</option><option value="3x3">3 × 3</option><option value="custom">Custom</option></select></label><div className="image-grid-fields"><label><span>Rows</span><input type="number" min={1} max={6} value={rows} onChange={(event) => { setPreset("custom"); setRows(Number(event.target.value) || 1); }}/></label><span className="image-grid-times">×</span><label><span>Columns</span><input type="number" min={1} max={6} value={columns} onChange={(event) => { setPreset("custom"); setColumns(Number(event.target.value) || 1); }}/></label></div><div className="image-grid-preview" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(6, columns))}, 1fr)` }}>{Array.from({ length: Math.max(1, Math.min(36, rows * columns)) }, (_, index) => <i key={index}/>)}</div><button className="primary image-grid-create" onClick={chooseGrid}>Create {rows} × {columns} grid</button></div>}
    </section>
  </div>;
}
