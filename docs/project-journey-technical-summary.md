# Project Report — Creative Model-Switcher AI Interface

Prepared for company review · Numbase Group, Project 1

## Executive Summary

This report describes the design, implementation, and verification of a desktop AI chat application that lets a user switch between two AI providers — Google Gemini and OpenAI — inside one consistent, glass-styled interface. The application is complete, tested, and packaged for delivery. This document explains what was built, how it works, the main challenges encountered, and how the finished product was verified.

## 1. Project Purpose and Implemented Features

The brief asked for a creative interface that demonstrates switching between AI models while keeping a premium, distinctive visual identity. The delivered application includes:

- **Live chat with two providers.** Gemini and OpenAI both stream real answers through a shared interface, with no visible difference in how a user interacts with either one.
- **In-conversation provider switching.** A user can change providers at any point. If a conversation has already started, the app confirms first, explaining that the whole conversation will be sent to the new provider.
- **Streaming responses,** revealed incrementally with a typing indicator and the ability to stop a response early.
- **Conversation history,** saved in the browser, grouped by recency, renamable and deletable, and restored automatically after a refresh.
- **A glass visual system:** two selectable glass styles ("Glowy Glass" and "Clear Glass") and eight background presets, designed so the interface reads as genuinely transparent rather than a flat card with a blur filter.
- **Safety and reliability details:** provider keys never leave the server, malformed input is rejected clearly, and failures are reported honestly rather than shown as if they succeeded.

Mobile support was intentionally left out of scope so the desktop experience could be finished and verified properly first.

## 2. Development Milestones

1. **Foundation.** The Next.js application was scaffolded with TypeScript, Tailwind CSS, ESLint, and Git, configured to build reliably without remote font downloads.
2. **Desktop visual system.** The workspace layout, sidebar, header, message area, composer, and background picker were built from the approved visual references. The glass material went through several rounds of refinement before reaching its approved, more transparent form.
3. **Live AI chat.** Gemini streaming was connected end to end, with a working Stop and Retry.
4. **Persistence and provider architecture.** Conversation history was made to survive a page refresh, and the backend was restructured so both providers share one internal contract instead of the interface depending on either vendor's API shape.
5. **Verification and hardening.** The finished application was independently reviewed against the brief and against its own packaged output. This surfaced real defects — including a data-loss risk in saved conversation storage, incomplete streamed answers being reported as complete, and a keyboard-focus issue in the provider-switch dialog — all fixed and covered with regression tests.
6. **Final refinement and packaging.** The provider selector's button alignment was made explicit and consistent across every state and screen size, and the project was packaged for delivery.

## 3. Languages, Frameworks, and Tools

**Languages**

- **TypeScript / JavaScript** — the language for both the browser interface and the server code. TypeScript adds type-checking on top of JavaScript, catching mistakes before the code runs.
- **CSS** — used directly, alongside Tailwind's utility classes, for the glass material and layout details that needed hand tuning.

**Frameworks and libraries**

- **React** — the library used to build the interface out of reusable components.
- **Next.js** — the application framework built on React, providing page routing, the server-side API route used for chat requests, and the production build pipeline.
- **Tailwind CSS** — a utility-first CSS framework used for most everyday styling.

**Runtime and tools**

- **Node.js** — the JavaScript runtime the server code and build tooling run on.
- **Git** — used for version control throughout development.

## 4. How the System Works

The application has three cooperating layers — the browser interface, the server route, and the provider adapters — connected by a streaming data format and a local storage layer.

**Frontend.** The browser renders the workspace and sends the user's message to the server. It never talks to Gemini or OpenAI directly and never holds an API key.

**Backend.** One server route (`/api/chat`) receives the request, checks which provider was selected, and hands the conversation to that provider's adapter. The route itself does not know either vendor's API details.

**Provider adapters.** Each adapter knows how to call its own vendor's API and read that vendor's specific streaming format, converting the response into one shared internal shape. This is what makes switching providers a matter of changing a setting rather than rewriting the interface.

**Streaming.** As the AI generates its answer, the server forwards it to the browser as a stream of small events instead of waiting for the whole answer. The browser reveals the text progressively, so the user sees the answer being written. The stream always ends with an explicit outcome — completed, cut short, stopped, or failed — so a dropped connection is never mistaken for success.

**Local conversation storage.** The app saves conversations to the browser's local storage after every meaningful change and restores them on the next visit. If saved data is unreadable or in an unrecognized format, it is left untouched and the app continues in memory for that session, rather than risking an overwrite.

The path for one message is: user input → conversation state → the `/api/chat` route → the selected provider's adapter → the provider's API → a normalized stream back to the browser → updated message state → saved to local storage.

## 5. Main Challenges and Solutions

