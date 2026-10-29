# Existing Kleros Events assets

Downloaded read-only from `weiwei-ooi/kleros-events` at commit `fa732b8ea20e57648516b6e46e1076c0bf2ab434`. The SVG contents were saved without transformation.

| Local filename | Pinned source | Git blob SHA |
| --- | --- | --- |
| `kleros-logo.svg` | [public/kleros-logo.svg](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/public/kleros-logo.svg) | `a257dfdade729d0d05d4e3ec0fa42e3f7529442c` |
| `kleros-symbol.svg` | [public/kleros-symbol.svg](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/public/kleros-symbol.svg) | `6accc23f5b9ff8f67aa1ba2b757797cab42283e7` |

The complete, non-truncated recursive source tree contains no repository `LICENSE`, `COPYING` or equivalent license file and no committed font binaries (`.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`). The SVG headers identify Sketch export metadata but contain no license grant. No broad redistribution or trademark permission is inferred. These are existing project assets retained for the user's requested continuation/redesign of the Kleros project.

The [root layout](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/app/layout.tsx) imports `Instrument_Serif`, `Geist` and `Geist_Mono` via `next/font/google`. Their binaries were not committed in this repository snapshot. During this redesign, the exact Latin-subset WOFF2 files referenced by the observed live Events CSS were downloaded from the public Events deployment. The prototype and option boards embed these binaries: Geist, Instrument Serif regular and italic, and Geist Mono. `FONT_PROVENANCE.json` records their retrieval URLs and SHA-256 checksums. The accompanying SIL Open Font License notices were retrieved from the corresponding Google Fonts repository directories (`ofl/geist`, `ofl/instrumentserif`, and `ofl/geistmono`) and are included as separate text files and embedded HTML notices. The static renderer may approximate variable-font weight; the actual browser font rendering remains for Codex to verify.
