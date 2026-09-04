# ChatVerse Interface System

## Direction and feel

- Product metaphor: a paper-and-ink world-building workbench, not a generic SaaS dashboard.
- Experience words: calm, literary, navigable, deliberate, lightly archival.
- Domain vocabulary: world, entrance, route, signal, scene, curtain, narrative node, archive.
- Signature pattern: **route nodes**. Multi-step journeys appear as a restrained route with one current signal, completed nodes, and a clear destination.
- Color world: white paper, pale moss, black ink, faded graphite, old copper, night-stage green, teal signal lamp.
- Avoid decorative gradients, floating bubble tours, full-screen forced walkthroughs, celebration confetti, and unrelated accent colors.

## Foundations

- Spacing base: 4px. Use 8 / 12 / 16 / 20 / 24 / 32 for normal component and section rhythm.
- Density: workbench-tight inside controls (8–16px), calmer around reading content (20–32px).
- Depth strategy: quiet borders plus one restrained layered shadow only for genuinely floating surfaces. Do not turn every card into an elevated panel.
- Radius scale: 5px controls, 7–8px cards and floating guides, 12px mobile bottom sheets.
- Primary palette uses the existing semantic tokens: `--surface`, `--surface-subtle`, `--surface-inset`, `--ink`, `--ink-secondary`, `--ink-tertiary`, `--line`, `--line-strong`, `--signal`, and `--signal-soft`.
- Teal signal is scarce: current state, focus, route progress, and meaningful links. Primary completion actions remain ink-black.
- Typography: Noto Sans SC for functional copy, Songti/serif for narrative headings, IBM Plex Mono for route labels, counters, and metadata.
- Hierarchy ratio: approximately 1.25. Typical guide scale is 10px mono eyebrow, 12px/20px supporting copy, 20px/27px serif title (18px/25px on mobile).
- Interactive targets are at least 40px high; use 44px when controls are primarily mobile.

## Guided journey pattern

Use the shared `GuidedTour` and `GuideLauncher` components. Do not create page-specific tour overlays.

### Structure

- Desktop guide: fixed bottom-right, 360px maximum width, 8px radius, 24px viewport inset.
- Mobile guide: 12px side inset and positioned above the persistent mobile navigation.
- Header: 58px minimum height, route mark, chapter label, tabular `current / total`, and a 40px close target.
- Route: 3px segmented line. Completed segments use muted signal; current segment uses full signal plus a soft ring.
- Content: 20px padding, one eyebrow, one balanced serif title, one short explanation.
- Footer: 56px minimum height, back/next controls, one ink-black primary action.
- Entrance motion: 220ms `cubic-bezier(.23, 1, .32, 1)`, translate and opacity only. Disable movement for `prefers-reduced-motion`.

### Target behavior

- Anchor every step to a real semantic control or region through `data-guide` selectors.
- Scroll the target into view, then apply a 2px signal outline with a soft 8px halo.
- Highlighting must never change the target's `position`, dimensions, sticky behavior, or document flow.
- Keep the rest of the page usable. The guide is a non-modal `dialog`; Escape dismisses it.
- Never use a dark full-page mask for ordinary product guidance.

### Trigger and persistence

- Auto-open only when a chapter is still `pending`.
- Persist chapters independently with `pending`, `dismissed`, and `completed` states.
- Dismissal means “acknowledged for now,” not completion.
- Completion should correspond to a real outcome when possible: model setup completes only after a successful save/test.
- Always provide a stable launcher so the user can replay a chapter.
- First-run world guidance waits until required entry setup is complete; never stack two onboarding layers.

### Current chapter sequence

1. Home / world creation: try a runnable template → browse alternatives → create from scratch → route to model setup.
2. Model setup: provider → endpoint/model ID → API key → real connection test and save.
3. First world: world navigation → story stream → composer → plot/character inspector.

## Route rail pattern

For a process that benefits from persistent progress visibility, use the route rail instead of relying only on floating steps.

- Four-step desktop rail: equal columns, 16px container padding, 8px gaps, 30px circular nodes.
- Current node: signal border and 4px soft ring.
- Completed node: solid signal fill with a white check.
- Mobile: switch to a 2×2 grid; remove the horizontal connector; align node and label horizontally in each cell.
- A rail communicates state; it does not replace validation, error, loading, or success feedback.

## Consistency checks

- One focal action per guide step.
- No guide copy longer than a short paragraph.
- Every chapter has skip/dismiss, back when applicable, and replay.
- Verify desktop and 390px mobile layouts, including overlap with sticky headers, sidebars, bottom navigation, and safe areas.
- Run the squint test: the target and primary action lead; borders and route decoration stay quiet.
