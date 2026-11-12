# MGA design system

Reference implementation: `frontend/src/app/page.tsx` (home), `src/components/ui.tsx`, `src/app/globals.css`. Match it.

## Principles (Apple-style clarity, editorial confidence)
1. **Key information first.**
   - **Size:** the one number or answer a page exists for is the largest thing on it, e.g. readiness "69%" at 6–9rem.
   - **Weight:** supporting text is small (`muted`, 13px) and light (`lede`, 17px, weight 300).
2. **Big headlines, small support.** Use the type scale only:
   - `display` (home only), `headline` (page titles), `title` (section heads);
   - `text-xl` semibold (card heads), `text-[0.9375rem]` (body), `muted` (support), `eyebrow` (labels).
   - Don't invent other sizes.
3. **Contrast in pairs:**
   - bold with light: a headline plus a `font-extralight text-stone-400` second line;
   - large with small: a huge numeral with an eyebrow label;
   - light with dark: Whiteout pages with one Black Stone `surface-dark` block per page at most.
4. **One typeface:** Geist (the `--font-sans` variable). Vary weight (200–700) and tracking: tight on large type (-0.03 to -0.05em), wide on eyebrows (0.18em uppercase). Never use a monospace font for UI text.
5. **Grouping and space:**
   - Related items sit inside one `card` or `panel`.
   - Sections are separated by `space-y-16`/`space-y-24`, or by `<Section>` (top rule plus index number).
   - Inside a card use `p-6 sm:p-8` and `space-y-4`.
6. **One unexpected move per page:** an asymmetric 12-column grid (7/5 or 5/7, offset with `lg:mt-24`), an oversized cropped numeral, a slightly rotated close-up card, the `GapGlyph` graphic cropped off an edge, or a big faded index number ("01").
7. **Images are the product:** we use no stock photos. The visual is a close-up crop of real UI (report rows, level bars, readiness) or the `GapGlyph` metaphor (filled block, dashed Nitro gap, Royal goal).

## Colour
- **Whiteout** `bg-whiteout`: the page background.
- **White** `bg-white`: card surfaces.
- **Black Stone** `text-stone` / `bg-stone`: text, primary buttons, dark blocks.
- **Stone scale** for secondary text: `text-stone-600` body-secondary, `text-stone-500` muted, `text-stone-400` light accents and indices.
- **Fusion** `ring-fusion`, `bg-fusion-50`: lines, quiet panels.
- **Royal Blue**: links, focus, "strong", the accent button (`btn-accent`). Use it sparingly.
- **Nitro Orange**: the one highlight per view (the gap, the `%`, a dot in the eyebrow), "partial".
- **Redline**: missing, must-have, destructive actions only.
- **Status colours:** `STATUS` in `ui.tsx` (Royal = strong, Nitro = partial, Stone = transferable, Redline = missing). Don't use slate, indigo, emerald, amber, rose or sky.

## Components and utilities
- **Buttons:** `btn-primary` (black pill) for the main action, `btn-accent` (royal) for a secondary emphasis, `btn-ghost`, `btn-quiet`, `btn-danger`.
- **Forms:** `input`, `label`.
- **Surfaces:** `card` (white, rounded-3xl, soft shadow), `panel` (fusion-50), `surface-dark`.
- **Labels:** `chip` for small pills.
- **From `ui.tsx`:** `PageHeader` (eyebrow, headline, light accent line, lede, optional aside), `Section`, `Stat`, `ReadinessRing` (`tone="dark"` on Black Stone), `LevelBar` (draws the gap hatched in Nitro), `StatusChip`, `ImportanceChip`, `GapGlyph`, `ErrorBox`, `Spinner`.

## Interaction
- **Radius:** full for buttons and chips, 2xl for inputs, 3xl for cards.
- **Hover:** subtle (a ring darkens, an arrow nudges). The `rise` animation is for page headers only.
- **Accessibility:**
  - keep every label, `aria-*` and role;
  - visible focus (royal ring);
  - colour is never the only signal (chips carry text);
  - contrast AA at minimum: `text-stone-400` only for large or decorative text.
