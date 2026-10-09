import { SearchEngine, planReplacement } from "./SearchEngine.js";
import type { SearchJob, SearchJobResult } from "./searchJob.js";

self.onmessage = (event: MessageEvent<SearchJob>) => {
  const job = event.data;
  let result: SearchJobResult;
  try {
    if (job.kind === "search") result = { kind: "search", value: new SearchEngine().search(job.query, job.documents, job.ranges ? new Map(job.ranges) : undefined) };
    else result = { kind: "replace", value: job.documents.map(document => planReplacement(document, job.results.filter(item => item.fileId === document.fileId), job.replacement, job.query)) };
  } catch (error) { result = { error: error instanceof Error ? error.message : String(error) }; }
  self.postMessage(result);
};
