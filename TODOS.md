# Known gaps / TODO

- **Crash resilience** — console, network, screenshots, and DOM snapshots live in `chrome.storage.session`; a browser crash silently wipes them. Video is the only artifact streamed to OPFS. All session data should be persisted to OPFS so a mid-session crash is recoverable.
- **Local report history** — once a ZIP is exported it's gone from the extension. There is no way to reopen, search, or annotate past reports. A persistent local store (IndexedDB or OPFS) indexed by session would make this a genuinely local-first tool rather than a one-shot exporter.
- **WebSocket binary frames** — binary payloads are captured as size annotations (`[Binary: N bytes]`) rather than decoded content.

Not planned (noted for completeness): localStorage / sessionStorage snapshot.
