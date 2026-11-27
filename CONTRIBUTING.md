# Contributing

Thank you for helping with Art Frames layouts. A layout is the page that Art Frames shows on the TV, over the art or instead of it. This repository holds the layouts that every Art Frames install gets.

**We want new layouts.** Did you build a layout for your own TV, such as a bus timetable, a tide chart or a chore board? Other households may want it too. Send it here, and every Art Frames install can use it.

This page tells you what makes a good shared layout, how to add one, and how we review it.

Is your change about Art Frames itself (the host, the TV control, the management pages)? Go to [art-frames](https://github.com/brianmuse/art-frames) and its [contributing guide](https://github.com/brianmuse/art-frames/blob/main/CONTRIBUTING.md).

## What we welcome

- **New layouts** that many households can use.
- **Fixes** to an existing layout, with a test that fails before the fix.
- **Improvements** to an existing layout: a new setting, a clearer design, a better empty or error state.

Before you start:

1. **Open an issue first for a new layout.** Use the **New layout proposal** form. Describe what it shows, where its data comes from and what settings it needs. Agree on the plan before you build. This saves you work if a similar layout is already planned.
2. **Make one change per pull request.** One new layout, or one fix. Do not mix changes to two layouts.
3. **Keep private data out.** Do not add calendar links, album links, API keys, addresses, real names or household photos to code, fixtures, screenshots, issues or pull requests. Use made-up data.

To report a security problem, do not open an issue. Open the **Security** tab of this repository and select **Report a vulnerability**.

## What makes a good shared layout

- **Useful to many households.** A layout for one person's own system belongs in their own layout repository. Art Frames can install layouts from any repository; see [Install](README.md#install).
- **Readable from across the room.** The TV shows a 3840×2160 image. Use large type and strong contrast. Text sits on top of art, so put a dark fade or panel behind it and keep the middle of the art clear. Test it over a bright painting and a dark one.
- **Settings in `layout.json`.** Declare every setting there, so the user can change it in Art Frames. Apply the defaults yourself when `config.json` is missing. Do not hard-code a city, a feed or a language.
- **Secrets as `secret` settings.** An API key, a private feed link or a shared album link is a `secret`. Art Frames masks it in the settings form. Read it only on the server. Never put it in the HTML.
- **No tracking.** No analytics, no ads, no tracking pixels and no calls that tell a third party when the TV is on.
- **Network only when needed.** Use `"network": "none"` unless the layout fetches data. When it does, fetch only from fixed provider hosts over HTTPS. Reuse the hardened fetch helper from `news` or `weather`. Name the hosts in the README.
- **Graceful failure.** When a provider fails, keep the last good data and say how old it is. Never show sample data in production. Return `202` while the first data loads.
- **Tests that never use the network.** Tests use fixtures and fakes. CI and a computer with no internet must give the same result.
- **A sample mode with made-up data.** `npm run dev` with `?data=sample` (or `?preview=…`) shows the layout with no network and no saved settings. Add query options for the main states: empty, error, stale data and no art.
- **Licensed assets.** Bundle fonts and images in `public/`. Each one needs a license that allows sharing, such as the SIL Open Font License or CC0. Put the license file next to the asset and list it in `THIRD_PARTY_NOTICES.md`.
- **Accessibility is not required.** The TV image is for people in the room to look at. You do not need screen reader support or keyboard navigation.

## Add a new layout

You need Node.js 22.23.4 or later. CI uses Node.js 24.

1. **Copy a layout.** Copy the existing layout closest to yours. `weather` is a good start for a layout that fetches data; `morning` is the reference layout.

   ```sh
   cp -R layouts/weather layouts/<id>
   rm -rf layouts/<id>/node_modules layouts/<id>/dist layouts/<id>/.astro layouts/<id>/.secrets
   ```

   The ID must match `^[a-z][a-z0-9-]{0,63}$`.
2. **Edit `layouts/<id>/layout.json`.** Set `id`, `name`, `description`, `network`, `memory_mb`, `artwork`, `settings` and `display_settings`. The README section [`layout.json`](README.md#layoutjson) lists every field and rule.
3. **Edit `layouts/<id>/package.json`.** Change the `name`. Keep the `test` script: it builds the layout and runs `tests/*.test.mjs`. Run `npm install` in the folder and commit the new `package-lock.json`.
4. **Write the layout.** Keep the Dockerfile, the socket path and the `DAYFRAME_*` names from the copied layout. The host still uses these old names. The README section [Write a layout](README.md#write-a-layout) describes the host contract.
5. **Add the layout to `catalog.json`.** Add it at the end of `layouts`:

   ```json
   { "id": "<id>", "name": "<same name as layout.json>", "path": "layouts/<id>" }
   ```

   Do not change `default`.
6. **Add the layout to the frozen-names test.** In `scripts/frozen-names.test.mjs`, add `<id>` to the `apps` list. Add its files to `frozen` and `readers` like the other layouts. This test fails when a layout loses a name that the host needs.
7. **Document the layout.** Add a section to `README.md`: what it shows, its settings, its data sources and failures, and how to preview it. Add it to the list at the top. List new fonts, images and data sources in `THIRD_PARTY_NOTICES.md`.
8. **Run the checks.** See [Checks](#checks).
9. **Take a 4K screenshot.** Run the sample mode and save a 3840×2160 image, for example with your browser's device toolbar set to 3840×2160. Better: install the layout on a source install of Art Frames and use **Preview** on a TV's **Screen** page. Use only made-up data.
10. **Open a pull request.** Fill in the template and attach the screenshot.

## Checks

Run these from the repository root:

```sh
npm run validate
npm run test:scripts
npm --prefix layouts/<id> ci
npm --prefix layouts/<id> test
```

- `npm run validate` checks `catalog.json` and every `layout.json` against the host's rules. It fails when a layout folder is missing from the catalog.
- `npm run test:scripts` runs the validator tests and the frozen-names test.
- `npm --prefix layouts/<id> test` builds the layout and runs its tests.

CI runs the first two once, then `npm ci` and `npm test` in every folder under `layouts/`. A pull request must pass all of them.

To check a layout with the host's own installer, run this from an Art Frames checkout:

```sh
.venv/bin/python scripts/install-layout.py --local-repo ../art-frames-layouts --check
```

## How we review

The maintainer reviews every pull request. Layouts run as trusted server code on people's home networks, so the review is careful. We check that:

1. The layout fits [what makes a good shared layout](#what-makes-a-good-shared-layout).
2. All checks pass, and the tests use no network.
3. Every outside host is fixed, uses HTTPS and is named in the README.
4. Secrets are `secret` settings and never reach the HTML or the logs.
5. The screenshot is readable at TV distance, over the art and with a mat.
6. The README section and `THIRD_PARTY_NOTICES.md` are complete.
7. The docs and setting labels are in plain language.

We may ask for changes. A layout that is useful but too specific for everyone may fit better in your own layout repository. We will say so early, ideally on the proposal issue.

## How a layout reaches users

1. The maintainer merges the pull request into `main`.
2. Art Frames installs every layout in `catalog.json`. A source install that follows `main` gets the new layout on its next deploy. The user does not need to change a setting.
3. The user picks the layout for a TV on its **Schedule** page and fills in its settings under **Layouts**.

A user who does not want a layout can leave it out with `skip` in the deploy settings. See [Install](README.md#install).

## Write in plain language

Write the README, setting labels, descriptions and on-screen text in plain language:

- Use short sentences and common words.
- Use the active voice. Write instructions as commands.
- Use one word for one thing. Say "layout", not "app", in anything a user reads.

## Code of conduct

Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md).
