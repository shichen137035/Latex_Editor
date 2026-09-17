# File menu regression check

Run `npm run desktop:test-ui` on a Windows desktop session.
This builds the application and launches Electron with a temporary user-data
directory and a temporary project; existing projects and registry are not used.

The check sends mouse-down and mouse-up events separately (allowing React to
render between them). It names entries through the actual React input, records
IPC handlers reached, and checks the resulting files and main-file registry.
It covers creation in the root and a subdirectory, rename, copy, main-file
selection, deletion with confirmation, and outside-click dismissal.
The temporary artifact path is printed for inspection.

The original build failed before any create IPC: the document mousedown
listener unmounted the menu before its button click. After fixing that,
Electron's unsupported window.prompt would also prevent naming.
The fix excludes menu-internal events from dismissal and uses an inline React
input. Tree actions carry exact paths instead of matching rendered file names.

Backend tests alone do not exercise these event-ordering and preload failures.
