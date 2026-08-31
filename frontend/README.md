# Nett Games 2.0

A static, single-page frontend for a games portal. Three files, no build
step, no framework — just `index.html`, `style.css`, and `app.js`, driven
entirely by `config.yaml`. Push a new `config.yaml` and the site updates;
no HTML edits needed for new games, themes, or the announcement.

## Deploying

Drop all four files (`index.html`, `style.css`, `app.js`, `config.yaml`)
into your GitHub Pages repo root (or a subfolder, as long as they stay
together). That's it — GitHub Pages serves over HTTPS, which is required
for `fetch()` to read `config.yaml`.

**Note:** opening `index.html` directly from disk (`file://…`) will not
work — browsers block `fetch()` on local files. Test locally with any
static server, e.g. `python3 -m http.server` from this folder, then visit
`http://localhost:8000`.

## Editing `config.yaml`

```yaml
announcement:
  enabled: true
  text: "Your message here."

games:              # Nett's own games only — see LuminSDK section below
  - title: "Game Name"
    image: "data:image/png;base64,...."
    url: "https://your-game-url.example.com"

themes:
  - name: "Theme Name"
    mode: dark               # "dark" or "light"
    accents: ["#4c1d95", "#6d28d9"]   # 1 or 2 hex codes
```

- `image` accepts any `data:` URI (SVG, PNG, JPG). If you'd rather not
  inline images, you can also point it at a normal image URL.
- `accents` takes one or two hex codes. Two gives the UI a subtle
  gradient; one just uses that color for both accent slots.
- Everything under `games` and `themes` is validated and skipped if it's
  missing a required field, so a typo in one entry won't break the rest
  of the site.

## Icons

Make an `icons/` folder next to `index.html` and drop files into it
named exactly like this (`.svg` or `.png`, either works):

| Filename            | Used for                          |
| -------------------- | ---------------------------------- |
| `icons/logo.svg`     | Sidebar logo                       |
| `icons/nav-games.svg`  | "Games" sidebar nav item         |
| `icons/nav-themes.svg` | "Themes" sidebar nav item        |
| `icons/megaphone.svg`  | Announcement banner               |
| `icons/search.svg`    | Search bar                         |
| `icons/save.svg`      | Save button                        |
| `icons/download.svg`  | "Save to file" in the save modal   |
| `icons/upload.svg`    | "Load from file" in the save modal / welcome prompt |

That's it — no HTML or CSS edits needed. `app.js` checks for each file
on load (`.svg` first, then `.png`) and fills the matching slot in;
anything not found just stays blank, same as before you add icons.

Every icon except the logo is applied as a CSS mask rather than a plain
image, so a simple monochrome SVG automatically tints to match its
surroundings (dimmed sidebar text, white active-nav text, etc.) and
re-tints correctly if you switch themes — no need for separate light
and dark versions. The logo is the one exception and renders as a
normal `<img>`, so it keeps its own colors. If you want any *other*
slot to keep its own colors instead of being tinted, add its name to
the `ICON_KEEP_COLOR` set near the top of the icon-loading section in
`app.js`.

## LuminSDK integration

The game switcher has exactly two options, Nett and LuminSDK. Nett's
list comes from `config.yaml`; LuminSDK's list is pulled live from
LuminSDK's own catalog, so nothing needs to be duplicated into the yaml.

This uses LuminSDK's [headless mode](https://docs.luminsdk.com/headless/),
which gives API access to their catalog/search/launch without rendering
their built-in grid UI — so it can be dropped straight into our own
card layout and theme. The SDK script tag is already in `index.html`:

```html
<script src="https://cdn.jsdelivr.net/gh/luminsdk/script@latest/lumin.min.js"></script>
```

In `app.js`, the first time someone opens the LuminSDK tab:

1. `Lumin.init({ headless: true })` — initializes the SDK without its UI.
2. `Lumin.getGames({ page, limit })` — paginated through (capped at 20
   pages of 48 games, i.e. up to 960 games, so a huge catalog can't stall
   the page or flood it with image requests — raise `LUMIN_MAX_PAGES` /
   `LUMIN_PAGE_SIZE` at the top of the LuminSDK section in `app.js` if
   you need more).
3. `Lumin.getImageUrl(game.image_token)` — resolved for every game
   concurrently (`Promise.all`) to get real thumbnail URLs.

The result is cached in memory, so switching tabs back and forth after
that first load doesn't re-fetch. Searching filters the cached list
client-side, same as Nett's games, so typing is instant either way.

Clicking a LuminSDK game calls `Lumin.getGameUrl(game.id)` **at launch
time** (its docs note these URLs are single-use and can't be cached),
and the returned URL is dropped into the same `about:blank`-cloaked
window and iframe that Nett games use — so both sources launch and
focus identically from the user's side.

If LuminSDK's script fails to load or its catalog request errors out,
the grid shows a plain "couldn't load" message instead of breaking the
page, and normal Nett browsing is unaffected.

## Save / load

The Save button exports the site's entire `localStorage` (theme choice,
source filter, etc.) as a single JSON file, and can load one back in,
overwriting whatever's currently stored. New visitors are asked once,
on their first visit, whether they'd like to load a save file instead of
starting fresh.

## Fixed: overlay blocking the whole page

Earlier versions of `style.css` set `.modal-overlay { display: flex }`
with nothing to override it when the element's `hidden` attribute was
set. Both rules have the same CSS specificity, and the author rule was
declared after the browser's built-in `[hidden] { display: none }`
rule, so it won — meaning the overlay stayed visually on screen (and
kept eating every click) even when JS had correctly marked it hidden.
Fixed by adding an explicit `.modal-overlay[hidden] { display: none }`
rule after it. If you copy the overlay pattern elsewhere, keep that
pairing in mind: any element you toggle with `.hidden = true/false`
needs its `[hidden]` selector to win the cascade, not just be present.

## Performance notes

Backdrop blur (the "glass" look) is only applied to a handful of static,
non-scrolling panels — the sidebar, the announcement bar, modals, and
the toast. The game and theme grids use plain translucent fills instead,
since blurring dozens of small cards is what actually costs frame time
on low-power hardware like Chromebooks. Images lazy-load, search input
is debounced, and there's no JS framework or build tooling in the
critical path.

The site does load `js-yaml` from a CDN (cdnjs) to parse `config.yaml` —
this is the one external dependency. If you'd rather have a fully
offline-capable, zero-dependency page, you'd need to either vendor that
one file into the repo or swap `config.yaml` for a `config.json`/inline
`<script>` object and drop the YAML parser entirely.
