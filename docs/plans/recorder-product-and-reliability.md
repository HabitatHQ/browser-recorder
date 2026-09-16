# Browser Recorder: product assessment and reliability plan

Status: assessment complete; implementation proposed, not implemented by this document.

Assessment date: 2026-09-16. Source baseline: version 0.6.1, commit `2bb8756f2825d644d9379d2b215d5e24a542f1ef`.

## 1. Decision summary

Position Browser Recorder as a **local-first diagnostic bug recorder**, not a general-purpose screen recorder. Its strongest proposition is rich browser evidence in a portable report that a recipient can inspect without an account or extension.

Before expanding features or promoting an unconditional privacy promise, fix collection controls, redaction boundaries, lifecycle correctness, and network completeness. Then improve the report narrative, handoff, onboarding, and store presentation.

Use four complementary techniques where they address these concrete failures:

- **FSM—Finite State Machine:** specify legal lifecycle transitions and when collection is permitted.
- **MISU—Make Illegal States Unrepresentable:** encode meaningful distinctions in types instead of combinations of nullable fields and independent booleans.
- **Functional Core:** put policy, transitions, sanitization decisions, and report construction in deterministic functions.
- **Imperative Shell:** keep Chrome APIs, injected hooks, timers, storage, media, and downloads at explicit boundaries; execute decisions and report their actual outcomes.

These are not four new subsystems. An FSM can be a pure transition function over discriminated unions, surrounded by the existing background controller. No state-machine library, framework rewrite, new service, or dependency is required by this plan.

## 2. Evidence and limitations

The assessment used three read-only scout subagents for broad recorder competition, diagnostic competitors, and the user workflow. Findings were cross-checked with primary pages, source, symbol references, store assets, and isolated browser experiments.

Evidence labels used below:

- **Runtime:** observed using actual repository modules and synthetic inputs. These were isolated probes, not a complete installed-extension test.
- **Source:** established by implementation and reference tracing; relevant full-browser behavior still needs reproduction.
- **Market:** a store/product claim or a reviewer's account, not independently benchmarked behavior.
- **Recommendation:** a proposed change or product judgment, not a claim about existing behavior.

Runtime probes were built in memory. Browser responses were intercepted locally; no real credentials, accounts, or microphone data were used. Chrome storage was mocked for the settings probe. That probe exercised real storage and capture modules with a capture-config handoff corresponding to the production path, not the extension's Settings UI. Probe scripts were not retained as regression tests. Future fixes must reproduce the failures before changing behavior and retain regression coverage where it protects a real contract.

The assessment did not establish our own public Chrome Web Store listing, installation count, or rating. Failure to locate it is not proof it is unpublished. Store figures are dated snapshots, not market-share measurements. Source links below refer to the repository; the baseline commit identifies the assessed implementation.

## 3. Competitive position

### Search and naming

