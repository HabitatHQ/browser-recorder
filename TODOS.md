# Known gaps / TODO

- **Crash recovery limits**—session events, screenshots, DOM snapshots, replay data, and session video are written to OPFS; session state and recent error metadata use browser storage. Recovery is best effort: browser storage may be unavailable, writes may fail, and a crash can leave artifacts incomplete or unavailable. Continuous-capture video is memory-only and is lost on restart. Do not assume a crash-interrupted capture can be fully recovered.
- **Local report history** — once a ZIP is exported it's gone from the extension. There is no way to reopen, search, or annotate past reports. A persistent local store (IndexedDB or OPFS) indexed by session would make this a genuinely local-first tool rather than a one-shot exporter.
- **WebSocket binary frames** — binary payloads are captured as size annotations (`[Binary: N bytes]`) rather than decoded content.
- **CLI interaction capture**—scripted CLI captures currently do not reliably include interactions; the source-runner's injected listener has a runtime failure. Verify the generated interaction artifact before relying on CLI reports for interaction history.

Not planned (noted for completeness): localStorage / sessionStorage snapshot.
