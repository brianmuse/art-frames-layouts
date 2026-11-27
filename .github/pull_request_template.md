<!-- A change to the Art Frames host belongs in https://github.com/brianmuse/art-frames. -->

## What this changes

<!-- One new layout or one fix per pull request. Link the issue. -->

## Screenshot

<!-- For a new layout or a visible change: attach a 3840×2160 screenshot with made-up data. -->

## How you tested it

## Checklist

- [ ] `npm run validate` and `npm run test:scripts` pass.
- [ ] `npm test` passes in every layout I changed.
- [ ] No test uses the network.
- [ ] Every setting is in `layout.json`. Keys, tokens and private links are `secret` settings.
- [ ] The layout fetches only from fixed HTTPS hosts, and the README names them. (Or it uses `"network": "none"`.)
- [ ] New fonts, images and data sources are listed in `THIRD_PARTY_NOTICES.md`, with their licenses.

For a new layout:

- [ ] The layout is in `catalog.json` and in `scripts/frozen-names.test.mjs`.
- [ ] `README.md` has a section for it: what it shows, settings, data and failures, how to preview.
- [ ] `npm run dev` with sample data works with no network.

For every change:

- [ ] Docs and labels are in plain language and say "layout", not "app".
- [ ] No calendar links, album links, API keys, addresses, real names or household photos.
