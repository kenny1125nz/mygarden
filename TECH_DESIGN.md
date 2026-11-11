# MyGarden — Technical Design

**Status:** High-level design
**Companion document:** `CONCEPT.md`
**Scope:** Architecture, constraints, and key decisions. Implementation details — API shapes, schemas, data structures, folder layout, infrastructure configuration, and algorithms — are intentionally deferred to the build phase.

---

## 1. Purpose

This document explains **how MyGarden is shaped** and **why**, without prescribing the implementation. It should be enough to align the architecture, estimate effort, and make build-phase decisions, but not so detailed that it becomes a premature specification.

The product concept is defined in `CONCEPT.md`. This document focuses on the system boundaries, component responsibilities, deployment model, and non-negotiable constraints.

---

## 2. Constraints and Goals

### 2.1 Non-negotiable platform constraints

1. **Open data first.** Maps, aerial/satellite imagery, geocoding, elevation, and weather use openly available sources by default. The app must work with **no commercial API key and no vendor account**. Commercial sources are optional, user-configured, and never required for core flows.
2. **Web only and independent.** The product is a standards-based PWA. There is no native iOS/Android app, no app-store submission, no APNs/FCM, no Google Maps or Apple MapKit, no Google/Apple sign-in, and no platform certification. Notifications use Web Push and email. Data lives in the user's own instance.
3. **Minimum footprint.** The complete stack must run on a single ARM64 single-board computer (Raspberry Pi 4/5 class, 4 GB RAM, 32 GB storage). No GPU, Redis, or runtime ML service is required. The minimal stack is two containers: the application service with embedded web assets, and PostgreSQL with local filesystem storage. S3 and a reverse proxy are optional.

### 2.2 Design goals

- **3D-ready from day one.** The initial experience can be 2D, but all assets and relations must support a future 3D view without migration.
- **Low setup effort.** A useful map and plan should emerge from an address with minimal user work.
- **Local-first where practical.** Editing, planning, and vision inference run in the browser.
- **Private by default.** Imagery and inference stay on the user's device; only accepted results are stored.
- **Single-tenant simplicity.** One property per instance, multiple family users and roles.
- **Open and replaceable.** Every external provider is an adapter; no vendor lock-in.
- **Low operations.** No message broker, no separate ML server, no mandatory SaaS.
- **Resilient on modest hardware.** The reference deployment is a single-board computer, not a cloud cluster.

---

## 3. Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Frontend compute | Client-heavy PWA with a single 3D scene | Low latency, fewer server resources, 3D-ready |
| Vision runtime | In-browser inference using ONNX; MVP starts with user-driven mapping | No GPU server, imagery stays on-device; detection accelerates setup later |
| Model production | Dedicated Python model lab (build-time) | Best training ecosystem; not part of the runtime footprint |
| Backend | Rust HTTP application service | Small images, predictable performance, low memory |
| Persistence | PostgreSQL with geospatial support | Reliable single-property state and spatial queries |
| Care knowledge | Built-in knowledge curated with LLM assistance during development/support; deterministic runtime rules | Timely, specific, explainable, offline-capable advice |
| Planning | One deterministic rules core used by browser and server | Consistent plans; server can send notifications when the browser is closed |
| Tenancy | One property per instance | Removes tenant logic and cross-tenant risk |
| Multi-user | Family accounts with roles | Shared property, simple authorization |
| Sync | Versioned resources plus real-time events | Handles family members editing from multiple devices |
| Data sources | Open provider adapters | No mandatory keys or vendor accounts |
| Delivery | Web-only PWA | No app stores or platform certification |
| Deployment | ARM64 single-board reference | Proves the minimum-footprint constraint |
| Storage | Local filesystem by default, S3 optional | Two-container minimal install |

---

## 4. System Overview

