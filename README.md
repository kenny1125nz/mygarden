# MyGarden

Turn a real property into a living garden game: a digital twin of your garden, maintained through proactive, weather-aware quests.

Neglected gardens become expensive. MyGarden builds an editable map of the property from open aerial imagery, tracks trees, lawns, fences, and equipment, and produces timely maintenance activities. Care is presented as a game: the property is the board, assets are cards, maintenance is quests, and real-world care earns progress.

## Current implementation

- `apps/web/` — responsive React + TypeScript PWA that initialises a property from Wellington City Council open data, with a 3D view and property masking.
- `CONCEPT.md` — product concept and personas.
- `TECH_DESIGN.md` — technical design.

## Getting started

```bash
cd apps/web
npm install
npm run dev
```

Optional URL parameters: `?view=3d` opens the 3D view, `?mask=1` starts with the outside-property mask enabled.

Production build:

```bash
npm run build
npm run preview
```

## Status

Concept / pre-MVP, with an early property-initialisation implementation.
