<a id="readme-top"></a>

[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]

# ReconMed — presentation

> The Regeneron track deck for **ReconMed · Automated patient reconciliation**.

Part of **[ReconMed](../README.md)** — pre-visit concomitant medication
reconciliation for clinical trial sites. This folder is the pitch, not the
product.

Each slide is a single image, built in its own folder as a standalone LaTeX
figure and compiled to a **backgroundless PDF**. The deck (`slides/main.tex`) is
rendered in LaTeX too, and simply places those figures full-bleed. Beamer adds
nothing but the ground colour and the order — all layout lives in the figure, so
what you compile in a figure folder is exactly what appears on the slide.

The compiled deck is checked in at [`slides/main.pdf`](./slides/main.pdf).

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#build">Build</a></li>
    <li><a href="#layout">Layout</a></li>
    <li><a href="#the-rules-these-slides-follow">The rules these slides follow</a></li>
    <li><a href="#adding-or-editing-a-slide">Adding or editing a slide</a></li>
    <li><a href="#brand">Brand</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contributors">Contributors</a></li>
  </ol>
</details>

## Build

```bash
cd presentation
make            # the deck, and everything it needs
make figures    # just the figures  -> figures/*/figure.pdf
make deck       # just slides/main.pdf
make preview    # PNGs of everything, on the ground colour -> previews/
make clean
```

Everything is compiled with **lualatex** (the deck is set with `fontspec`).
Requires a TeX Live with `standalone`, `beamer`, `tikz`, `fontspec`, plus
ImageMagick for `make preview`.

## Layout

```
presentation/
├── shared/
│   ├── palette.tex      green medical theme (derived from the app's tokens)
│   ├── fonts.tex        Montserrat headings over Open Sans body
│   ├── tikzstyles.tex   shared TikZ styles, sized in millimetres
│   ├── logo.tex         \reconmedmark — the mark at any size
│   ├── base.tex         preamble for figures *and* slides
│   ├── theme.tex        base + transparent page background (figures only)
│   └── marks/           vector assets, included at any size:
│                        ReconMed mark, OpenAI, Deepgram, Lucide icons
│                        (brain, database, file, clock, shield, stethoscope),
│                        and the QR code
├── figures/
│   └── 01-title/ … 13-sources/   (incl. 02b-scale, 04b-time,
│        04c-doctor-vs-agent, 04d-evidence, 05b-voice-agent, 06-hallucination)
│       ├── figure.tex   the slide, as a standalone TikZ picture
│       ├── figure.pdf   compiled, transparent, 160×90 mm (16:9)
│       └── notes.md     the one idea + the spoken line
├── slides/main.tex      the deck: one full-bleed figure per slide
├── previews/            PNGs for review (gitignored)
└── Makefile
```

## The rules these slides follow

- **One idea per slide, few words.** The deck assumes it is being spoken over.
- **Red is reserved** for prohibited findings — nothing else is ever red.
  Change types stay cool (add green, stop purple, modify blue) so they never
  read as alarm.
- **No decorative chrome:** no all-caps eyebrow labels, no numbered non-sequences,
  monospace only where it earns it (RxCUIs, protocol sections).
- **Colour, type and space come from the product**, so the deck and the app are
  recognisably one system.

## Adding or editing a slide

1. Copy `figures/01-title/figure.tex` into the slide's folder as `figure.tex`.
2. Draw inside the 160×90 mm canvas (`x=1mm,y=1mm`). Use the styles in
   `shared/tikzstyles.tex` and the colours in `shared/palette.tex`; never hard-code
   a hex value.
3. `make figures`, then add a line to `slides/main.tex`:
   `\slidefig{figures/<folder>/figure.pdf}`.

The background is transparent: leave it unpainted and the slide's ground colour
shows through. Panels that should read as surfaces get an explicit `surf` fill.

## Brand

**ReconMed** — automated patient reconciliation. (The clinical shorthand for
concomitant medication, "conmed/conmeds", is a separate term and is still used
where it means the medication itself.)

The mark is two records converging into a single line: the medication log on
file, and what the participant actually said, resolved into one record. It is
drawn as a vector asset (`shared/marks/`) rather than scaled in-place, so the
strokes stay true at every size.

*Note:* the event wordmarks (HackMIT, Regeneron) are set as plain type here.
Drop official logo files into `shared/marks/` and reference them the same way if
they are wanted on the title slide.

The research that fed the narrative lives in
[`chat_research.txt`](./chat_research.txt) and
[`sponsor_challenges.txt`](./sponsor_challenges.txt).

## License

Distributed under the MIT License. See [`../LICENSE`](../LICENSE).

## Contributors

Built at **HackMIT 2026** for the **Regeneron** track.

- **Samuel Orellana Mateo** — [@Samuel-O-M](https://github.com/Samuel-O-M)
- **Ayushi Mehrotra** — [@ayushimehrotra](https://github.com/ayushimehrotra)
- **Avighna Chhatrapati** — [@avighnac](https://github.com/avighnac)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[license-shield]: https://img.shields.io/github/license/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[license-url]: ../LICENSE
[contributors-shield]: https://img.shields.io/github/contributors/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[contributors-url]: https://github.com/Samuel-O-M/HackMIT-2026/graphs/contributors
