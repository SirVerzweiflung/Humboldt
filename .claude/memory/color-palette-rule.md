---
name: color-palette-rule
description: Fixed 5-color palette is the only allowed colors; enforce everywhere
metadata:
  type: feedback
---

Project has a fixed 5-color palette — the ONLY colors allowed anywhere (UI, map, pins, charts): Wheat `#ebd1ad`, Palm Leaf `#93914d`, Gunmetal `#424242`, Pacific Cyan `#5296a5`, Baby Pink `#f8a0cb`. Sole addition: **white text** (on dark-enough bg). Dark text is always `gunmetal`, never black/off-palette grey.

**Why:** User's chosen brand palette; wants it applied strictly, not approximately.

**How to apply:** Tailwind tokens `wheat/palm/gunmetal/pacific/pink` (tailwind.config.js), CSS vars `--*` (index.css). No off-palette Tailwind colors (`slate-*`, `red-600`) or raw hex. Errors = `bg-pink text-gunmetal`. Full rules in CLAUDE.md §15. When adding any UI, check against this before picking a color.
