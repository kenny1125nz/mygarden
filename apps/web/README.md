# MyGarden Web — Property Initialisation

Front-end slice of MyGarden: a React + TypeScript PWA that initialises a property from **Wellington City Council open data**. It is the first implementation of the property data initialisation step.

## Run

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Add `?view=3d` to open directly in the 3D view, or `?mask=1` to start with the outside-property mask on.

Production build:

```bash
npm run build
npm run preview
```

## What it does

- Geocodes the address through the WCC Address layer (LINZ).
- Fetches the cadastral parcel (section) polygon.
- Fetches building footprints and keeps structures substantially on the section.
- Fetches 0.5 m contours (falls back to 1 m) and clips them to a 6 m buffer around the property.
- Uses WCC 2021 aerial imagery as the scene background.
- Samples the WCC 1 m DEM for ground elevation and 3D-ready vertex heights.
- Builds a local ENU frame and a 3D-ready property record.
- Renders the property in a three.js plan view or 3D view over WCC 2021 aerial imagery.
- Uses semi-transparent overlays so the aerial image remains visible.
- Provides a **Mask outside property** toggle that dims everything outside the section.
- Caches the result in `localStorage`; **Refresh from WCC** reloads it.
- Exports the 3D-ready property JSON and a WGS84 GeoJSON.
- Supports manual editing from day one.
- Presents the maintenance plan in a calendar and species knowledge in slides.

## Workspace views

- **Calendar** (default): month grid with activities, daily agenda, month totals, and plan JSON download. Weekly and other recurring tasks appear on their due dates.
- Check/inspect tasks are batched into **weekly** and **monthly garden inspections**, with the individual checks shown as a checklist when the inspection is opened.
- **Map**: the editable 3D-ready property canvas.
- **Species**: one species per slide, with summary, watch-for notes, and regular care tasks.
- Tabs switch the main view. Swiping left/right on the calendar switches between views.

Clicking an activity in the calendar opens its care details. From there, **View species knowledge** jumps to the matching species slide.

## Editing

- Tools: **Pan**, **Select**, **Tree**, **Lawn**, **Bush/hedge**, and **Area**.
- Add a tree by clicking the map. Trees are drawn as circles with a trunk point.
- Select a tree and drag its edge handle to resize the canopy, or edit **Canopy radius (m)** in the panel.
- Draw an area by clicking points, then choose **Finish area**.
- In Select mode, drag a tree to move it, or drag a selected area's vertices to reshape it.
- Double-click near an area edge to insert a vertex.
- Roughly collinear points are removed automatically while drawing and after dragging.
- Edit label, species, radius, and notes in a modal; delete from the modal.
- Assets are grouped in a collapsible tree by type, with species subgroups for trees and bush/hedges.
- The asset tree is scrollable and can be filtered by name or species.
- Drawn areas show their calculated area in m² and vertex count.
- Edits are stored per parcel in `localStorage`, so **Refresh from WCC** does not overwrite them.
- Property, Buildings, Export, and Data sources panels are collapsible to make room for the editor.

Current editing limits: vertices can be moved and inserted, but not individually deleted (apart from automatic collinear simplification); there is no undo/redo yet; one property per instance.

## Care knowledge and plan

- Each user asset is matched to a care profile by label, species, then asset kind.
- The initial base covers the trial property’s 29 assets with 16 profiles (pōhutukawa, camellia, citrus, feijoa, bamboo, boxwood, hedges, lawn, vegetable beds, hardscape, and more).
- Each profile has regular care tasks with seasonal windows, machine-readable cadence, weather flags, priority, effort, rationale, and conditions.
- The structured tasks feed a deterministic 12-month **maintenance plan** shown in the calendar.
- Calendar activities are dynamically linked to care details; the same details can jump to the **Species** tab.
- The plan can be downloaded as JSON from the calendar.
- This is a deterministic, LLM-assisted draft for local horticultural review. See `src/knowledge/README.md` for assumptions and review notes.

## Default property

`3 Jay Street, Paparangi, Wellington`

## Data sources

- [WCC Address (LINZ)](https://gis.wcc.govt.nz/arcgis/rest/services/PropertyAndBoundaries/Address/MapServer)
- [WCC Parcels (LINZ)](https://gis.wcc.govt.nz/arcgis/rest/services/PropertyAndBoundaries/Parcels/MapServer)
- [WCC Building Footprints](https://gis.wcc.govt.nz/arcgis/rest/services/PropertyAndBoundaries/BuildingFootprints/MapServer)
- [WCC Contours 2020](https://gis.wcc.govt.nz/arcgis/rest/services/Elevation/Contours2020/MapServer)
- [WCC Aerial Imagery 2021](https://gis.wcc.govt.nz/arcgis/rest/services/Cache/Imagery2021/MapServer)
- [WCC 1 m DEM 2020](https://gis.wcc.govt.nz/arcgis/rest/services/Elevation/DigitalElevation1Metre_WGS84_2020/ImageServer)
- [WCC open data terms](https://wellington.govt.nz/wellington-city/maps/open-data-portal-terms-and-conditions/gis-data)

No commercial API key is required. Requests are made directly from the browser; the WCC GIS services allow CORS.

Contains data © Wellington City Council and Land Information New Zealand (LINZ). Check the open data terms before redistribution.

## Notes

- The parcel area is computed geodesically from the polygon; the WCC parcel record is included in the JSON for traceability.
- Building heights use WCC `approx_hei`; they are approximate and intended for editing.
- Contours are clipped with a custom segment-polygon clipper because public Turf helpers did not reliably split long contour lines.
- This prototype intentionally has no unit-test suite; verification is driven by use on the trial property and a small smoke path. See `../../TECH_DESIGN.md`.
