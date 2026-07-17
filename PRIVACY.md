# Privacy Policy — Browser Recorder

_Last updated: 2026-07-17_

Browser Recorder is a bug-reporting capture tool. This policy explains what the
extension does and does not do with your data.

## The short version

**Browser Recorder does not collect, transmit, or share any of your data.**
There is no server, no account, and no cloud component. The extension makes no
network requests of its own. Everything it captures stays on your device until
you explicitly export it.

## What the extension captures

While you run a capture session (or with the always-on ring buffer enabled), the
extension records data from the tabs you record:

- Console messages and uncaught errors
- Network requests and responses (headers and bodies)
- WebSocket and Server-Sent Events frames
- User interactions (clicks, inputs, navigations) and element metadata
- DOM snapshots
- Screenshots you take, and optional tab video
- The list of your installed extensions (noted in the report metadata so a bug
  report records what else was running)

## Where that data goes

Captured data is held locally — in the browser's local extension storage and in
memory — for the duration of a session. When you choose **Export**, it is written
to a `.zip` file that you save to your own computer. That file is created and
controlled entirely by you.

The extension never uploads this data anywhere. It has no backend to send it to.
Before exporting, you can redact or drop sensitive network entries and exclude
large artifacts.

## Data you share is your responsibility

Because the exported `.zip` can contain page content, request bodies, and other
potentially sensitive information, review and redact it before sharing it with
anyone. Once you hand the file to a teammate or attach it to an issue, its
handling is outside the extension's control.

## Permissions

The extension requests broad browser permissions (host access to all sites, tab
access, scripting, tab capture, and others) solely to capture debugging data on
whatever page you are reproducing a bug on. These permissions are used only for
local capture and never to transmit data. Per-permission justifications are
documented in [PUBLISH.md](PUBLISH.md).

## Changes

If this policy changes, the updated version will be published in this repository
with a new "Last updated" date.

## Contact

Questions: open an issue at
<https://github.com/npalladium/chrome-recorder/issues>.
