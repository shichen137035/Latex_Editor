# Reference navigation

Source and Visual modifier-clicks share `ProjectReferenceIndex`, as does completion
of effective cross-document label keys. The modifier remains configurable in the
shortcut manager; back and forward continue to use their configured command bindings.

The index tracks each file's labels and explicit document links, including declarations
in included preambles and local classes/packages. It searches the active document's
include closure, then namespaces imported document labels with the prefix declared by
`externaldocument`. Source offsets point into the actual label-owning file, including
when that file is a chapter of the imported document. Unconnected documents and
ambiguous duplicate labels do not become arbitrary jump destinations.

The optional-argument syntax follows the
[xr/xr-hyper documentation](https://tug.ctan.org/macros/latex/contrib/hyperref/doc/xr-hyper.pdf):
`\externaldocument[prefix][nocite]{document}[url]`. The PDF URL does not change the
source document or the effective label prefix. Document paths remain project-scoped.

The existing loaded project text is reused. Open unsaved buffers override disk text.
Only changed files are reparsed, and cached namespaces are invalidated on text changes,
removal and changes to the main document. The index belongs to the Workbench instance,
so it is released on project exit rather than accumulating across projects.

One navigation transaction opens the target and records history only after it succeeds.
A reference origin stores its exact source command and the destination file/raw label.
Back/forward validate the origin command in the origin file and the raw label in the
destination file, avoiding the former same-file assumption. Document edits continue
to remap offsets, and removed links or labels invalidate stale entries.
Completed navigation also updates the source/Visual position anchor, so changing
editor mode after back/forward follows the current location rather than an older click.

Tests cover namespaces, includes, nested imported documents, duplicate labels, comments,
unsaved edits, prefix completion and repeated history traversal. The desktop
`preview-navigation` check exercises real modifier clicks and back/forward in both
Code and Visual modes using a disposable project and profile.
