# Taxi Reserve Assistant Mobile QA

This runbook covers the Phase 1B.1 mobile shell, the Phase 1C.2 read-only reservation stream, and the Phase 1D ADMIN-only read-only driver/finance stream. It does not validate write actions or later-phase capabilities because none are connected.

## PWA finding

Taxi Reserve does not currently include a web app manifest, service worker, or standalone-display configuration. iOS standalone/PWA testing is therefore **not applicable** to Phase 1B.1. The assistant does use `viewport-fit=cover` so safe-area insets work in ordinary mobile browsers; this does not add PWA support.

## Automated and browser-supplemental evidence

| Check | Status | Evidence |
| --- | --- | --- |
| Viewport fallback, offsets, keyboard inference | VERIFIED | `npm run test:assistant-mobile` |
| Bounded textarea sizing | VERIFIED | `npm run test:assistant-mobile` plus narrow browser layouts |
| Blank, busy, duplicate-draft, and synchronous-lock guards | VERIFIED | `npm run test:assistant-mobile` |
| IME/keyCode 229 and fine/coarse-pointer Enter behavior | VERIFIED | `npm run test:assistant-mobile` |
| Near-bottom threshold and jump-to-latest | VERIFIED | Unit test plus browser interaction |
| Typed SSE framing, status, text, cards, completion | VERIFIED | `npm run test:assistant-streaming` |
| Stop/partial preservation, network failure, retry reset | VERIFIED | `npm run test:assistant-streaming` plus transport cancellation tests |
| Tool selection, tool limits, strict runtime validation | VERIFIED | `npm run test:assistant-tool-loop` |
| Driver/finance authorization and Decimal DTOs | VERIFIED | `npm run test:assistant-driver-finance` |
| Five-tool loop and permission-safe finance failures | VERIFIED | `npm run test:assistant-driver-tool-loop` |
| Rate limit, cancellation release, cost caps, headers, telemetry, dependency smoke | VERIFIED | `npm run test:assistant-production` |
| Open/close, scroll lock restoration, draft preservation | VERIFIED | Browser interaction |
| Narrow reservation card and long-address wrapping | VERIFIED | Browser screenshots at target widths |
| Driver, ledger-summary, and transaction card wrapping | VERIFIED | Browser measurements at 320×700, 375×812, and 430×932; no card/dialog horizontal overflow |
| Physical virtual-keyboard positioning | NEEDS PHYSICAL DEVICE | Emulation cannot prove iOS/Android keyboard behavior |

The in-app Chromium supplemental pass verified 320×568, 360×800, 375×812, 390×844, 393×852, 412×915, and 430×932. Every size matched the visible viewport, retained a reachable 44×44 close/send target, kept the composer at the bottom, and had no document-level horizontal overflow. A 390×844 → 844×390 → 390×844 cycle also recovered without stale dimensions or gaps. Chromium emulation reports a fine pointer and cannot prove coarse-pointer soft-keyboard behavior; that path is covered by unit logic and still requires physical-device verification. No WebKit test runtime is installed in this repository, so WebKit emulation was not falsely claimed.

## Physical-device matrix

| Target | Required checks | Status |
| --- | --- | --- |
| Modern iPhone Safari with Dynamic Island | Portrait, landscape, repeated keyboard cycles, browser chrome expanded/collapsed, notch/Home Indicator, close while keyboard open | NEEDS PHYSICAL DEVICE |
| Narrow iPhone Safari | 320–375px-equivalent layout, long draft, large text, long result card | NEEDS PHYSICAL DEVICE |
| iOS standalone/PWA | Standalone keyboard and safe-area behavior | NOT APPLICABLE — no PWA support exists |
| Modern Android Chrome | Portrait, landscape, repeated keyboard cycles, predictive text, dictation, background/foreground | NEEDS PHYSICAL DEVICE |
| VoiceOver on iPhone | Dialog title, close/send/stop/retry labels, reading order, restrained announcements | NEEDS PHYSICAL DEVICE |
| TalkBack on Android | Dialog title, controls, reading order, disabled and error states | NEEDS PHYSICAL DEVICE |

## Physical failure-mode run sheet

First use a development build with `AI_ASSISTANT_ENABLED=true` and `AI_ASSISTANT_PREVIEW=true` for layout-only checks. For stream/Stop/network checks, use a non-production environment and a dedicated test account with disposable reservation records; set preview false and configure a non-production OpenAI key/model. Do not point these tests at production data.

1. Open the assistant and confirm the background is inert and stationary.
2. Tap the composer; open, close, and reopen the keyboard at least five times.
3. Collapse and expand Safari/Chrome browser chrome while the keyboard is closed and open.
4. Confirm the composer remains directly above the keyboard without a blank gap or Home Indicator collision.
5. Send a short fixture message with the send button.
6. Enter multiline text with mobile Return; send it with the button.
7. Paste a very long message and confirm the textarea caps and scrolls internally.
8. Double-tap Send and combine a hardware-key Enter with a tap; confirm one accepted message.
9. Select the generating fixture, scroll upward, and confirm new resizing does not pull the transcript down.
10. Use Jump to latest and confirm automatic following resumes.
11. Rotate portrait → landscape → portrait with the keyboard closed.
12. Repeat rotation with the keyboard open and confirm no stale blank area remains.
13. Close while the keyboard is open, confirm the underlying page returns to its original scroll position, then reopen and confirm the draft remains.
14. Background and foreground the browser with the assistant open and with the keyboard open.
15. Exercise failed, retry, and stopped fixtures; confirm the transcript and draft remain intact.
16. Increase system/browser text size and verify controls remain reachable without horizontal scrolling.
17. Test VoiceOver/TalkBack reading order and confirm status changes are announced once rather than token-by-token.
18. Verify long addresses, the long response, and the long-conversation fixture at the narrowest available width.
19. Pull and rubber-band the transcript at both ends; confirm the underlying Taxi Reserve page is never revealed or scrolled.
20. On a throttled connection, send a read-only reservation question; confirm the user bubble and real status appear immediately and streamed text remains smooth.
21. While text is streaming, scroll upward; confirm the transcript does not fight the user. Use Jump to latest and confirm following resumes.
22. Stop before the first token, during text, and after reservation cards appear; confirm partial content remains, one Stopped label appears, no error is shown, and the composer immediately unlocks.
23. Switch Wi-Fi/mobile connectivity off during a stream; confirm partial text/cards and the user bubble remain, one recoverable error appears, and the page does not refresh.
24. Restore connectivity and tap Retry; confirm there is no duplicate user bubble or duplicate card, and that a fresh request completes in the same assistant turn.
25. Open a reservation card link and navigate back; confirm the root-mounted provider retains the transcript and draft.
26. Background and foreground during a slow stream and after network loss; confirm no stuck status or permanently locked composer.
27. Repeat slow-stream, Stop, Retry, and network-switch checks with VoiceOver/TalkBack; confirm statuses are restrained and token deltas are not announced individually.
28. As ADMIN, test driver search, a positive due balance, a settled balance, a negative credit, and duplicate long driver names; confirm status/vehicle text and amounts remain readable at the narrowest width.
29. Open driver and reservation links from structured finance cards, navigate back, and confirm the root provider retains transcript, draft, and scroll behavior.
30. Stop during a driver transaction query and retry after a simulated finance-query network failure; confirm partial cards remain on Stop, retry does not duplicate cards, and USER accounts receive no driver-existence signal.

Automated tests verify state/protocol behavior, but real radio switching, physical virtual keyboards, mobile browser lifecycle suspension, VoiceOver, TalkBack, and device-specific stream timing remain unverified until this matrix is executed on physical hardware.