The initial [Chrome Web Store search for `recorder`](https://chromewebstore.google.com/search/recorder) was dominated by screen/audio products: Screen Recorder, Awesome Screen Recorder & Screenshot, Screenity, and several audio recorders. Browser Recorder was not among those initial results. Search ordering varies and was not treated as a stable rank.

An [unrelated extension also named Browser Recorder](https://chromewebstore.google.com/detail/browser-recorder/bmkimnpopagbkknhfpjfbgmhimofmmkm) showed 3,000 users and a 4.6 rating. Those figures are **not ours**.

Recommended listing direction:

> **Browser Recorder — Bug Reports & Debug Capture**
>
> Record bugs with console, network, screenshots, and replay. Export locally. No account or cloud required for the report workflow.

The dictation finding in §4 must be resolved before strengthening this into an unconditional “nothing leaves your device” promise. Confirm the actual listing identity and link to it consistently from installation documentation. Use the Developer Tools category and show diagnostic outcomes rather than competing for generic video-recording intent.

### Representative competitors

Loom and Screencastify were checked separately; they were not observed in the initial literal-search results. Capabilities here are verified primary-page claims, not hands-on comparisons.

| Product | Store snapshot | Primary job and implications |
|---|---|---|
| [Jam](https://chromewebstore.google.com/detail/jam/iohjgamcilhbgmhbnllfolmkmmekfmci) | 200,000 users; 4.5, 293 ratings | Diagnostic recordings, AI summaries, share links, issue-tracker integrations, and MCP. Benchmark for getting evidence to developers. |
| [BrowserStack Bug Capture](https://chromewebstore.google.com/detail/browserstack-bug-capture/mdplmiioglkpgkdblijgilgebpppgblm) | 70,000 users; 4.8, 76 ratings | Screen capture, console/network context, instant replay, Jira. The Bird extension ID resolved to this listing; rolling capture is not unique to us. |
| [webQsee](https://chromewebstore.google.com/detail/webqsee-session-replay-ne/gamdpfnfkjknkimfbboonmgdfnondfme) | 1,000 users; 4.9, 14 ratings | Closest technical competitor: account-free local diagnostics, WebSocket/SSE, replay, waterfall, HAR, dashcam, optional managed/BYO storage. “Local and no account” alone is not a differentiator. |
| [Marker.io](https://chromewebstore.google.com/detail/markerio-visual-bug-repor/jofhoojcehdmaiibilpcoofpdbbddkkl) | 30,000 users; 4.3, 185 ratings | Annotated feedback, technical context, and tracker integrations. Benchmark for nontechnical reporters. |
| [BugHerd](https://chromewebstore.google.com/detail/bugherd-visual-feedback-b/popigpemobhbfkhnnkllkjgkaabedgpb) | 80,000 users; 4.3, 45 ratings | In-context visual feedback and task workflows. Adjacent competitor for client reporting rather than deep API diagnosis. |
| [Screenity](https://chromewebstore.google.com/detail/screenity-screen-recorder/kbbdabhdfibnancpjfhlkhafgdilcnji) | 200,000 users; 4.4, 757 ratings | Free/open-source recording, annotation, editing, multiple formats, optional cloud. Do not duplicate a general video editor. |
| [Loom](https://chromewebstore.google.com/detail/loom-%E2%80%93-screen-recorder-sc/liecbddmkiiihnedobmlmillhodjkdmb) | 8,000,000 users; 4.6, 10.2K ratings | Screen/camera/audio, cloud links, comments and reactions. Benchmark for frictionless handoff, but a different primary job. |
| [Screencastify](https://chromewebstore.google.com/detail/screencastify-screen-vide/mmeijimgabbpbgpdklnllpncmdofkcpn) | 8,000,000 users; 3.9, 11.7K ratings | Video editing, captions, Drive/Classroom workflows. Its broader marketing adoption figure was not substituted for the store count. |

For pricing context, [Jam's pricing page](https://jam.dev/pricing) listed a free plan with 30 Jams and recordings up to five minutes; Team was $14 per creator/month billed yearly. Pricing changes and is not a permanent product requirement. Do not equate a store privacy declaration with absence of cloud processing: [Jam's privacy policy](https://jam.dev/legal/privacy-policy) describes service processing and storage.

### Our strengths and gaps

Already implemented: console/network/WebSocket/SSE capture, interactions, DOM snapshots, annotated screenshots, optional video, ring capture with scope/pins, pause/resume controls, request replay/curl, generated reproduction notes, artifact inclusion and size estimates, diagnostics, persistent event writes, and an experimental side panel/replay. These should not be proposed as entirely new features. Their existence does not establish correctness in every lifecycle state.

The portable ZIP, `report.html`, Markdown, and structured data are a useful combination for developers and QA teams who want local evidence and existing sharing channels. The biggest handoff disadvantage is export → find ZIP → attach → recipient extracts and opens it, compared with a hosted link.

### Review evidence

The accessible samples were small and non-random; they do not establish complaint rates or prove old problems remain unresolved.

- [Jam reviews](https://chromewebstore.google.com/detail/jam/iohjgamcilhbgmhbnllfolmkmmekfmci/reviews): praise for developer communication and MCP; February 2026 reports of short/failed recordings and interference with page styling. Reliability and non-interference matter alongside integration features.
- [Screenity reviews](https://chromewebstore.google.com/detail/screenity-screen-recorder/kbbdabhdfibnancpjfhlkhafgdilcnji/reviews): praise for easy local/Drive saving and unrestricted recordings; individual reports of missing audio and stuttering. Make unavailable channels visible.
- [webQsee reviews](https://chromewebstore.google.com/detail/webqsee-session-replay-ne/gamdpfnfkjknkimfbboonmgdfnondfme/reviews): one November 2025 reviewer objected to default docking; an older review requested raw-response export. Keep the side panel optional and consider targeted exports only where demand warrants them.

## 4. Findings and priorities

### P0.1 — Collection settings must control collection

**Source + runtime.** Network options are saved and displayed, but the capture startup forwards selector/performance configuration rather than the network filter. In the isolated probe, both fetch and XHR emitted request bodies, response bodies, matching excluded URLs, and a configured custom header despite saved settings disabling/excluding them.

Sources: [settings UI](../../src/entrypoints/options/App.tsx#L419), [storage](../../src/lib/storage.ts#L174), [bridge startup](../../src/lib/bug-report-debugger/engine/background/index.ts#L123), [fetch body capture](../../src/capture-core/debugger/engine/page/network/fetch/post.ts#L65).

Implement a single effective capture policy, delivered to each producer before it becomes active. Apply exclusions before reading bodies or enqueueing records. Wire supported options end to end; remove unsupported choices until implemented. In particular, do not imply that an “All resources” option can capture static resource bodies through a fetch/XHR-only mechanism. Determine the necessary browser capability before offering it.

**Acceptance:** disabled bodies and excluded requests are absent from local storage and every export, for fetch and XHR; custom headers are protected. Saving options alone is not a passing test. Clearly specify whether changed settings apply immediately or only to the next session; running producers and the UI must agree.

### P0.2 — Truncation must not defeat automatic redaction

**Runtime.** Short synthetic JSON passwords were redacted in request and response bodies. JSON containing more than the capture limit retained the synthetic password in both. The observed long previews were approximately 4,000 characters; this was a string-length observation, not a byte measurement.

The capture path truncates before sanitization. Parsing incomplete JSON fails, and the fallback does not reliably cover quoted JSON credential fields. Sources: [body preview](../../src/capture-core/debugger/engine/page/network/shared.ts#L39), [sanitization](../../src/capture-core/debugger/engine/page/utils.ts#L161).

Sanitize within a bounded capture budget. Do not solve this by reading and parsing arbitrarily large bodies. If complete safe parsing is unavailable, use a deliberately supported bounded parser or omit the body with a reason. A truncated or malformed body must not silently fall through as protected text. Preserve the application's original response/stream semantics.

**Acceptance:** a synthetic secret stays absent below, at, and above size boundaries, including malformed JSON, escapes, and a credential split at the cutoff. Optional export review remains defense in depth, not a substitute for collection-time protection.

### P0.3 — Pause and Stop must enforce collection boundaries

**Source.** Stop sets `status = "stopping"`, but incoming events are appended whenever status is not `"paused"`; stopping therefore still qualifies. The debugger session is discarded on report-tab closure. The inspected page-hook lifecycle has no corresponding teardown. The lower debugger store also accepts events independently of the UI session's paused status.

Sources: [event acceptance](../../src/entrypoints/background.ts#L541), [stop/pause handling](../../src/entrypoints/background.ts#L856), [report-tab closure](../../src/entrypoints/background.ts#L677), [debugger store](../../src/lib/bug-report-debugger/engine/background/session-store.ts#L148), [content bridge](../../src/lib/bug-report-debugger/content.ts#L45).

This finding was not reproduced through a fully installed extension's Stop/Pause UI. Nevertheless, “not paused” is not a sufficient collection policy. Freeze stopped reports, stop producers, flush eligible queued data, and ignore stale callbacks. Separately authorized ring capture must retain its own scope and lifecycle.

**Acceptance:** post-stop activity cannot extend the stopped report; pre-stop queued data is explicitly drained; paused activity is not retained for the paused session; a new session works without page reload. If no session or ring owner remains, hooks become dormant or are safely removed without overwriting a later third-party wrapper.

### P0.4 — Independent concurrent fetches must all be captured

**Runtime.** Three sequential successful fetches produced three captured entries. Three concurrent successful fetches produced one. The recursion guard remains enabled while awaiting the first response, causing independent calls to bypass instrumentation.

Source: [fetch wrapper](../../src/capture-core/debugger/engine/page/network/fetch/install.ts#L27).

Distinguish synchronous wrapper recursion from asynchronous request lifetime. Guard only the invocation boundary that can recurse; use per-request state for response handling. Do not globally serialize requests or keep a page-wide busy flag until a response arrives.

**Acceptance:** overlapping successes and failures are each captured exactly once; legitimate third-party wrappers still work; return values, rejection behavior, body consumption, and application concurrency remain unchanged. FSM modeling helps clarify the two lifetimes but is not a replacement for fixing the wrapper's synchronous reentrancy logic.

### P0.5 — Dictation must match the privacy promise

**Source + platform documentation.** Dictation uses `SpeechRecognition`/`webkitSpeechRecognition` without requiring on-device processing. [MDN documents server-based recognition in Chrome](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition); [`processLocally` defaults to false](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally), allowing local or remote processing.

Sources: [dictation](../../src/components/voice-input.tsx#L50), [privacy promise](../../PRIVACY.md#L8). No microphone was activated and no actual transmission was measured.

Prefer local-only recognition with capability/language availability checks and no remote fallback. If remote dictation is retained, explicitly disclose its processing before activation and qualify the privacy policy and listing. Browser microphone permission is not equivalent to informed consent to remote processing. Any language-pack download also needs accurate disclosure rather than an unconditional “no network” claim.

**Acceptance:** unsupported local recognition fails closed or is unavailable; remote processing cannot start without its separately disclosed choice. Test supported, unsupported, language-unavailable, denied-permission, and offline paths.

### P1.1 — Recording status and artifact health must be truthful

**Source.** Debugger startup failures are caught before the session is marked recording. Injection failures can return normally. Some OPFS reads and missing video artifacts are skipped while review/export continues.

Sources: [startup](../../src/entrypoints/background.ts#L820), [injection](../../src/lib/bug-report-debugger/engine/background/injection.ts#L13), [artifact loading](../../src/entrypoints/recorder/App.tsx#L467), [video bundling](../../src/lib/export.ts#L267).

Use confirmed producer readiness, visible per-channel health, and explicit partial-report status. A quiet page with zero events is different from a failed hook. Existing diagnostics should inform the normal workflow, not only a collapsed support panel. Screenshot/DOM confirmation should follow successful artifact persistence, not just message dispatch. Do not describe a requested download as confirmed saved to disk when the browser API does not provide that confirmation.

**Acceptance:** rejected injection never yields an unqualified Recording status; missing expected artifacts are listed with retry/explicit partial export; success UI remains available long enough to locate and share the result.

### P1.2 — The main report must include narrative and accurate metadata

**Runtime:** description and reproduction notes appeared in generated Markdown but not generated HTML, also inspected in a browser. **Source:** session duration is export time minus start; viewport is screen dimensions rather than the recorded page's viewport.

Sources: [HTML input](../../src/lib/report-html.ts#L9), [report assembly](../../src/lib/export.ts#L280), [HTML call](../../src/lib/export.ts#L330).

Build a common report model for HTML and Markdown: description, steps, expected/actual behavior, evidence, capture health, and privacy/inclusion decisions. Record stop time and target-page environment while they are available. Keep wall-clock recording span distinct from active duration if pauses are subtracted; do not silently mix the two.

**Acceptance:** `report.html` alone explains the bug; a 30-second recording remains 30 seconds after minutes of review; a 900×700 recorded viewport is reported independently of monitor size. Opening the main report needs no extension or account. Test linked media/replay/DOM artifacts separately rather than assuming all referenced website assets are available offline.

### P1.3 — Make safe export and handoff explicit

**Runtime + source.** Dropping a request removes headers/bodies but preserves its URL, including a synthetic email query value. Network review is opt-in and initially collapsed. Installed-extension metadata is collected for export. Existing capture sanitization, secret scanning, redact-all, blur, and artifact exclusion are useful but do not guarantee that every artifact is safe.

Sources: [drop semantics](../../packages/core/src/network-edit.ts#L18), [privacy review](../../src/components/export-review.tsx#L44), [extension metadata](../../src/lib/export.ts#L207).

Offer a clearly defined sharing preset and preflight showing unresolved findings, missing artifacts, estimated size, and largest items. Distinguish “remove bodies/headers” from “remove request.” Apply decisions consistently to HTML, Markdown, JSON, and metadata. Make installed-extension inventory optional. Do not imply that automated text checks cover screenshots/video/DOM/replay or identify every secret.

Add Copy issue summary, tracker-friendly text, and clear attachment instructions without automatic uploads. Consider lightweight summary/raw-artifact exports alongside ZIP; introduce HAR/waterfall support later if user demand justifies it. Keep schema/versioned structured data useful to CLI and agent consumers before adding an integration framework.

**Acceptance:** a recipient understands the report without guidance; one action copies useful issue text; exclusion/redaction decisions survive every export representation; sharing remains user-initiated.

### P2 — Onboarding, discoverability, and accessibility

**Source/assets + recommendation.** The [store review image](../store/recorder.png) shows zero counts and empty fields. The initial workflow exposes many controls; ring scope defaults to an empty allowlist. Some collapsible panels omit expanded-state semantics. Existing shortcuts, labels, scope controls, and optional side panel should be improved rather than rebuilt.

Sources: [ring default](../../src/lib/ring/scope.ts#L15), [popup](../../src/entrypoints/popup/App.tsx), [review controls](../../src/components/export-review.tsx#L118).

Show a populated example: failed request, console error, edited steps, annotated screenshot, and recipient report. Explain “record a new bug” versus “recover what just happened,” with explicit eligible-site selection for ring capture. Offer recommended defaults and secondary advanced settings. Remember the chosen UI surface; do not force docking. Add expanded-state semantics, keyboard navigation, visible status feedback, and usable narrow-window review. Reconcile stale version/install documentation and misleading tooltip defaults with implementation.

**Acceptance:** a new user can identify the diagnostic purpose quickly and export a useful first report without the guide. Verify keyboard-only use and screen-reader semantics on the actual UI; screenshot inspection alone is not accessibility verification.

## 5. FSM: lifecycle behavior as an explicit contract

The existing [Session](../../src/lib/types.ts#L99) has a status union, but behavior is spread across handlers and callbacks. Adding more status strings alone will not establish lifecycle correctness.

### Proposed session transitions

| State/event | Decision | Shell work and completion evidence |
|---|---|---|
| Idle + Start | Create a start attempt and effective policy | Validate target; inject/configure producers; await readiness for that attempt. |
| Starting + readiness result | Enter Recording only with confirmed active channels, or present explicit failure/partial choice | Do not infer success from a resolved injection call alone. |
| Starting + Stop/Discard | Cancel the attempt | Tear down resources that resolve late; a stale success cannot revive it. |
| Recording + Pause | Establish a collection cutoff and enter Pausing | Disable session-owned producers and acknowledge/drain eligible pre-cutoff batches. |
| Pausing + barrier satisfied | Enter Paused | Render paused only after the collection boundary is established. |
| Paused + Resume | Start a new capture epoch | Reconfigure/re-enable producers and confirm readiness before Recording. |
| Recording/Paused + Stop | Enter Draining with a fixed cutoff | Stop new collection, flush queues, finalize media, and await durable writes. |
| Draining + completed barriers | Seal a report snapshot and enter Review | Review is not a live recording state. |
| Draining + timeout/failure | Seal an explicitly incomplete report, or offer retry | Name missing producers/artifacts; never silently claim completeness. |
| Review + Export | Create an export attempt from the sealed snapshot and review decisions | Write/download the selected artifacts; report actual available completion evidence. |
| Export failure | Return to the same recoverable review | Do not discard the snapshot or user's edits. |
| Review + Discard | Release the draft after explicit user action | Cancel owned work and delete only its resources. |

Define events and transitions with a pure exhaustive function. The shell executes returned commands and feeds back success/failure events. Serialize control transitions through one background owner; asynchronous completions carry session ID, capture epoch, and operation ID. Duplicate or stale completions must not advance a newer operation.

A drain barrier needs more than waiting for the current OPFS promise chain. Each producer must acknowledge its final eligible sequence; the bridge must forward those batches; writes must complete through those sequences. Use producer sequence/epoch boundaries rather than relying solely on clocks in different contexts. Specify treatment of requests initiated before Stop but completed afterward: record bounded completion metadata or mark them incomplete, without silently extending the collection window for sensitive bodies.

### Orthogonal ownership, not a giant state matrix

Keep session lifecycle, ring eligibility, and report/export lifecycle separate. Ring capture is an explicitly authorized owner with its own origin policy; stopping a session must not stop a permitted ring owner, and ring activity must not extend a sealed session. Coordinate shared video ownership explicitly: session ownership can suspend ring video without turning off permitted ring data capture.

The invariant is: **a producer collects only for at least one current authorized owner**. Once no owner remains, make hooks dormant or remove them safely. Persist serializable state, not live MediaRecorder/FileHandle objects. On worker/browser restart, reconcile stored intent with actual resources; stale persisted “recording” state is not proof that producers are alive.

**Where FSM helps:** truthful start, precise pause/stop, canceled starts, bounded recovery, stale callback rejection, and visible partial results. It does not itself sanitize data, capture missed requests, or make browser APIs reliable.

## 6. MISU: represent valid facts, not convenient combinations

Use discriminated unions and validated constructors at real boundaries. TypeScript cannot guarantee external messages, Chrome storage, or injected scripts satisfy a type; parse/validate there, and do not use casts to manufacture readiness or safety.

| Current ambiguity | Proposed representation and benefit |
|---|---|
| Recording with a nullable debugger session ID or no confirmed producer | Starting and Active are distinct variants. Active carries its confirmed producer capabilities and capture epoch; deliberate partial capture has explicit health. |
| An arbitrary string body with no reason it is absent or truncated | Body result distinguishes omitted-with-reason, sanitized-under-policy, and review-required if explicitly supported. Carry completeness/truncation and policy version. |
| A dropped request whose URL is silently retained | Separate remove-request from remove-payloads. The latter explicitly describes retained URL/method/status and remains subject to URL privacy decisions. |
| An expected video filename that may or may not exist | Artifact state distinguishes not-requested, collecting, ready, and failed with reason. Ready requires evidence from a successful write/read, not merely a filename. |
| Export input that may still be recording or incompletely reviewed | An export plan references a sealed snapshot, chosen artifacts, outstanding warnings, and deliberate review decisions. Missing artifacts cannot be silently represented as complete. |
| Local-only dictation represented by a generic supported boolean | Unavailable, local-ready, and remote-capable/consented are different states. Local-only policy cannot choose a remote effect. |
| Resource options that the engine cannot implement | An effective policy contains only capabilities the selected producer supports; unsupported requests return a visible configuration error. |

Do not introduce a misleading `SafeString` or `SafeReport` brand. A type can prove that a specified sanitizer/review path ran, not that arbitrary content contains no sensitive information. Likewise `readonly` does not make a live resource immutable or revoke access to it. Sealed reports need actual ownership and persistence boundaries.

Use branded IDs/units only where they prevent plausible mix-ups: session IDs versus capture epochs, or wall-clock times versus durations. Avoid branding every primitive or spreading unions through unrelated UI components. MISU should reduce branches and nullable combinations, not add ceremony.

**Where MISU helps:** the compiler exposes missing failure/partial cases, exporters cannot accidentally consume raw producer events, and UI status follows facts. Runtime validation and actual wiring remain necessary.

## 7. Functional Core and Imperative Shell: decisions versus effects

### Build on existing boundaries

[`packages/core`](../../packages/core/src/index.ts) already contains pure timeline, report, reproduction-step, redaction, network-edit, performance-summary, and curl functions. [`src/lib/ring/scope.ts`](../../src/lib/ring/scope.ts) is an existing pure policy boundary. Extend these patterns instead of creating a second policy framework.

| Functional Core: deterministic decisions/data | Imperative Shell: interaction with the outside world |
|---|---|
| Compile/validate effective capture policy | Read saved settings and deliver policy to each producer |
| Decide eligibility, exclusions, retained fields and redaction disposition | Invoke page hooks; read bounded clones/previews only when permitted |
| Transition lifecycle state and produce commands | Inject scripts, obtain permission, start/stop media and acknowledge outcomes |
| Classify failure/partial artifact states | Perform OPFS/storage writes, queue flushing, and recovery probes |
| Build one reviewed report model and export plan | Assemble ZIP/media streams and trigger download/UI effects |
| Format HTML/Markdown/JSON summaries from the same model | Present status, clipboard actions and user-selected handoff |

Inputs include explicit time, capability evidence, policy, state, and events. Core functions do not call `Date.now`, Chrome APIs, fetch, storage, DOM, or React setters. The shell supplies observations rather than letting policy infer success from absence of an exception.

Keep shared browser/CLI policy in the existing core package only when both consume it. Extension-only lifecycle logic can remain in `src/lib`; it need not become a public package API. Page producers may bundle shared pure policy code, but must not import browser-background I/O or an entire UI dependency graph.

### Recommended data flow

```text
User settings / browser capabilities
    -> validated effective policy
    -> shell configures producers and receives readiness acknowledgements
    -> eligible producer event, tagged with owner + epoch + policy version
    -> bounded capture + pure filtering/sanitization decisions
    -> persist permitted data only
    -> explicit stop/drain barrier
    -> sealed report snapshot + review decisions
    -> common report model / export plan
    -> shell writes selected artifacts and presents the result
```

Reject excluded requests before body extraction. For included requests, carry completeness information into sanitization. Share one privacy policy across producer-time filtering and export-time checks so a second renderer cannot resurrect removed fields. Apply reviewed decisions to metadata and summaries as well as `network.json`.

The shell still has necessary mechanics: cancellation, queue ownership, acknowledgement ordering, bounded reads and browser error handling. A pure core cannot guarantee atomicity across Chrome storage, OPFS, media finalization and downloads. Make interrupted operations recoverable and completion events idempotent rather than claiming exactly-once external effects.

### Performance discipline

- Compile exclusion/header rules once per policy version, not once per request.
- Keep lifecycle state small; do not copy the accumulated event log on each transition.
- Pass artifact references/manifests through control state rather than large Blobs.
- Sanitize each bounded payload once where possible and reuse the reviewed model across exports.
- Bound queues, body previews and drain time; report omissions explicitly.
- Preserve concurrent application requests. Do not make a single serialized control loop serialize network traffic.

**Where the split helps:** policy tests become deterministic and cheap; browser experiments concentrate on integration risks; the same decisions govern collection, persistence, UI status, and exports. It does not justify an effect framework, event-sourcing system, or generic plugin architecture.

## 8. Delivery sequence and verification

| Slice | Change boundary | Proof required before calling it complete |
|---|---|---|
| Collection/privacy correctness | Effective settings path, fetch/XHR producers, body sanitization, dictation capability policy | Reproduce disabled-body/exclusion/custom-header failures through the installed extension; fix them. Exercise truncated/malformed bodies and local-recognition availability. Assert absence from storage and all exported artifacts. |
| Lifecycle and network completeness | Background session owner, producer epochs/barriers, hook reentrancy | Start failure, cancellation while starting, pause/resume, stop with queued events, stale callbacks, concurrent successes/failures, third-party wrappers, session/ring shared-video ownership, worker restart. Verify actual browser outcomes. |
| Report integrity | Sealed snapshot, artifact manifest, common report model, target metadata | Description/steps visible in HTML and Markdown; correct viewport/duration; partial artifacts disclosed; retry preserves review edits; post-stop activity cannot mutate the snapshot. |
| Handoff and onboarding | Review UI, copyable summary, optional targeted exports, listing/docs | Fresh-user capture-to-report walkthrough; recipient opens report without extension/account; keyboard/narrow-window review; no upload without deliberate user action. Verify listing identity before changing links. |

Do not introduce a broad rewrite before these fixes. Extract a small pure policy or transition function at the boundary being repaired, migrate every caller in that slice, and remove the superseded decisions. Do not retain competing old/new settings paths or privacy algorithms behind compatibility shims. Validate historical persisted data explicitly; adding a type alone does not migrate existing captures.

Pure regression coverage should defend behavior: allowed transitions, stale completion rejection, exclusion precedence, redaction boundaries, explicit omission, and consistency across report formats. Browser checks should cover what pure tests cannot: injection acknowledgement, request-wrapper compatibility, message delivery/drain, storage/media failures, permissions, and rendered accessibility. Avoid tests that merely assert field forwarding, source text, or incidental wording.

For implementation, use the existing scripts (`pnpm check`, `pnpm lint`, `pnpm test`) and repository-native targeted tests after the changed paths are integrated. These commands were not run for this documentation-only change. They supplement, not replace, installed-extension/browser scenarios. The core package has its own test directory; verify the selected test configuration actually discovers any new core regression tests rather than assuming the root command does.

### Release gates

1. **Effective controls:** disabled/excluded data never reaches storage or exports.
2. **Bounded privacy:** malformed/truncated bodies and dictation cannot silently bypass the stated policy.
3. **Complete evidence:** concurrent requests and eligible pre-stop batches are retained or explicitly marked incomplete.
4. **Real boundaries:** paused/stopped sessions do not collect later activity; ring authorization stays separate.
5. **Truthful reports:** narrative, environment, duration, omissions and privacy decisions agree across representations.
6. **Usable handoff:** recipients can understand the report without an account, extension, or an explanation from its author.

## 9. Non-goals and references

Defer a full video editor, webcam effects, mandatory hosting/accounts, generic AI summaries, and compulsory side-panel UX. Preserve the local report workflow. Optional integrations should follow demonstrated demand and must not undermine the privacy model.

Architecture references:

- [Scott Wlaschin: Making illegal states unrepresentable](https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/)—use types to encode actual business rules rather than arbitrary combinations of optional values.
- [Gary Bernhardt: Functional Core, Imperative Shell](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell)—pure decisions surrounded by explicit I/O.
- Existing repository context: [request replay](request-replay.md), [ring implementation](always-on-ring-implementation.md), [guide](../../GUIDE.md), [privacy policy](../../PRIVACY.md).

The architecture is a means to enforce the release gates, not the deliverable by itself. Success is observable user behavior: capture does what its controls say, stopping really stops, sensitive data is handled predictably, and the resulting report helps someone fix the bug.
