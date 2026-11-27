# Art Frames layouts

Premade layouts for [Art Frames](https://github.com/brianmuse/art-frames). Art Frames shows art and live content on a Samsung The Frame TV. Each layout here renders one HTML page that Art Frames turns into a TV image. This repository is separate from the Art Frames host.

The layouts:

- `morning`: calendar and weather over the day's artwork. This is the default layout.
- `news`: date, weather and top headlines over the artwork.
- `photos`: photos from a Google Photos shared album.
- `weather`: just the weather over the artwork. Today first, then the week.

## Quick start

To install the layouts on your TV, set up Art Frames first. Art Frames builds and runs the layouts in this repository for you. See [Install](#install) and the host guide [docs/layouts.md](https://github.com/brianmuse/art-frames/blob/main/docs/layouts.md).

For now, these layouts need a [source install of Art Frames](https://github.com/brianmuse/art-frames/blob/main/docs/cli-deployment.md). The install file runs only the starter website.

To work on one layout on your computer, you need Node.js 22.23.4 or later:

```sh
cd layouts/morning
npm ci
npm run dev
```

Then open `http://127.0.0.1:4321/?data=sample`. Each layout section below lists its preview options. Run `npm test` in the layout folder to build it and run its tests.

`catalog.json` lists the layouts and names a default. Art Frames installs every layout in the catalog. The default, `morning`, is the first layout: a TV with no chosen layout shows it. `morning` is an Astro calendar and weather dashboard over the art that Art Frames selects. Each `layouts/<id>/` folder is an independent layout with a `layout.json`, a Dockerfile, source and tests. Users can add their own layout repositories with the same package contract. There is no marketplace UI.

Art Frames owns TV access, capture, refresh/wake and optional artwork context. Layouts own their integrations, content schedule, page design and settings definitions. A site with no weather has no weather dependency.

## Contributing

**Share your layouts.** Did you build a layout that other households could use? Send it here, and every Art Frames install gets it. Open a **New layout proposal** issue first, then follow [CONTRIBUTING.md](CONTRIBUTING.md). It lists what makes a good shared layout, the steps and the checks. Fixes to the existing layouts are welcome too.

Report problems with Art Frames itself in [art-frames](https://github.com/brianmuse/art-frames/issues).

## Write a layout

A layout is a trusted HTTP server in a container. Art Frames sends it a JSON snapshot. The layout returns one complete HTML page. Art Frames renders that page to a 3840×2160 JPEG and sends it to the TV.

This section describes what the host code does today. The sources are `art_frames/layouts.py`, `art_frames/apps.py`, `art_frames/site.py`, `art_frames/controller.py`, `art_frames/site_service.py`, `compose.base.yaml`, `compose.static.yaml`, `renderer/static_capture.py` and `scripts/install-layout.py` in the Art Frames repository. Use `layouts/morning` as the reference layout.

### Add a layout to the catalog

1. Choose an ID. It must match `^[a-z][a-z0-9-]{0,63}$`.
2. Create `layouts/<id>/` with a `layout.json`, a `Dockerfile`, your source and tests.
3. Make the server listen on the Unix socket `/run/dayframe-site/site.sock`. See [Runtime](#runtime).
4. Add a `package.json` with a `test` script, and commit `package-lock.json`. CI runs `npm ci` and `npm test` in every `layouts/*` folder.
5. Add an entry to `catalog.json`: `{"id": "<id>", "name": "<same name as layout.json>", "path": "layouts/<id>"}`.
6. Run the checks:

   ```sh
   npm run validate
   npm --prefix layouts/<id> test
   ```

7. Commit. Deploy and the installer read only committed files.
8. Deploy. Art Frames installs every catalog layout, so the new layout needs no install setting. See [Install](#install).

`npm run validate` mirrors the host's manifest rules. It also checks that each catalog ID has a matching `layouts/<id>/layout.json` and `Dockerfile`, and that no layout folder is missing from the catalog. It is stricter than the host on purpose: it rejects some catalogs that the host accepts. It does not check package files, such as symlinks. To run the host's own check, run `.venv/bin/python scripts/install-layout.py --local-repo ../art-frames-layouts --check` from the Art Frames checkout.

### `layout.json`

The host rejects unknown fields. The file must be 50,000 bytes or smaller.

| Field | Type | Default | Rule |
| --- | --- | --- | --- |
| `schema_version` | integer | `1` | Must be `1`. |
| `id` | string | required | `^[a-z][a-z0-9-]{0,63}$`. Must equal the catalog ID. |
| `name` | string | required | 1–100 characters. |
| `description` | string | `""` | Up to 500 characters. |
| `entry` | string | `"index.html"` | Relative path that matches `[A-Za-z0-9_/-]+\.html`. No leading `/`. |
| `network` | string | `"none"` | `none` or `bridge`. |
| `memory_mb` | integer | `256` | 128–1024. Becomes the container memory limit. |
| `artwork` | boolean | `false` | `true` asks for the daily artwork in the snapshot. |
| `settings` | array | `[]` | Up to 30 settings. Keys must be unique. |
| `display_settings` | array | `[]` | Up to 10 per-TV switches. Keys must be unique and must not repeat a `settings` key. |

Each setting has these fields:

| Field | Rule |
| --- | --- |
| `key` | Required. `^[a-z][a-z0-9_]{0,63}$`. Do not use `csrf`, `manifest` or a `clear_` prefix. |
| `label` | Required. 1–100 characters. |
| `type` | Required. One of `text`, `secret`, `choice`, `time`, `checkbox`, `color`, `list`. |
| `description` | Up to 500 characters. |
| `default` | A boolean for `checkbox`. A string for all other scalar types. `choice` needs a listed value. `time` uses `HH:MM`. `color` uses `#rrggbb`. `secret` and `list` take no default. |
| `choices` | Up to 30 strings. Required for `choice`. |
| `fields` | `list` only. 1–8 scalar settings. Keys must be unique and must not be `id` or start with `clear_`. |
| `max_items` | `list` only. 1–12. Default 8. |
| `item_label` | `list` only. 1–60 characters. Default `Item`. |
| `legacy_items` | `list` only. Up to `max_items` rows of `{id, values, copy_from}`. They move old scalar settings into a list on the next save. `copy_from` can fill only `secret` fields. `values` cannot set a secret. |

Each display setting is a switch that the user sets for each TV. Older Art Frames hosts reject a manifest with `display_settings`. Update the host before you install a layout that uses it. It has these fields:

| Field | Rule |
| --- | --- |
| `key` | Required. `^[a-z][a-z0-9_]{0,63}$`. |
| `type` | Required. Must be `boolean`. |
| `label` | Required. 1–100 characters. |
| `description` | Up to 500 characters. |
| `default` | `true` or `false`. Default `false`. |
| `badge` | Up to 30 characters. Art Frames shows it on the TV in **Your TVs** when the TV's value differs from the default, for example `Calendar off`. |

### Runtime

**Container.** The installer copies the first layout to `sites/installed` and builds its `Dockerfile` as the `website` Compose service. Each other layout goes to `sites/apps/<id>` and runs as the `app-<id>` service. See [Several layouts on one host](#several-layouts-on-one-host). The container runs as user `10001:10001` with a read-only root file system, no Linux capabilities, `no-new-privileges`, and a 32 MB `noexec` `/tmp`. `memory_mb` sets its memory limit. Only the HTML/CSS ("static") Compose profiles start layout services.

**Socket.** The layout must serve HTTP on the Unix socket `/run/dayframe-site/site.sock`. It must not open a TCP port. The host connects to that path through a shared volume (`DAYFRAME_DEFAULT_SITE_SOCKET` on the host side). The host does not set any environment variable in the layout container. The morning layout reads `DAYFRAME_SITE_SOCKET` and falls back to the fixed path; its Dockerfile sets `DAYFRAME_SITE_CONFIG` and `DAYFRAME_SITE_STATE` itself. In the Dockerfile, create `/run/dayframe-site` and `/site-state` and give them to user 10001.

**Mounts.**

- `/site-config` is read-only. It holds `config.json` with the saved settings. The file does not exist until the user saves settings once, so apply manifest defaults yourself.
- `/site-state` is writable and private to this installation. It survives restarts.
- No TV token, management password, artwork library or other NAS share is mounted.

**`config.json` shape.** An object keyed by setting key. Checkboxes are booleans. Other scalar settings are strings. A `list` is an array of rows: `{"id": "<row id>", "<field key>": <value>, ...}`. Secret values are stored here as plain text. Read this file only on the server.

### Requests

**Page render.** The host sends `POST /<entry>` with `Content-Type: application/json`. The request body is the snapshot, up to 40 MB:

```json
{
  "version": 1,
  "now": "2026-10-27T07:30:00-04:00",
  "timezone": "America/New_York",
  "display": { "width": 3840, "height": 2160, "id": "3f9c2a7b1e4d8a60" },
  "data": {},
  "render_purpose": "scheduled",
  "refresh_minutes": 15,
  "display_settings": { "show_caption": true },
  "art": {
    "title": "…", "artist": "…", "year": "…", "rights": "…", "source_url": "…",
    "image": "/dayframe-art.jpg",
    "viewport": { "x": 0, "y": 0, "width": 3840, "height": 2160 },
    "image_data": "<base64 JPEG>"
  }
}
```

- `now` is the host's current time in ISO 8601. `timezone` comes from the host settings.
- `data` is the user's generic data object from the host settings.
- `render_purpose`, `display.id` and `refresh_minutes` are described in [Several layouts on one host](#several-layouts-on-one-host). Older hosts may leave out `display.id` and `refresh_minutes`, and may send `render_purpose` only for a preview.
- `art` is present only when `artwork` is `true`, daily artwork is on, and an artwork is chosen. `viewport` is present only when a mat is on. `image_data` goes only to the layout server.
- `display_settings` holds this TV's display setting values, keyed by `key`. Values are always booleans. Art Frames fills in defaults and drops unknown keys. It is present for every installed layout.
- Settings are not in the snapshot. Read them from `/site-config/config.json`.

**Responses.**

| Status | Meaning |
| --- | --- |
| `200` | Rendered. The body must be complete HTML with a `text/html` content type, up to 25 MB. |
| `202` | Still preparing data. The TV keeps its current image. The scheduler tries again on a later pass (it loops every 30 seconds). The preview button polls every 2 seconds for up to 5 minutes. |
| Any other | Failure. The scheduler records "A display update failed" and tries again later. |

**Assets.** The renderer then asks for each resource in the page. The host forwards each one to the layout as `GET /<path>[?query]` on the same socket. The host serves `/dayframe.json` and `/dayframe-art.jpg` itself. A non-200 asset makes the render fail. A `202` on an asset also counts as "still preparing".

### Limits

- Each socket request times out after 20 seconds.
- The whole render must finish within 35 seconds. The renderer process has 25 seconds of CPU.
- Each response is at most 25 MB. All assets in one render share a 64 MB budget.
- One render can make at most about 256 asset requests.
- Pages may load only `http://dayframe.local/...` URLs and inline `data:` JPEG, PNG or WebP images. All other URLs fail.

### Static renderer

Installed layouts render with WeasyPrint and PDFium. There is no browser.

- JavaScript does not run. Render everything on the server.
- The page is forced to 3840×2160 px with no margin. The content must fit on exactly one page, or the render fails.
- Bundle fonts and images as local assets.
- With a mat, Art Frames keeps only the pixels inside `art.viewport` and restores the mat from the artwork. Keep your content inside the viewport.

### Network and secrets

- `network: "none"` gives the layout no network. `network: "bridge"` gives it Docker bridge networking for its own APIs.
- The renderer always has no network, no NAS data and no credentials.
- Declare every credential as a `secret` setting. The settings page masks it, keeps the saved value when the input is blank, and offers an explicit clear.
- Never put secrets or household data in `layout.json`, fixtures, `public/` files, the image build, the HTML, or Git.
- The installer rejects symlinks and paths named `.git`, `.env`, `.env.*` (except `.env.example`), `.secrets` or `node_modules`.

### Several layouts on one host

One host runs up to eight layouts for up to eight TVs. Write your layout so that it works beside other layouts and serves several TVs.

**One container per layout.** Each layout runs in its own container. Inside it, the layout listens on `/run/dayframe-site/site.sock`, as a single layout does. Art Frames reaches the first layout through the `website` service and each other layout at `/run/dayframe-apps/<id>/site.sock`. Layouts share no socket, settings or state. One container serves every TV that shows the layout.

**Settings scopes.**

- Layout settings (`settings` in `layout.json`) are shared. Every TV that shows the layout reads the same `/site-config/config.json`.
- Display settings (`display_settings`) are per TV. Each snapshot holds the values for the TV that renders.
- Each layout has its own settings scope. One layout never sees the settings of another layout.

**Snapshot fields.**

- `render_purpose` says why Art Frames renders:
  - `scheduled`: a normal render of the layout on screen.
  - `prepare`: a render up to 10 minutes before a scheduled wake. `now` is the wake time, not the current time. The TV shows this image when it wakes.
  - `rotation`: a background render of a rotation layout that is not on screen now. The TV shows the image later, when the rotation swaps to the layout.
  - `preview`: a preview from the TV's **Screen** page. A preview must not advance state. Do not move a rotation, mark items as shown or save anything that changes the next render.

  Treat a missing or unknown value as `scheduled`.
- Older hosts also send `ignore_display_hours`. It is a legacy field from when layouts had their own display hours. Ignore it. The TV's Schedule decides when a layout shows.
- `display.id` is a stable ID for this TV, as your layout sees it. Art Frames makes it with a keyed hash of the TV and the layout's settings scope, so two layouts get different IDs for the same TV. Use it as the key for per-TV state, for example a position in a photo rotation. Treat it as opaque: do not parse it, show it or rely on its length. Keep per-TV state bounded. A custom website build without a layout gets no `display.id`.
- `refresh_minutes` is this TV's render interval ("Render every, minutes": 1–1440, default 15). A TV that follows the shared website uses the website's value. Art Frames renders each layout in use about this often. Use it to size time steps and cache lifetimes.

**One layout on several TVs.** Several TVs can show the same layout at the same time. Each render is one request with its own snapshot, so keep request data local to that request. Key per-TV state by `display.id`. Shared caches, such as an API cache, are fine. Each TV can have its own mat, so `art.viewport` can differ per TV.

### Open points in the host contract

- The installer sets the readiness selector to `[data-dayframe-ready]`, but only the Chromium renderer uses it. The static renderer ignores it.
- The host does not pass the socket path to the layout. Layouts rely on the fixed path `/run/dayframe-site/site.sock`.

## Develop the morning layout

```sh
cd layouts/morning
npm ci
npm run dev
```

Open `http://127.0.0.1:4321/dashboard/`. Live weather/calendar integration belongs to this layout. A public-domain Monet is used locally when Art Frames art is not connected. Use `?art=live` with an updated Art Frames tunnel on localhost:8765 for its selected artwork; authentication is forwarded only server-side to that fixed loopback destination.

Sample calendar/weather data requires explicit `?data=sample`. For a busy agenda, open `http://127.0.0.1:4321/?data=sample&agenda=busy`; edits reload automatically without deploying. Add `preview=weekend`, `preview=art` or `preview=empty` for other design fixtures. Production ignores these query parameters and uses the actual clock and configured feeds. Failed providers are reported, not replaced by sample events.

The layout has no display hours of its own. Each TV's Schedule decides when the morning layout shows. Whenever Art Frames renders it, the layout shows the calendar and weather, also for a prepare render before a wake. To show only the artwork on a TV, do not schedule the morning layout on that TV. Saved values from older versions (`morning_start`, `morning_end` and the `show_calendar` display setting) are ignored.

The calendar sits directly on the artwork, like the weather. Dark fades on the left and right edges keep their light text readable over bright paintings, and the middle of the artwork stays clear.

Local layout configuration is ignored `.secrets/config.json` under the layout folder (or `DAYFRAME_SITE_CONFIG`). Keys are defined in `layout.json`. Configure `city` and a `calendars` array there without committing them. Each calendar has an `id`, private Google iCal `url`, optional `title` (blank uses the feed name), and hexadecimal `color`. Add up to eight calendars; their events merge into one agenda, with per-calendar colors and names. On an installed layout, use **Layouts → Morning dashboard → Settings → Calendars → Add calendar** in Art Frames instead: its masked secret fields preserve saved values when blank and provide explicit clearing. The layout alone reads `/site-config/config.json` server-side.

## The News & weather layout

`layouts/news` shows the date, today's weather and a few top headlines over the day's artwork. It uses Google News RSS for headlines and Open-Meteo for weather.

### What it shows

- **Left, at the bottom:** the weekday and date, the current temperature and conditions, today's high and low, and five forecast points three hours apart. Times use the 12-hour clock in both units, like morning.
- **Right:** 5 to 8 headlines. Each has its source and how long ago it was published. The topics merge into one list: the top story of each topic in turn, then the next, with duplicates removed. A small topic label shows when you choose more than one topic.
- **Background:** the artwork, with dark fades behind the text. Turn off the per-TV switch **Show the artwork behind the news** (`show_art`) to use a plain dark green background on that TV. With a mat, the content stays inside `art.viewport`.

### Settings

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `region` | choice | United States (English) | The Google News edition. Latin-script editions only, because the bundled Inter font has no other scripts. |
| `topics` | list, up to 6 | none (top stories) | Each row has a `topic` choice (Top stories, World, Nation, Business, Technology, Entertainment, Science, Sports, Health) and optional `query` search text. When a row has search text, it shows search results and ignores its topic. |
| `headline_count` | choice | 6 | 5, 6, 7 or 8. The layout drops a headline only when the rest cannot fit. |
| `city` | text | blank | Same as morning. Blank hides the weather. |
| `units` | choice | fahrenheit | `fahrenheit` or `celsius`. |

### Data and failures

1. A background loop checks every minute. Each feed and the forecast refresh about every 20 minutes. After a failure, a retry waits 1, 2, 4… minutes, up to 20.
2. The layout saves feeds and the forecast in `/site-state/news-cache.json` (mode 0600). Restarts reuse it.
3. Renders read the saved copy. Only the first load of a feed waits, for up to 3 seconds. If it is still loading, the render returns `202`.
4. When a refresh fails, the screen keeps the saved data and shows "Updated 2 hr ago" and a short status line. A topic that never loaded is named in the status line. When no topic has loaded, one line says "Headlines couldn’t load" and why. Production never shows sample data.

The layout fetches only `https://news.google.com` and the two Open-Meteo hosts, with the same hardened helper as morning. It follows a redirect only to the same fixed host; topic URLs redirect once. All feed text is plain text: the layout decodes entities once, removes control characters, caps titles at 180 characters and sources at 48, and lets Astro escape it. It never reads the feed's HTML description.

### Develop

```sh
cd layouts/news
npm ci
npm run dev
```

Open `http://127.0.0.1:4321/?data=sample` for sample data. Add `art=off`, `mat=on`, `stale=on`, `topics=one`, `weather=off` or `count=5`…`8` to see other states. Production ignores these parameters. Without `?data=sample`, development uses the real clock and `.secrets/config.json`.

## The Weather layout

`layouts/weather` shows only the weather, over the day's artwork. It shows the day first, then the week. It uses Open-Meteo for the forecast and the city search.

### What it shows

- **Left, at the bottom: the day.** The city and date, the temperature now in large type, the conditions and the "feels like" temperature. Below that: today's high, low, chance of rain (or snow) and sunrise and sunset. Then eight forecast points two hours apart, each with the time, an icon, the temperature and the chance of rain when it is 10% or more. In the evening the points run on into tomorrow, with the weekday above the first point after midnight.
- **Right, at the bottom: the week.** Seven rows, from today. Each row has the day, an icon, the chance of rain (10% or more), the low, a bar and the high. All bars share one temperature scale, so you can compare days at a glance. The bar color goes from cool blue to warm apricot. Today's bar has a dot at the temperature now.
- **Background:** the artwork, with dark fades behind the text, like news. The middle of the art stays clear. Turn off the per-TV switch **Show the artwork behind the weather** (`show_art`) to use a plain dark green background on that TV. With a mat, the content stays inside `art.viewport`.

Night hours use moon icons. Times use the 12-hour clock in both units, like morning and news.

### Settings

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `city` | text | blank | City and state or country, for example `Boston, MA`. Blank shows "No city set" and fetches nothing. |
| `units` | choice | fahrenheit | `fahrenheit` or `celsius`. |

### Data and failures

1. A background loop checks every minute. The forecast refreshes about every 20 minutes. After a failure, a retry waits 1, 2, 4… minutes, up to 20.
2. Each refresh asks Open-Meteo for eight days, so a forecast saved yesterday still fills a full week today.
3. The layout saves the forecast in `/site-state/weather-cache.json` (mode 0600). Restarts reuse it. It also saves the host's last timezone in `/site-state/host.json`, so the background refresh can run before the first render after a restart.
4. Renders read the saved copy. Only the first load waits, for up to 3 seconds. If it is still loading, the render returns `202`.
5. When a refresh fails, the screen keeps the saved forecast. After 45 minutes it shows "Updated 2 hr ago" and why the refresh failed. With no usable forecast, it shows "Weather is unavailable" and the reason, for example "Couldn't find “Bostn, MA”. Check the city in this layout's settings." Production never shows sample data.

The layout fetches only the two Open-Meteo hosts, with the same hardened helper as morning and news: HTTPS only, public DNS pinning, size limits and deadlines.

### Develop

```sh
cd layouts/weather
npm ci
npm run dev
```

Open `http://127.0.0.1:4321/?data=sample` for a made-up Boston forecast (`src/fixtures/sample-forecast.json`). Add `time=19:40` to see the evening, or `art=off`, `art=none`, `mat=on`, `stale=on`, `units=celsius`, `weather=off` or `city=off` to see other states. `art=off` turns off the artwork switch; `art=none` sends no artwork at all, like a host with no art. Production ignores these parameters. Without `?data=sample`, development uses the real clock and `.secrets/config.json`.

## The Photos layout

`layouts/photos` shows photos from a Google Photos shared album. The photo changes on a fixed time step, such as every 15 minutes.

**Reading shared albums is unofficial.** Google offers no public API for shared album links. The layout reads the album's web page, the same page a browser gets, and takes the photo list from data inside that page. Google can change that page at any time. When the layout can't understand the page, the screen says "Couldn't read the album. Google may have changed the page. Check that link sharing is on for the album, then try again later." Photos already downloaded keep showing, and the layout tries again later.

### Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Shared album link (`album_url`, secret) | none | A `https://photos.app.goo.gl/…` link or a `https://photos.google.com/share/…?key=…` link. Anyone with the link can see the album, so it is a secret. |
| Change photo every (`photo_interval`) | 15 minutes | 5, 15, 30 or 60 minutes, or once a day (at local midnight). |
| Check the album for new photos (`sync_interval`) | Every 3 hours | Every hour, every 3 hours or every 6 hours. |
| Photo order (`order`) | Shuffle | Shuffle shows every photo once, in random order, before any photo repeats. Newest first goes from the most recent date taken to the oldest, then starts again. |
| Photo fit (`fit`) | contain | `contain` shows the whole photo over a blurred, darkened copy of itself. `cover` fills the screen and crops the edges. |
| Show the date taken (`show_caption`, per TV) | on | A small date label in the bottom-right corner. |
| Show the time (`show_clock`, per TV) | off | Adds the time of the screen update to the label. It changes only when the screen updates. |

### How it works

1. A background loop reads the album page at the chosen interval. Failures retry after 1, 2, 4… minutes, up to the interval.
2. The parser looks for the `AF_initDataCallback` data in the page. Each entry gives the photo ID, its `lh3.googleusercontent.com` base URL, width, height, date taken and time zone offset. If that data is missing, the parser falls back to a scan for image URLs (no dates or sizes). It reads at most 4 MB of page and 2,000 photos, and skips any single data block over 3 MB.
3. Videos are skipped. Google marks them in the entry data; a video that Google does not mark shows as its still frame.
4. The layout downloads the next few photos ahead, sized for the display with Google's size parameters (for example `=w3840-h2160-no`, or `=w3840-h2160-p-no` for a screen-shaped crop). It never asks for more pixels than the original. `sharp` prepares each photo and, for `contain`, a small blurred backdrop. WeasyPrint has no CSS `filter` support, so the blur happens in the layout.
5. Photos are cached in `/site-state/photos`, up to 300 MB and 400 photos. The least recently shown photos and photos that left the album are removed first.
6. The layout rounds the snapshot's `now` down to the photo interval in local time. That gives a time bucket, such as 10:00–10:30. Once a day runs from local midnight to the next. The first render in a later bucket moves the rotation one step. Every other render in the same bucket shows the same photo, at any size, mat or fit. A bucket that starts at the same time or earlier keeps the photo, even after an interval change. When a TV needs the photo at a new size, that download goes ahead of the downloads in the queue. If the host clock goes back, the photo stays. A snapshot time more than a day ahead of the layout's clock is ignored. The page loads the photo from the layout as `/photo/<name>.jpg` over the socket.
7. A photo that fails to download is skipped and retried later, with a longer wait after each failure. It does not stop the rotation.

Until the first photo is ready, renders return `202` and the TV keeps its image. If downloads keep failing, the screen says so instead.

If the album can't be read for more than a day, a small note appears under the date label. The saved photos keep showing.

### Limits and host notes

- Network access is limited to `photos.app.goo.gl`, `photos.google.com` and `lh<N>.googleusercontent.com`, over HTTPS, with public DNS pinning, size limits and deadlines. The short link may redirect only to a `photos.google.com/share/…?key=…` page. Each redirect is checked before it is followed.
- Large albums: only the first batch of photos that Google puts in the page is used. When Google says the album has more, the layout logs `Album has more photos than its page lists; using the first <n>` once per sync.
- When the snapshot has `display.id`, each TV has its own rotation. The layout stores only a hash of the id and keeps the 8 most recently used TVs. A TV that keeps its photo still counts as used. The background loop downloads ahead only for TVs that rendered. Without `display.id`, all TVs share one rotation, and two TVs that render in the same time bucket show the same photo. Display settings work per TV in both cases.
- `render_purpose: "preview"` shows the current photo and never moves the rotation. `scheduled`, `prepare`, `rotation` and a missing `render_purpose` are normal renders. A `prepare` render before a wake moves the rotation when it starts a new bucket. The `scheduled` render that follows in the same bucket shows the same photo, so the rotation does not move twice.
- The layout sets `artwork: false`, so Art Frames sends no art and no `art.viewport`, and it adds no mat. The layout still keeps its content inside `art.viewport` if a future host sends one.
- `memory_mb` is 384. Preparing one 3840×2160 photo with `sharp` peaked at about 220–275 MB in tests, which leaves too little room in 256 MB.

### Develop the Photos layout

```sh
cd layouts/photos
npm ci
npm run dev
```

Open `http://127.0.0.1:4321/?preview=landscape`. The dev preview uses generated sample images and no network. Options: `preview=landscape|portrait|error|empty|missing`, `fit=cover|contain`, `caption=0` and `clock=1`. Without `preview`, the dev server uses `.secrets/config.json` and stores its cache in `.secrets/state`. Never commit album links or photos.

## Install

Art Frames installs every layout in `catalog.json`. You do not install layouts one by one.

1. In the Art Frames checkout, open the ignored `.deploy.local.toml`.
2. Set a static Compose profile: `compose = "compose.static.yaml"` (or `compose.static.host.yaml`). A browser profile installs no layouts.
3. Name this repo in `[app]`:

   ```toml
   [app]
   local_repo = "../art-frames-layouts"
   ```

   To fetch it from GitHub instead, use `repo = "brianmuse/art-frames-layouts"` and `ref = "main"`.
4. Optional: add `skip = ["news"]` to `[app]` to leave layouts out.
5. Optional: add a `[[sources]]` entry for each other layout repo, with `path = "../my-layouts"`, or `git = "<url>"` and `ref = "<tag or commit>"`.
6. Commit your changes in this repo. Deploy installs only committed files. It stops when a local repo has uncommitted tracked changes.
7. Run `npm run deploy`.

The catalog `default` is the first layout. It runs as the `website` service. Each other layout runs as its own `app-<id>` service. A TV with no chosen layout shows the first layout. Each TV chooses its layouts on its **Schedule** page. When a layout leaves the catalog or goes in `skip`, the next deploy removes it and keeps its saved settings.

For a local run without deploy, run `.venv/bin/python scripts/install-layout.py --local-repo ../art-frames-layouts` from the Art Frames checkout, with Art Frames stopped. Add `--skip <id>` to leave a layout out. With a browser profile, add `--first-only` to install only the first layout.

Read the Art Frames [docs/cli-deployment.md](https://github.com/brianmuse/art-frames/blob/main/docs/cli-deployment.md) and [docs/layouts.md](https://github.com/brianmuse/art-frames/blob/main/docs/layouts.md) before you install. Layouts are trusted server code. Review a source before you install it.

## Tests

```sh
npm run validate
npm run test:scripts
npm --prefix layouts/morning test
npm --prefix layouts/morning run build
npm --prefix layouts/news test
npm --prefix layouts/news run build
npm --prefix layouts/photos test
npm --prefix layouts/photos run build
npm --prefix layouts/weather test
npm --prefix layouts/weather run build
```

CI runs the catalog validator and its tests, then runs `npm ci` and `npm test` for each folder under `layouts/`.

The morning layout uses hardcoded Open-Meteo and Google Calendar adapters. HTTPS requests use fixed provider hosts, public DNS pinning, bounded bodies and deadlines. Calendar parsing runs in a worker with time/memory limits. The server has only its own private configuration and requests bridge networking for its APIs; the image renderer remains networkless. Install reviewed layout code only.

Secrets and household content never belong in manifests, fixtures, public files, image builds or Git. Weather data is attributed to Open-Meteo (CC BY 4.0); museum source/rights stay with the supplied art. See THIRD_PARTY_NOTICES.md.

Existing saved `work_calendar_url` and `family_calendar_url` credentials become list entries on the next settings save, retaining Work’s wine red and Family’s lilac. Blank links keep the saved credential; removing an entry removes its credential. Deploy the updated Art Frames host before installing this version of the layout.

Calendar downloads and parsing run independently of screen refresh. The default is one sync at 03:00 in the calendar timezone. The calendar timezone follows the Art Frames timezone unless the layout settings set one, including while the TV is asleep; hourly and 15-minute options remain available. A new installation catches up immediately. Compact exports persist in the layout’s private `/site-state/calendars` directory, so restarting reuses a successful daily download. Local development uses ignored `.secrets/state`. Files use mode 0600 inside a 0700 directory, contain no private feed URLs, and are limited to eight exports. Removing a calendar prunes its saved export on the next background pass. Downloads have a configurable timeout (30, 90 or 180 seconds; default 90), coalesce duplicate requests and allow at most four concurrent downloads. Failed downloads back off: temporary errors retry after 1, 2, 4… minutes, up to 60 minutes or the refresh interval. Size-limit, access and not-found errors wait for the next scheduled sync. A new export replaces the saved one only after it parses. A failed refresh keeps its last successful data and marks it as saved/stale. Events the parser cannot handle are skipped and counted instead of failing the whole calendar.

Parsing also runs in the background for the requested display days. One parser process runs at a time with a 90-second wall-clock limit and 96 MB old-generation heap limit, independent of the website’s heap setting. Up to eight results are reused until the compact feed, display days, timezone, title or color changes; time-dependent event state is refreshed on each render. Pending parse inputs share a 32 MB budget. While a feed is parsed again, renders keep showing the last successful parse. Only a feed with no previous parse makes a screen request wait (at most about 3 seconds for the first download and parse) and then return HTTP 202 while the worker continues. The Art Frames preview button waits and retries automatically, retaining the existing image until the layout is ready. Failed parses back off the same way as downloads. Feed errors distinguish unsupported links, HTTP status, network phases, timeouts and parser limits without returning private URLs or response bodies. Secret iCal feeds are independent per calendar/account and download the provider’s complete export. Google Calendar REST integration would need separate authorization for each account and is not enabled by this version.

Large calendar exports are streamed with a 32 MB download limit. The layout retains only display fields, recurrence metadata and timezone definitions, with an 8 MB per-feed projection limit and 32 MB total compact-cache budget. Descriptions, attendee lists, attachments and alarms are discarded while downloading. Before standard iCal parsing, old one-off events outside the display window are dropped conservatively; recurrence definitions, overrides and timezone data are preserved. Each screen render loads at most two feeds concurrently; parsing is serialized separately from downloads and screen requests. Download-limit failures are reported with byte counts instead of being mislabeled as network failures.

The agenda shows up to ten weekday events or four per weekend day, prioritizing ongoing and upcoming plans before filling remaining space with recent earlier events. Each day separates calendars into clearly labeled sections, using the configured calendar order and colors. Events remain in time order within each section; weekends show both dated days. Events show a start time and a duration chip instead of an end time; all-day labels remain. Durations use exact event timestamps, including overnight and daylight-saving transitions. Event titles use up to two lines, with the calendar named once in a solid color header with white text. Light custom colors are darkened only as needed to retain at least 4.5:1 text contrast. Weekdays with more than four calendars reserve room for headings by showing up to eight events, with a count of those omitted. The panel omits per-event Now/Up next treatments and repeated header legends.

Every render, including a preview, shows the full dashboard with the real current time and live data. The layout ignores `render_purpose` and `ignore_display_hours`. Mat width and color belong to the Art Frames artwork presentation and arrive in the selected background image.

The morning layout uses `art.viewport`, when present, to keep overlays within the painting opening. Its edge fades and full-opacity event text keep earlier events readable at low Art Mode brightness.