**A genuinely transparent, readable glass surface.** A translucent panel can easily look like a flat card with a blur filter rather than real glass. This took several rounds of iteration: removing a uniform fill, adding a directional edge highlight instead of a flat border, and choosing backgrounds with enough visible detail that transparency is actually noticeable. The final interior photograph background was specifically used to validate this — a genuinely transparent surface should show real depth through it while message text stays easily readable. That photograph was a design-validation reference, not a separate business requirement.

**Message motion.** The first version of the entrance animation and the streamed-text reveal worked correctly but felt too abrupt. Both were slowed and reshaped so new messages settle in gently and answers appear at a natural, readable pace.

**Slow dependency downloads.** Early setup had to account for a slow connection, which meant avoiding remote font downloads during the build and keeping dependencies deliberately small — for example, a small local Markdown renderer instead of a larger third-party library.

**Provider quotas and errors.** Both providers can fail in vendor-specific ways: an invalid key, an exhausted quota, a billing problem, a temporary outage. These were mapped to one honest set of user-facing error states, tested against realistic recorded error responses so the interface never claims success when a request actually failed.

**Persistence reliability.** Saved data can become corrupted, or storage can fill up. Both cases were tested and handled so a storage problem degrades gracefully — the session keeps working in memory — instead of silently losing saved history.

**Reliable, repeatable testing.** Because the application depends on real AI providers, most testing had to happen without spending real quota. The project uses two layers: a fast automated suite that exercises server logic and adapters against recorded, realistic responses, and a separate real-browser harness that drives the actual interface with every provider request mocked, with an independent check confirming no real network request can slip through if that mock is ever missing.

## 6. AI-Assisted Development Process

AI tools were used throughout as working assistants, under continuous human direction.

**Claude Code** acted as the primary implementation partner — writing and editing the application code, running the test suite, driving the real-browser checks, and working through bug fixes interactively, inspecting existing code before changing it and verifying each change against the project's tests.

**ChatGPT / Codex** was used separately for planning and independent review. At several points, it reviewed the delivered code and its packaged output against the original brief, without seeing Claude Code's own reasoning, and reported concrete, verifiable defects — for example, a real data-loss condition in storage handling, and a case where the provider-switch dialog's own background overlay could intercept a click meant for its buttons. Each reported issue was independently re-verified against the actual code before anything changed, and every fix was covered by a new test or a real-browser check.

Throughout, the project owner made every design and scope decision: the glass material and backgrounds, how the motion should feel, which providers to support, that mobile would wait, and what the final delivery should contain. AI tools implemented and reviewed the work; the human owner directed it and gave the visual feedback that shaped it.

## 7. Key Technical Concepts Applied

- **Provider abstraction** — both AI providers are accessed through one shared internal interface, so the rest of the application does not need to know which vendor is active.
- **Stream normalization** — each provider's response format is translated into one consistent shape, with an explicit, confirmed outcome for every stream rather than assuming silence means success.
- **Versioned local persistence** — saved data includes a version marker, so the app can recognize data it does not understand and avoid overwriting it.
- **Server-side secret handling** — API keys are read only on the server and never reach the browser or the client-side code bundle.
- **Progressive rendering** — streamed text is revealed in small, paced steps while still respecting formatting boundaries, such as not splitting a code block mid-line.
- **Accessible keyboard interaction** — dialogs trap keyboard focus while open and correctly return it when closed.
- **Layered, reproducible testing** — a fast, network-free suite covers logic, and a real-browser suite verifies the interface, both without spending provider quota.

## 8. Verification, Limitations, and Setup

**Verification performed.** The delivered application passes its full automated test suite, a clean linting pass, a clean TypeScript check, and a successful production build. A separate real-browser suite confirms the interface itself — including provider switching, keyboard accessibility, and conversation-limit and error-handling behavior — with every provider request mocked and a network-level check confirming no real request can reach a provider by accident.

**Current limitations.**

- Live provider error conditions (an invalid key, an exhausted quota, a billing failure) are verified against realistic recorded responses rather than the real services, since deliberately provoking them would risk real account impact.
- Mobile and small-screen layouts are out of scope for this delivery, by design.
- Conversation history is stored per browser and is not synchronized across devices or backed by a server-side database.

**Setup instructions for the reviewer.**

```bash
npm install
cp .env.example .env.local     # add your own Gemini and/or OpenAI key
npm run dev                    # then open http://localhost:3000
```

No credentials are included in this delivery. A working Gemini key is free to obtain and requires no billing setup. Without any key configured, the application still runs and shows an honest setup message rather than simulating a response.

## Conclusion

The project delivers a working, verified desktop AI workspace that lets a user switch between two real AI providers inside one distinctive, genuinely transparent glass interface. It includes a tested provider abstraction, honest streaming and error handling, resilient local persistence, and a reproducible testing approach — built collaboratively with AI assistance and directed throughout by the project owner's own decisions and visual review.
