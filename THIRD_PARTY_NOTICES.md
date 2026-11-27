# Third-party notices

This file lists third-party material in this repository. The MIT license in `LICENSE` covers the rest.

## Attribution

The `morning` app is inspired by [Frame Daily Plan](https://github.com/JustifyTechExpenses/frame-daily-plan). It takes the morning planner idea and the calendar parsing approach from that project. Its license is below.

## Inter font

Each app ships the Inter font in `layouts/<id>/public/fonts/` (`Inter-Regular.ttf` and `Inter-SemiBold.ttf`). Inter is licensed under the SIL Open Font License 1.1. The full license is next to the font files, in `layouts/morning/public/fonts/Inter-LICENSE.txt`, `layouts/news/public/fonts/Inter-LICENSE.txt` and `layouts/photos/public/fonts/Inter-LICENSE.txt`.

## Development artwork

`layouts/morning/public/dayframe-art.jpg` and its copy `layouts/news/public/dayframe-art.jpg` are a resized derivative of Claude Monet, *Water Lilies (Agapanthus)*, Cleveland Museum of Art, accession 1960.81. The museum provides this image under CC0. Museum record: https://www.clevelandart.org/art/1960.81. It is a public development sample. Installed apps get the operator's selected art from Art Frames instead.

## npm dependencies

This repository does not include any npm package code. `npm ci` downloads the packages listed in each app's `package-lock.json`, such as Astro, `@astrojs/node`, `ipaddr.js`, `node-ical` (morning) and `sharp` (photos). The app Docker images contain these packages with their own license files.

## Data sources

The apps read data from third-party services at run time:

- Weather: [Open-Meteo](https://open-meteo.com/), CC BY 4.0 (`morning` and `news`).
- Headlines: Google News RSS feeds (`news`). Headline text and source names belong to their publishers. The repository holds only sample headlines written for its fixtures.
- Photos: Google Photos shared albums that the user chooses (`photos`). The repository holds no photos.

## Frame Daily Plan license

MIT License

Copyright (c) 2026 JustifyTechExpenses

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
