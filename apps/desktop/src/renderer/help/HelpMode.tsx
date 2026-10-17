import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n/index.js";
import { commandBindings, commands, displayBinding, eventBinding } from "../settings/commands.js";
import { helpTarget, helpTargetVisible, visibleHelpTargets, type HelpTarget } from "./topics.js";
import { controlTargets } from "./controlTopics.js";
import { adjacentHelpTarget, helpNavigation } from "./navigation.js";
import "./help.css";

export function HelpMode({ disabled = false }: { disabled?: boolean }) {
  const [active, setActive] = useState(false);
  const [target, setTarget] = useState<HelpTarget>();
  const [rect, setRect] = useState<DOMRect>();
  const panel = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const contents = useRef<HTMLDetailsElement>(null);
  const actions = useRef<{ step(direction: number): void; enter(): void; leave(): void }>({ step: () => {}, enter: () => {}, leave: () => {} });
  const navigation = useMemo(() => helpNavigation(active ? visibleHelpTargets() : [], target), [active, target]);
  const step = (direction: number) => {
    const next = adjacentHelpTarget(navigation.peers, target, direction);
    if (next) setTarget(next);
  };
  const enter = () => {
    const first = navigation.children[0];
    if (first) { setTarget(first); if (contents.current) contents.current.open = true; }
  };
  const leave = () => { if (navigation.parent) setTarget(navigation.parent); };
  actions.current = { step, enter, leave };
  useEffect(() => commands.register("help.toggle", { execute: () => setActive(value => !value), when: () => !disabled }), [disabled]);
  useEffect(() => { if (disabled) setActive(false); }, [disabled]);
  useEffect(() => {
    if (!active) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    document.body.classList.add("help-mode-active");
    const inspect = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest("[data-help-ui]")) return;
      const next = helpTarget(event.target);
      if (next) setTarget(current => current?.element === next.element ? current : next);
    };
    const block = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-help-ui]")) return;
      inspect(event); event.preventDefault(); event.stopImmediatePropagation();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setActive(false); }
      else if (!event.ctrlKey && !event.metaKey && !event.altKey && ["ArrowLeft", "ArrowRight", "q", "Q", "Backspace"].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === "ArrowLeft") actions.current.step(-1);
        else if (event.key === "ArrowRight") actions.current.step(1);
        else if (event.key === "Backspace") actions.current.leave();
        else if (!event.repeat) actions.current.enter();
      }
      else if (event.key === "Tab") {
        const buttons = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), details > summary") ?? []).filter(element => element.getClientRects().length);
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); event.stopImmediatePropagation();
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
      else if (![...commandBindings("help.toggle"), ...commandBindings("sidebar.help")].includes(eventBinding(event)) && !(event.target instanceof Element && event.target.closest("[data-help-ui]"))) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    document.addEventListener("pointerover", inspect, true);
    for (const name of ["pointerdown", "mousedown", "click", "dblclick", "contextmenu"]) document.addEventListener(name, block, true);
    document.addEventListener("keydown", keyboard, true);
    setTarget(helpNavigation(visibleHelpTargets()).peers[0]);
    return () => {
      document.body.classList.remove("help-mode-active");
      document.removeEventListener("pointerover", inspect, true);
      for (const name of ["pointerdown", "mousedown", "click", "dblclick", "contextmenu"]) document.removeEventListener(name, block, true);
      document.removeEventListener("keydown", keyboard, true);
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    };
  }, [active]);
  useEffect(() => {
    if (!active || !target) { setRect(undefined); return; }
    const update = () => setRect(target.element.isConnected ? target.element.getBoundingClientRect() : undefined);
    update();
    const observer = new ResizeObserver(update); observer.observe(target.element);
    window.addEventListener("resize", update); document.addEventListener("scroll", update, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); document.removeEventListener("scroll", update, true); };
  }, [active, target]);
  const related = useMemo(() => {
    if (!active || !target) return [];
    const container = target.element.closest(".latex-toolbar, .output-toolbar, .pdf-zoom-toolbar, .sidebar, .preferences-dialog, .preview-selection-toolbar, .table-preview-toolbar, .figure-inspector, .table-inspector, .directory-actions") ?? target.element;
    return controlTargets(container).filter(item => helpTargetVisible(item.element));
  }, [active, target]);
  if (!active) return null;
  const shortcut = commandBindings("help.toggle").map(displayBinding).join(" / ");
  return createPortal(<>
    {rect && <div className="help-mode-highlight" aria-hidden="true" style={{ left: Math.max(0, rect.left), top: Math.max(0, rect.top), width: Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(0, rect.left)), height: Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(0, rect.top)) }}/>}
    <section className="help-mode-panel" style={rect && rect.top > window.innerHeight / 2 ? { top: 18, bottom: "auto" } : undefined} data-help-ui tabIndex={-1} ref={panel} role="region" aria-label={t("helpMode.title")}>
      <header><strong>{t("helpMode.title")}</strong><button onClick={() => setActive(false)} aria-label={t("common.close")}>×</button></header>
      <p className="help-mode-hint">{t("helpMode.hint")}</p>
      <nav className="help-mode-breadcrumb" aria-label={t("helpKeyboard.location")}>
        <span>{t("helpKeyboard.overview")}</span>{navigation.ancestors.map(item => <button key={item.topic.id} onClick={() => setTarget(item)}>{item.topic.titleText || t(item.topic.title)}</button>)}
      </nav>
      <div className="help-mode-description" aria-live="polite"><h2>{target ? target.topic.titleText || t(target.topic.title) : t("helpMode.title")}</h2><p>{t(target ? target.topic.description || `helpMode.${target.topic.id}` : "helpMode.hint")}</p>
        {target?.topic.hint && <p className="help-mode-hint">{target.topic.hint}</p>}
        {target?.topic.shortcut && <p><kbd>{target.topic.shortcut}</kbd></p>}
        {target?.topic.disabled && <p className="help-mode-unavailable">{t("helpDetail.unavailable")}</p>}
      </div>
      {related.length > 0 && <details className="help-mode-contents" ref={contents}><summary>{t("helpDetail.contents", { count: related.length })}</summary><div>{related.map(item => <button key={`${item.topic.id}:${related.indexOf(item)}`} aria-pressed={item.element === target?.element} onClick={() => setTarget(item)}>{item.topic.titleText || t(item.topic.title)}{item.topic.disabled && <small>{t("common.unavailable")}</small>}</button>)}</div></details>}
      <div className="help-mode-level-controls"><button data-help-enter aria-keyshortcuts="Q" disabled={!navigation.children.length} onClick={enter}>{t("helpKeyboard.enter")} <kbd>Q</kbd></button><button data-help-back aria-keyshortcuts="Backspace" disabled={!navigation.parent} onClick={leave}>{t("helpKeyboard.back")} <kbd>Backspace</kbd></button></div>
      <footer><button aria-keyshortcuts="ArrowLeft" onClick={() => step(-1)}>{t("helpMode.previous")}</button><button aria-keyshortcuts="ArrowRight" onClick={() => step(1)}>{t("helpMode.next")}</button><button onClick={() => setActive(false)}>{t("helpMode.exit")}</button></footer>
      <small>{shortcut} · Esc</small>
      <small>{t("helpKeyboard.hint")}</small>
    </section>
  </>, document.body);
}
