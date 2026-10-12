# Project history storage

Snapshots, temporary saves and formal versions share a content-addressed object
store under `.texweave/history`. File hashes identify original bytes, so unchanged
resources are stored once across all entries.

Objects of at least 1 KiB are compressed asynchronously with gzip when the total
encoded size saves at least 10%. Small or incompressible objects remain raw.
Compressed objects have a versioned binary envelope; manifests retain their JSON
format. Reads accept existing raw objects and verify the original SHA-256 before
restoration, including objects whose bytes happen to start with the envelope marker.

Retention and explicit entry deletion also reclaim manifests and objects with no
remaining references. Formal versions and temporary saves remain outside automatic
snapshot retention. Routine checks apply retention even when content is unchanged.
Restore safety snapshots defer retention until a later operation, preserving both
the restore source and undo point throughout restoration.

Inspecting changes only computes hashes and does not create unreferenced history
objects. Garbage collection preserves valid file-index rows; routine cleanup avoids
database vacuum work on the snapshot path.

The History panel's **Optimize** action additionally compresses existing raw objects
and compacts SQLite. Object replacements are atomic and preserve entry IDs and
manifests. Project source and resource files are never rewritten by optimization.
Savings depend on content: text and structure JSON typically benefit; compressed
images or resource PDFs may not. Large changed files are still stored as complete
objects, rather than delta chains, to keep each retained entry independently restorable.

Regression coverage: `tests/integration/project-history.test.ts` checks compression,
binary restoration, existing-object compaction, corruption, shared references,
retention, non-persisting inspections and restore safety points.
