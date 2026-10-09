import { t } from "../i18n/index.js";
import type { ReplacementPlan } from "./SearchEngine.js";
import type { SearchDocument, SearchQuery, SearchResponse, SearchResult } from "./types.js";

export type SearchJob = { kind: "search"; query: SearchQuery; documents: SearchDocument[]; ranges?: Array<[string, Array<[number, number]>]> }
  | { kind: "replace"; query: SearchQuery; documents: SearchDocument[]; results: SearchResult[]; replacement: string };
export type SearchJobResult = { kind: "search"; value: SearchResponse } | { kind: "replace"; value: ReplacementPlan[] } | { error: string };
export interface SearchWorker {
  onmessage: ((event: MessageEvent<SearchJobResult>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(job: SearchJob): void;
  terminate(): void;
}

/** A disposable worker also puts a hard deadline on pathological regular expressions. */
export function runSearchJob(job: SearchJob, signal?: AbortSignal, createWorker: () => SearchWorker = () => new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" }), timeout = 2000): Promise<SearchJobResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
    const worker = createWorker();
    let settled = false;
    const finish = (error?: Error, value?: SearchJobResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.onmessage = null; worker.onerror = null; worker.terminate();
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new Error(t("ui.searchJob.search_timed_out_simplify_the_expression_or"))), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    // The worker sends message keys; UI localization stays out of its parsing bundle.
    worker.onmessage = event => finish(undefined, "error" in event.data ? { error: t(event.data.error) } : event.data);
    worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || t("ui.searchJob.search_worker_failed"))); };
    try { worker.postMessage(job); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