```
+--------------------------------------+
|  Browser / PWA                       |
|  3D map and editing                  |
|  Planning and rule evaluation        |
|  On-device vision inference          |
|  Offline cache and sync queue        |
+------------------+-------------------+
                   |
            HTTPS + WebSocket
                   |
+------------------v-------------------+
|  Rust application service            |
|  Auth, persistence, sync,            |
|  plan scheduling, notifications,     |
|  open-data orchestration,            |
|  model and media serving             |
+----+-------------+-------------+-----+
     |             |             |
+----v----+  +-----v-----+  +----v--------------+
| Spatial |  | Local/S3  |  | Open data         |
| database|  | storage   |  | OSM, orthophotos, |
|         |  | imagery,  |  | Sentinel-2, DEM,  |
|         |  | media,    |  | weather, geocoder |
|         |  | models    |  +-------------------+
+---------+  +-----------+

Build-time only: Python model lab -> ONNX models -> app storage.
```

### Component responsibilities

| Component | Responsibility |
|---|---|
| **Browser / PWA** | User interface, 3D scene, editing, planning, browser inference, offline cache, sync queue |
| **Application service** | Authentication, persistence, real-time sync, plan scheduling, notifications, open-data orchestration, media/model serving |
| **Spatial database** | Property, assets, activities, users, and history |
| **Storage** | Imagery snapshots, model artifacts, photos, exports |
| **Model lab** | Training, ONNX export, quantization, validation, packaging (build-time only) |
| **Open data providers** | Maps, imagery, geocoding, elevation, weather |

### Deployment shape

The reference deployment is a **single ARM64 single-board computer**. The web bundle is embedded in the application service, so a minimal install is the application container plus PostgreSQL and local disk. The reverse proxy and S3-compatible storage are optional.

---

## 5. Frontend Architecture

### 5.1 Web-only PWA

- Standards-based HTML/CSS/JavaScript/WASM/WebGL/WebGPU.
- No native wrappers, app stores, Google/Apple SDKs, APNs, or FCM.
- Same build runs on desktop and mobile browsers; installed PWA is an enhancement, not a requirement.
- Notifications use Web Push (VAPID) with optional email.
- No external JavaScript CDNs, Google Fonts, or third-party trackers by default; assets are bundled and served by the instance.

### 5.2 3D-first rendering

- A single georeferenced scene per property.
- The initial "2D" experience is an orthographic top-down camera over that scene.
- A perspective orbit camera provides the future 3D experience without a separate data path.
- Every asset is modeled spatially with a position, footprint, and vertical extent.
- The property uses a local metric frame anchored to a geographic origin, keeping precision and rendering stable.

### 5.3 Client-side computation

The browser is responsible for work that benefits from low latency or local data:

- Scene construction and rendering.
- Geometry editing, snapping, and measurement.
- Full manual editing of areas, trees, species, and attributes; this is a first-class MVP capability, not a later fallback.
- Plan and rule evaluation.
- Weather-trigger evaluation.
- Imagery preprocessing and browser inference.
- Candidate review and correction.
- Local caching, offline operation, and the outgoing mutation queue.
- Search and filtering over the local inventory.

Heavy work runs in background workers so the interface remains responsive.

### 5.4 Browser inference

- **MVP independence:** the MVP does not depend on inference. Property data is initialized through user edits — marking areas, adding trees, and setting species. Full manual editing (add, move, reshape, split, merge, delete) ships from day one; inference is a later accelerator.
- Models are delivered as versioned ONNX artifacts and cached locally.
- Inference prefers WebGPU and falls back to WASM, then to assisted manual mapping on unsupported or too-slow devices.
- Imagery and derived masks stay on the device; only accepted asset geometry and explicit uploads are stored.
- Detection is advisory: users always review and confirm candidates.
- Model artifacts are checksum-verified and version-pinned.

### 5.5 Offline behavior

- The app shell, assets, plans, imagery snapshot, and model artifacts are cached.
- Mutations are queued and replayed on reconnect.
- Conflicts are detected server-side and resolved with clear user choices.
- Weather and new imagery refresh when connectivity returns; cached data keeps the app useful offline.

---

## 6. Backend Architecture

