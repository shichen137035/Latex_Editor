# Project exports

The File menu provides three exports. All save edited buffers before reading files.
The main document is resolved from project configuration by the main process;
selecting another TeX file does not change the export target.

- **Main PDF** compiles the project main document and exports its resulting PDF.
  Its cross-document compilation prerequisites may run, but only the main PDF is
  exported. Cancellation and compilation errors preserve the existing destination.
- **All source files (ZIP)** includes project source and resources, preserving
  directory layout. TeXWeave metadata/history, Git, node_modules, compiler byproducts,
  document PDFs and the destination archive are excluded. PDF image resources and
  authored index styles (`.ist`) remain included.
- **Main document sources (ZIP)** walks the main document's dependencies recursively:
  input/include/subfiles/imports, external documents, project-local classes/packages,
  bibliography databases/styles, graphics and explicitly referenced code/data.
  Unrelated project files remain out of the archive. System-installed TeX packages
  are not copied. A normal static document can be exported without a TeX toolchain.

Static parsing shares the editor's comment masking and balanced argument reader.
Literal filenames, simple constant macros and inherited graphicspath declarations
are supported. General TeX macro execution and conditional evaluation require actual
compiler inputs; this is not a second TeX interpreter.

A current `.fls` recorder supplements static discovery, including dynamically read
project resources. The recorder reader is shared with the compiler and honors its
output/auxiliary directory options and `PWD` declaration. A record is usable only
when it includes the main source, every non-generated project input still exists,
and none is newer than the record. Missing static dependencies fail clearly;
unresolved dynamic paths require recompilation or the all-source export, rather
than silently producing an incomplete archive.

ZIP construction processes one file at a time, compresses asynchronously, writes to
a temporary file, and atomically replaces the destination only after completion.
Symlinks are not included. Current ZIP32 limits are 65,535 entries and 4 GiB total.

Tests: `tests/integration/project-export.test.ts` validates actual ZIP entries and
contents, recursive dependency closure, resources, cross-document sources, missing
dependencies, dynamic recorder freshness and preservation of an existing archive on
failure. `tests/unit/document-actions.test.ts` verifies save ordering and main-only
dispatch; the IPC contract test verifies exposure and registration of all endpoints.
