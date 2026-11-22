# Personal Portfolio Integration Notes

This folder is a merged version of the supplied particle portfolio and Vante-inspired ribbon gallery.

## What changed

- Kept the existing particle scene and its shader implementation.
- Kept the MEHA introduction and Technical Identity skill panels.
- Replaced the original wheel/touch `preventDefault()` scroll controller with native document scrolling.
- Mapped the particle scene progress to the first intro track only.
- Added the original Vante Three.js ribbon scene as the next long-scroll section.
- Changed ribbon scroll progress to be local to its own section, so it starts at zero when the visitor reaches Selected Work.
- Removed VANTE branding, LET'S TALK and the original Vante description.
- Added MENU navigation and a RESUME control.

## Important content note

The supplied Vante gallery uses eight externally hosted sample videos and sample project titles from `src/ribbon/ribbonScene.ts`. They are retained so the supplied ribbon animation remains intact. Replace these sources/titles with your own project videos and project names before presenting them as your actual work.

No resume PDF was present in either supplied ZIP. The RESUME control therefore shows an explanatory message instead of linking to a nonexistent file. Add your actual PDF as `public/resume.pdf` and wire the button to `/resume.pdf` when you provide it.

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

Three.js and its type package are aligned at 0.170.0 so the ribbon scene and particle scene share one Three.js instance. The dependency installation/build could not be completed in this environment because npm package installation timed out; run the commands above in your local project environment and report any compiler errors before deployment.