### 6.1 Application service

- A single Rust HTTP service owns durable state, with a small operational footprint.
- It serves the embedded web app, the API, real-time events, media, and model artifacts.
- It orchestrates open-data retrieval and caching for weather and imagery.
- It runs scheduled plan materialization and notification dispatch.

### 6.2 Persistence and sync

- Property state, assets, activities, users, and history live in a geospatial-capable relational database.
- Mutable resources carry versions; updates detect conflicts instead of silently overwriting.
- Committed changes are broadcast to connected clients over a real-time channel.
- The application remains single-tenant: one property, multiple family users, no tenant routing.

### 6.3 Planning and notifications

- Care knowledge is built into the product: a curated base of plant and facility knowledge is initiated and maintained with **LLM assistance during development and ongoing support**, then reviewed into deterministic rules and templates.
- The runtime does not call an external LLM. Plans remain reproducible, explainable, auditable, and available offline; knowledge updates ship as versioned content with app releases.
- The task UI is a kanban/todo flow with statuses, completion, and history; task generation and orchestration remain a separate concern.
- The same deterministic rules core runs in the browser for instant feedback and in the service for scheduled work.
- The service materializes upcoming activities so notifications work even when no browser is open.
- User decisions such as done, skipped, and snoozed take precedence over recomputation.
- Notifications are batched into a weekly digest by default; severe weather alerts are immediate.

### 6.4 Open-data orchestration

- Weather is fetched from open providers, normalized, and cached per property.
- Imagery is selected by region and date, staged as a license-compliant snapshot, and served to the browser for local inference.
- Geocoding uses open services with caching and a manual pin fallback.
- Attribution and license metadata are preserved and surfaced in the app and exports.
- Provider failures degrade to cached data, another provider, or manual input.

### 6.5 Media and models

- Photos, imagery snapshots, exports, and model artifacts are stored locally by default; S3-compatible storage is optional.
- Model manifests are versioned so a bad release can be rolled back or pinned.

---

## 7. Model Lab

The model lab is a dedicated Python project used during development and release, not a runtime service. Vision model work is **not on the MVP critical path**: the MVP ships with user-driven mapping, and detection is added later.

### 7.1 Responsibilities

- Dataset preparation and annotation management.
- Training and fine-tuning segmentation and detection models.
- Export to ONNX and optimization for browser execution.
- Quantization and per-device variants.
- Accuracy, latency, memory, and size evaluation, including browser tests.
- Model cards, provenance, licenses, and manifest generation.
- Publishing immutable artifacts to local storage, a release registry, or S3.

### 7.2 Model selection policy

- Open-weight models with redistributable licenses come first.
- Browser compatibility, size, and latency are constraints before accuracy.
- Models that cannot be exported reliably or are too heavy for a browser are replaced, not forced.
- Training happens on a workstation or CI; it never runs on the reference single-board computer.

### 7.3 Release gates

A model is publishable only when it meets:

- Accuracy targets and no significant regression.
- Output parity with the training reference.
- Size and memory budgets.
- Browser compatibility across major engines.
- License and provenance requirements.

---

## 8. Open Data and External Providers

All defaults are open and usable without a commercial account. Every provider is an adapter and can be replaced.

| Capability | Open defaults | Fallback |
|---|---|---|
| Context map | OpenStreetMap or a user-supplied tile URL | No global basemap; property orthophoto only |
| Aerial/satellite imagery | National open orthophotos, Sentinel-2, OpenAerialMap | Manual mapping, user-supplied imagery |
| Geocoding | Nominatim or Photon | Manual pin |
| Elevation | Open DEMs (Copernicus, SRTM, USGS) | Flat plane |
| Weather | Open-Meteo, MET Norway, NOAA/NWS | Cached weather, weather-aware rules disabled |
| Buildings | OpenStreetMap, open building footprints | Segmentation or manual drawing |
| Models | Open-weight, license-compatible models | Manual mapping |

### Policy

