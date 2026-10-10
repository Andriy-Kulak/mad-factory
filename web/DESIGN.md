# Web design principles

The web app is an internal tool used every day. It should feel instant and obvious, and stay consistent as several
agents add screens. `/ui` shows every component live.

## Feel
- **Instant beats clever.** A click shows its result within a frame. Load a screen's data once on the server, then
  filter, sort and page in the browser (`useMemo` over the full list). Never make a filter change wait on the
  server: in dev that took 4–7 s per click.
- **The URL follows state.** `useUrlState(query)` replaces the query string without a round trip, so any view can be
  shared or reloaded. Parse it once on the server (`parse*Filters(searchParams)`) for the first render.
- **Everything you open can be closed the obvious way.** Popovers close on Esc, a click outside and a Done button,
  and give focus back. Modals close on Esc, × and a backdrop click. No bare `<details>` used as a dropdown.
- **Filters apply live.** No "Apply" buttons. Text inputs debounce (`DraftInput`, 250 ms). Presets as chips come
  first and min/max inputs below them. Every active filter shows as a removable chip with "Clear all".
- **Load what the screen shows, fetch the rest on demand.** Grids ship slim rows (JSON-path selects); a preview
  loads the heavy part (transcripts, full breakdowns) through a server action when it opens. Never render hundreds
  of `<video>` elements at once.
- **Long pages become tabs.** When one screen holds several jobs (Apple ads: overview, experiments, keywords),
  split it with `Tabs` instead of stacking everything; collapse logs to the latest entries.
- **Previews before navigation.** Clicking a card opens a Modal with the media and every number, and ← → steps
  through the current list. Cmd/ctrl-click still opens the link (`previewClick`).
- **Show something immediately.** Every route has a one-line `loading.tsx` (`PageSkeleton`) shaped like the page. Long lists render
  as you scroll (`useInfiniteList` + `LoadMore`).

## Look
- Dark chrome around a light workspace. Lime (`--signal`) marks the one primary action per view and active
  selections; olive (`--accent`) is the data accent. Tokens live in `app/globals.css`.
- Geist for text, Geist Mono (`.num`) only for numbers. Sentence case.
- Show content the way it looks where it lives: an ad as a feed ad (page, run dates, primary text, media, link bar
  with CTA), a reel as a 9:16 tile. Metrics go in small pills under the media.
- Tables group by meaning, not by field. One name cell carries identity: status dot, thumbnail, name, and a dim
  line with parents or headline (ids go in the tooltip). Metrics pair a count with its rate or cost underneath
  (`Pair`), and a metric that is zero on every row is left out. `DataTable dense stickyFirst` for wide tables.
- Motion is short and functional (120/180/280 ms) and always respects reduced motion.

## Building a screen
1. One component library, used before writing new markup (`/ui` shows every piece):
   - `components/ui.tsx`: static pieces (Card, Stat, Badge, StatusDot, Segmented, Tabs, NameCell, Pair, Table).
   - `components/controls.tsx`: interactive browse pieces (BrowseLayout, FilterSection, MultiSelect, Chips,
     RangeFilter, SearchInput, Toggle, ActiveFilters, ResultsBar, NoMatches, Modal, useUrlState, useInfiniteList).
   - `components/media.tsx`: Media, HoverVideo, PreviewPane, MediaTag for any grid or preview of ads and posts.
   - `components/data-table.tsx`: every table (sort, `dense`, `stickyFirst`, `views`, `searchLabel`, row `onClick`).
   - `components/skeleton.tsx`: PageSkeleton, so every route's `loading.tsx` is one line.
   Tabs don't have to look alike; they have different data. They should be built from the same pieces.
2. Put filtering, sorting and URL parsing in a pure `lib/*-filters.ts` or `lib/*-cards.ts` module with a colocated
   test. Browse components only wire state to it.
3. Component classes (`.btn`, `.card`, `.control`) sit in `@layer components`, so Tailwind utilities (`hidden`,
   `w-full`) override them. Don't add unlayered component CSS.
4. If a new piece is reusable, add it to `controls.tsx` or `ui.tsx` and to `/ui` in the same PR.