- Core onboarding and maintenance must work with **no commercial key configured**.
- Commercial imagery or weather may be added only as optional, user-configured adapters.
- Public endpoints are cached and used politely; rate limits are respected.
- Every source is attributed in the UI and exports.
- Provider failures are typed so the UI can fall back to cache, another provider, or manual input.
- No Google Maps, Apple MapKit, or other platform map SDKs are used.

---

## 9. Deployment and Hosting

### 9.1 Reference deployment

- ARM64 single-board computer: 4 cores, 4 GB RAM, 32 GB storage.
- USB SSD strongly preferred over SD card for database and cache.
- Docker or Podman with Compose.
- Minimal stack: application service with embedded web assets, plus PostgreSQL with local storage.
- Optional: reverse proxy, S3-compatible storage, tunnel sidecar.
- No GPU, Redis, message broker, or runtime ML service.

### 9.2 Hosting modes

- **In-house / LAN:** run the minimal stack on an SBC, mini PC, or NAS; no public DNS required.
- **VPN-only:** bind to the VPN interface; no public exposure.
- **Public via DNS and tunnel:** expose through a tunnel or a reverse proxy with TLS.
- **Managed hosting:** one isolated instance per tenant, with separate database, data volume, secrets, and subdomain.
- **Self-host and managed use the same artifacts**, so behavior stays consistent.

### 9.3 Footprint targets

| Target | Budget |
|---|---|
| Idle server RAM | At or below 1.5 GB |
| Install size excluding caches | At or below 2 GB |
| Client model download | At or below 100 MB first run, then cached |
| Server GPU | None |
| Required infrastructure services | Database + application only |

### 9.4 Upgrades, backup, and recovery

- Migrations are applied on upgrade with a clear rollback path.
- Database and data volumes are backed up regularly; restore is documented and tested.
- Imagery and model caches can be rebuilt and do not require backup.
- Users can export their full property data independently of backups.

---

## 10. Security and Privacy

- **Isolation:** one tenant per deployment; no cross-tenant access.
- **Accounts:** local accounts with family invites and owner/editor/viewer roles; optional generic OIDC.
- **Inference:** no server ML endpoint exists; imagery and inference stay on the user's device.
- **Input trust:** client-submitted detection results and geometry are validated server-side.
- **Integrity:** model artifacts are checksum-verified; media is validated and re-encoded.
- **Transport:** TLS in public deployments; secure WebSocket; secure cookies.
- **Privacy:** no third-party advertising, analytics, or social SDKs; telemetry is opt-in or off.
- **Data rights:** full export and hard delete.
- **Supply chain:** pinned dependencies, SBOM, vulnerability scanning, signed images, ARM64 builds tested in CI.

---

## 11. Performance and Footprint Targets

| Area | Target |
|---|---|
| Onboarding | First usable map and plan in under 5 minutes |
| Map interaction | Smooth editing and camera movement on mid-range laptops and phones |
| Plan updates | Visible feedback without blocking the interface |
| Browser detection | Once detection ships: under 45 seconds for a typical property on a mid-range laptop; under 90 seconds on mobile |
| Model download | Once detection ships: 100 MB or less on first run |
| Render | 60 fps desktop, 30 fps mobile for typical properties |
| ARM SBC | Responsive API under normal single-property load; no swap thrash |

These are product-level targets, not implementation budgets. Exact tuning belongs to the build phase.

---

## 12. Testing and Release Strategy

**Delivery approach:** development is driven by dogfooding on the maintainer's own property. In the MVP, property data is initialized **largely through user edits** — marking areas, adding trees, and setting species. Full manual editing ships with the first usable version because usable, high-quality data depends on it; quick manual data initiation beats automation. Detection is a later accelerator. Features are prioritized by observed friction and value, not completeness. Nice-to-have features are deferred until the core loop is proven in daily use.

### Testing stance during prototyping: least unit tests

We are prototyping the product and its interfaces, so the default is a **least-unit-test strategy**:

- Do **not** invest in broad unit-test coverage while behavior and structure are still moving.
- Coverage targets are not a goal at this stage. Premature tests encode assumptions that are likely to change, slow down experimentation, and become maintenance liability.
- Verification is driven primarily by **real use on the trial property**, supported by a thin set of checks that protect the core loop.

**Minimum verification set:**

- End-to-end smoke test for the core loop: quick data initiation, save/load, plan generation, activity completion, reload.
- Browser inference smoke test on fixture imagery across Chromium, Firefox, and WebKit (WebGPU and WASM paths).
- Zero-commercial-key onboarding check.
- ARM64 minimal-profile boot and footprint check.
- Upgrade and restore check for the reference deployment.

**When to add a unit or regression test:**

- A bug recurs or is expensive to catch manually.
- A module or interface has stabilized.
- The logic is hard to verify by hand, such as date, season, or rule edge cases.

**Release hygiene:** SBOM, vulnerability scanning, and image signing remain standard. These are supply-chain controls, not unit tests.

Once the core loop is stable, selectively raise coverage where it protects real value. Releases are versioned as a coherent set of web assets, service, and model manifest; model updates can ship independently through a pinned manifest.

---

## 13. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Open data coverage or quality varies | Region-aware adapters, caching, manual corrections, manual fallback |
| Open provider rate limits | Polite usage, caching, user-configurable endpoints |
| Imagery licensing or retention restrictions | License metadata, retention policy, provider abstraction |
| Browser model size and memory limits | Compact models, quantization, caching, manual fallback |
| WebGPU fragmentation on older devices | WASM fallback, capability detection |
| Client inference latency | Worker offloading, progressive results, clear progress |
| Model or training data licensing | Mandatory license review and model cards |
| ARM SBC CPU/RAM limits | Rust service, embedded web, low-memory database tuning, no extra services |
| SD card wear or corruption | USB SSD recommendation, backups, health checks |
| Web-only iOS limitations | Graceful degradation, email fallback, clear guidance |
| No app-store discoverability | Direct links, QR codes, SEO |
| Single-tenant provisioning overhead | Automated instance templates for managed hosting |
| Multi-user edit conflicts | Versioned updates and clear conflict handling |
| Notification reach without a browser | Server-side plan materialization plus Web Push and email |
| Privacy of home imagery | On-device inference, private-by-default data, deletion and export |

---

## 14. Open Questions

1. Which open imagery providers give the best coverage in each launch region?
2. Which launch region best balances open imagery quality and demand?
3. When should automated detection, including fence suggestions, be introduced after the MVP?
4. Should species identification be a browser model, a user shortlist, or both?
5. What is the minimum supported browser and device baseline?
6. Which iOS versions and behaviors must be supported for Web Push and storage?
7. Should the default geocoder be a public service or a recommended self-hosted instance?
8. Require a USB SSD, or support SD cards with reduced-write settings and warnings?
9. Where are the freemium boundaries?
10. Which hardware integrations matter first?
11. How long should imagery snapshots be retained under each license?
12. Should property boundaries come from open cadastral data, OSM, or user drawing?

---

## 15. Decision Summary

| Decision | Choice |
|---|---|
| Experience | 3D-first, 2D-presented |
| Compute | Client-heavy PWA |
| Vision | Browser ONNX inference; Python model lab for training and packaging |
| Backend | Rust application service |
| Persistence | PostgreSQL with geospatial support |
| Planning | Shared deterministic rules core |
| Tenancy | Single property per instance, multiple family users |
| Data | Open providers by default, no commercial key required |
| Delivery | Web-only PWA, no app stores or platform certification |
| Deployment | ARM64 single-board reference, two-container minimal stack |
| Storage | Local filesystem by default, S3 optional |
| Footprint | No GPU, Redis, or runtime ML service |

The design keeps MyGarden **small in footprint, small in logic, and rich in data**: one property, multiple family users, a 3D-ready twin, client-side intelligence, browser inference, open data, and a complete stack that fits on a single-board computer.
