# MyGarden — Concept Document

**Working title:** MyGarden
**Type:** Web application (responsive, mobile-first PWA)
**Status:** Concept / pre-MVP
**One-line pitch:** Turn a real property into a living garden game — mapped from open aerial imagery, maintained through proactive, knowledge-driven, weather-aware quests, and leveled up by caring for actual trees, lawns, fences, and devices.

---

## 1. Executive Summary

MyGarden exists because **neglected gardens become expensive**. Missed watering, pruning, mowing, fence care, and equipment servicing waste resources, cause avoidable damage, shorten the life of plants and facilities, and turn small tasks into costly catch-up work. The core problem is not a lack of tools to record a garden; it is a lack of timely, specific guidance on what to do before neglect compounds.

MyGarden addresses this by building an editable **digital twin of the property** and producing **proactive maintenance activities** based on built-in knowledge of the target plants and facilities. That knowledge is initiated and maintained with **LLM assistance as part of application development and ongoing support**, then applied by deterministic, explainable rules. Recommendations account for species and asset type, season, local climate, weather, service intervals, and the user's own history.

Setup is deliberately lightweight: the user enters an address, open aerial imagery is fetched, and the user quickly marks areas, adds trees, and sets species on an editable map. In the MVP this initialization is largely user-driven; assisted detection is a later optimization, not a dependency. The work is presented as a **game**: the property is the game board, assets are characters/cards, maintenance tasks are quests, and real-world care earns progress, badges, and a visibly flourishing garden.

The core bet: **if a useful map and proactive plan can be produced in under five minutes, users will act before small issues become costly ones.**

MyGarden is deliberately **open, web-only, and small**: it uses open data by default, runs as a PWA without app-store certification, and the complete stack fits on an ARM single-board computer.

---

## 2. Problem

Neglect is rarely a single mistake; it compounds. Wasted water and fertilizer, avoidable repairs, plant replacement, and catch-up labor all raise the true cost of an unmanaged garden. Property owners routinely under-maintain gardens and equipment because:

1. **They do not know what needs doing.** Care depends on species, season, weather, and equipment manuals.
2. **They forget timing.** Pruning, fertilizing, winterizing, gutter cleaning, and device servicing are easy to miss.
3. **Inventory is in their head.** Most people cannot list their trees, lawn zones, fences, irrigation, and devices, let alone service histories.
4. **Existing tools demand too much setup.** Drawing every zone and entering every plant causes abandonment before value is delivered.
5. **Maintenance apps feel like chores.** They do not create a reason to return.

---

## 3. Target Users

### Primary personas

| Persona | Description | Core need |
|---|---|---|
| **New homeowner** | Bought a property with an established garden; low gardening knowledge | "Tell me what to do and when; don't make me set it all up." |
| **Busy improver** | Wants a healthy garden but has limited time | Fast weekly plan, weather-aware rescheduling |
| **Enthusiast gardener** | Enjoys gardening and wants records | Inventory, history, species-specific care, notes and photos |
| **Small property manager** | Manages a rental, smallholding, or multiple plots | Multi-property dashboard, compliance and service logs |

### Secondary personas

- Landlords and property managers needing maintenance evidence.
- Community gardens and shared spaces.
- Gardeners offering services to neighbors (future marketplace).

---

## 4. Principles and Constraints

### 4.1 Product principles

1. **Zero-effort first, perfect later.** Deliver a useful plan from an address alone; refine over time.
2. **The map is the interface.** Everything is anchored to a place on the property.
3. **Proactive, not nagging.** Recommend the next best action; avoid notification spam.
4. **Weather-aware by default.** Never suggest mowing in the rain or watering before a storm.
5. **The real garden is the game.** Gamification reflects real care, not fake taps.
6. **Species uncertainty is acceptable.** Generic care is a valid fallback; identification improves over time.
7. **Privacy-first.** Gardens are private by default; imagery is processed for the user, not published.
8. **Respect data licenses.** Only use imagery and geodata in ways their terms permit.

### 4.2 Non-negotiable platform constraints

1. **Open data first.** Maps, aerial/satellite imagery, geocoding, elevation, and weather default to openly available sources. The app must work with **no commercial API key and no vendor account**. Commercial sources are optional and user-configured only.
2. **Web only and independent.** The product is a standards-based PWA. There is no native iOS/Android app, no app-store submission, no APNs/FCM, no Google Maps or Apple MapKit, no Google/Apple sign-in, and no platform certification. Notifications use Web Push and email. Data lives in the user's own instance.
3. **Minimum footprint.** Everything needed must run on a single ARM64 single-board computer (Raspberry Pi 4/5 class, 4 GB RAM, 32 GB storage). No GPU, Redis, or runtime ML service. The minimal stack is two containers (application with embedded web assets, PostgreSQL) with local filesystem storage; S3 and a reverse proxy are optional.

These constraints take precedence over convenience. If a feature cannot satisfy them, it does not ship in the default product.

---

## 5. Core Concept

### 5.1 The digital twin

A property contains **assets**:

- **Trees** (location, species, size, health)
- **Lawn areas** (shape, grass type, sun exposure)
- **Garden beds, hedges, and shrubs**
- **Fences** (length, material, condition)
- **Buildings** (context and roof/gutter tasks)
- **Devices** (irrigation, robot mower, sensors, lights)
- **Other** (compost, water features, paths)

Each asset can hold notes, photos, install dates, and maintenance history. The initial map may be displayed in 2D, but the data model is **3D-ready from day one**: every asset has a position, geometry, and vertical extent, so a 3D view can be added without migration.

### 5.2 The proactive plan

A rule and knowledge engine turns assets, location, season, and weather into a ranked list of upcoming and due activities:

- **Planned activities** generated from care templates.
- **Ad hoc activities** added by the user at any time.

### 5.3 The game

The plan is rendered as quests. Completing real-world care updates asset health, earns progress, unlocks badges, and makes the stylized garden view flourish. The game is a motivation layer over real outcomes, not a separate idle game.

```
+---------------------------------------------------+
|  GAME LAYER      quests, levels, badges, streaks  |
+---------------------------------------------------+
|  INTELLIGENCE    season, weather, climate, rules  |
+---------------------------------------------------+
|  DIGITAL TWIN    property map, assets, history    |
+---------------------------------------------------+
```

---

## 6. Key User Journeys

### 6.1 Onboarding: address to plan in under 5 minutes

1. User enters an address or drops a pin.
2. The app resolves the property and fetches open imagery.
3. The user marks the main lawn, bed, fence, and building areas, adds trees, and sets species where known.
4. Boundaries can be refined over time; precision is not required on the first pass.
5. The app asks only essential setup questions, such as which equipment exists.
6. The app generates the first week and season plan.
7. The user lands on a dashboard with 2-3 immediate tasks.

In the MVP, property initialization is largely user-driven. Assisted detection is a later accelerator, not a prerequisite. Every step is skippable, and every skipped question has a sensible default.

### 6.2 Weekly maintenance loop

- A weekly digest or push notification summarizes the next few quests.
- The dashboard shows a ranked list with weather-aware timing.
- The user completes, skips, or snoozes tasks.
- Progress and garden health update; the streak continues.
- Critical issues escalate gently (for example, frost protection).

### 6.3 Ad hoc activity

The user can add an activity at any time, optionally attach it to an asset, set a date, and make it repeat. Ad hoc activities become part of history and can spawn follow-ups.

### 6.4 Seasonal transitions

At season boundaries the plan recalculates: autumn leaf clearance and winterization, spring mowing ramp-up and fertilizing, summer watering and pest checks, and winter rest and tool service.

---

## 7. Feature Breakdown

### 7.1 MVP (first usable product)

These are the capabilities the first usable product should eventually cover. They do **not** all need to ship in the first build: the trial property can start with manual data entry and basic tasks, then adopt detection, weather, notifications, and game elements as they land.

In the MVP, property data initialization is intentionally **user-driven**: the user marks areas, adds trees, and sets species. Automated detection is a later optimization.

- Open geocoding with manual pin fallback.
- Open imagery fetch and a cached property snapshot.
- Editable 2D map backed by 3D-ready data.
- User-driven asset entry and **full manual editing from day one**: mark, reshape, split, merge, and delete lawn/bed/fence/building areas; add trees; set species and attributes. Assisted detection comes later.
- Asset inventory with attributes, notes, and photos.
- Initial care knowledge base for the asset types present, drafted with LLM assistance and reviewed into deterministic rules.
- Knowledge/rule-based task generation from property data and the care knowledge base.
- Seasonal plan generation and task orchestration.
- Open weather integration with weather-aware scheduling.
- Activity lifecycle: planned, done, skipped, snoozed, ad hoc.
- Kanban/todo task board with add/edit/complete/skip/snooze and history.
- PWA notifications: Web Push digest and severe-weather alerts, plus optional email.
- Mobile-first responsive UI and PWA install.
- Minimal two-container ARM single-board deployment.

### 7.2 Backlog (after MVP)

- Assisted detection of buildings, lawn, and trees.
- Fast tap-to-segment corrections.
- Photo-based species identification in the browser.
- Full gamification: levels, badges, streaks, collection, and the stylized garden view.
- Multi-date imagery and change detection.
- Per-asset health tracking and a photo timeline.
- Multi-property support.
- Calendar export and integrations.
- Offline task mode.
- Fence and device suggestions.
- Hardware integrations.
- Community and marketplace features.

### 7.3 Explicit non-goals

- Guaranteed species identification from overhead imagery.
- Precise fence detection.
- Full landscape design/CAD tooling.
- Indoor plant management.
- A social network as the primary product.
- Native iOS/Android apps, app-store distribution, or Google/Apple platform SDKs.
- Mandatory commercial map, imagery, weather, or identity providers.
- A server GPU or runtime ML service.

---

## 8. Low-Effort Setup

This is the strategic core. The long-term goal is not perfect automation but **a strong first draft that is faster to correct than to create**. In the MVP, setup is largely manual: users mark areas, add trees, and set species. Detection is a later accelerator.

### 8.1 Open imagery and geodata

- **High-resolution orthophotos:** national open programs (for example NAIP in the US) where available.
- **Satellite imagery:** Sentinel-2 and other open sources for context and seasonality; coarse for individual trees.
- **Buildings and context:** OpenStreetMap and open building footprints.
- **Elevation:** open digital elevation models where useful.
- **Geocoding:** open geocoders, with manual pin fallback when coverage or rate limits are poor.

Open data coverage varies by region. The product degrades gracefully and relies more on user input where imagery is poor.

### 8.2 Detection approach (later optimization)

The MVP does not require automated detection. When it ships, detection runs **in the browser** using compact models delivered to the app. No imagery is uploaded for inference.

- Buildings: prefer open footprint data, then segmentation.
- Lawn and vegetation: vegetation indices and lightweight segmentation.
- Trees: tree-crown detection and segmentation.
- Fences: experimental line detection at most; manual tracing is the primary path.

The app proposes candidates with confidence indicators. Detection is advisory, never mandatory.

### 8.3 Human-in-the-loop correction

- When detection ships, auto-detected areas appear as editable overlays; in the MVP, users draw and edit areas directly.
- One-tap segmentation helps add missed trees and lawn patches once detection is available.
- Boundaries can be dragged, merged, split, and deleted.
- Bulk accept and undo keep correction fast.
- Corrections can improve future models, only with user consent.

### 8.4 Species identification

Overhead species identification is unreliable and must not block activation. The app uses:

1. A regional shortlist chosen by the user.
2. A browser-based photo classifier where available.
3. Context hints such as known plantings and neighborhood species.
4. A generic "deciduous / conifer / unknown" category with safe care rules.
5. Progressive profiling over time.

---

## 9. Maintenance Engine

Care knowledge is built into the product. It is initiated and maintained with **LLM assistance during development and ongoing support**, then curated into deterministic, explainable rules and care templates. The runtime does not depend on an external LLM: plans stay reproducible, auditable, and available offline.

### 9.1 Inputs

- Asset type, species, age, size, material, or device model.
- Location, climate zone, hemisphere, and local season.
- Weather forecast, recent weather, and growing degree days.
- Completion history, skipped tasks, user feedback, and photos.
- User preferences such as available time and notification sensitivity.

### 9.2 Rule types

| Trigger | Example |
|---|---|
| **Seasonal** | Prune deciduous fruit trees in late winter dormancy |
| **Weather forecast** | Skip mowing if rain is expected within 24 hours |
| **Weather history / growth** | Start mowing when growth thresholds are reached |
| **Interval** | Inspect the fence annually; replace mower blades periodically |
| **Observation** | After a user photo flags yellowing lawn, suggest aeration |
| **Dependency** | Only suggest overseeding after scarification |
| **Manual** | "Fix loose fence panel" |

### 9.3 Example care rules

- **Lawn:** mow during active growth, skip when wet; fertilize in spring; raise cut height in heat; scarify, aerate, and overseed in autumn; avoid traffic on frosty grass.
- **Deciduous fruit tree:** dormant prune, mulch and pest checks in spring, summer prune and fruit thinning, harvest and leaf cleanup in autumn.
- **Conifer:** minimal pruning, annual inspection, mulch and water during establishment.
- **Hedge:** trim during the growing season; check for nesting birds before cutting.
- **Fence:** annual inspection, periodic treatment, and post-storm checks.
- **Irrigation:** spring start-up, weather-adjusted scheduling, autumn winterization.
- **Devices:** blade replacement, firmware updates, cleaning, battery health, and seasonal storage.
- **Building context:** gutter cleaning after leaf fall and before heavy rain.

### 9.4 Explainability

Every recommended activity states **why**: "Frost is expected Tuesday; protect young citrus." Trust depends on visible reasoning; unexplained tasks feel arbitrary. Users can snooze, skip, or give feedback, and the plan adapts.

---

## 10. Weather, Location, and Climate Intelligence

- **Forecast:** open providers by default, with no key required. A user-configured commercial provider is optional.
- **History:** open reanalysis to estimate local last-frost dates and growth baselines.
- **Climate zones:** hardiness and climate classifications to tune species and timing.
- **Hemisphere-aware seasons:** never hard-code northern-hemisphere months.
- **Local constraints:** watering restrictions, burn bans, frost warnings, and storm alerts.
- **Notifications:** severe weather immediately; routine tasks batched into a weekly digest.

If weather data is unavailable, the app keeps working with cached data and manual activities.

---

## 11. Gamification Design

### 11.1 Philosophy

The game must be **honest**: progress corresponds to real care. No pay-to-win, no punishing mechanics, no fake urgency. The game exists to make maintenance satisfying and memorable.

### 11.2 Mechanics

| Mechanic | Design |
|---|---|
| **Garden health** | 0-100 per asset and property-wide, driven by overdue critical tasks and observations. Recovers with care. |
| **Progress and levels** | Earned by completing real activities; weighted by effort and criticality. |
| **Quests** | Weekly generated from the maintenance plan; focused, time-boxed, weather-aware. |
| **Streaks** | Weekly check-in streak with freeze tokens to survive vacations. |
| **Badges** | "First harvest", "Winter-ready", "Fence keeper", "Tree whisperer". |
| **Collection** | Each identified plant becomes a card with care information and history. |
| **Garden view** | A stylized view that reflects real assets and seasons and grows as tasks are completed. |
| **Seasonal events** | Themed quests for spring wake-up, summer survival, autumn prep, and winter rest. |
| **Optional social** | Opt-in neighbor leaderboards and shared community gardens; private by default. |

### 11.3 Anti-patterns to avoid

- Streak anxiety and guilt-based notifications.
- Rewards for in-app actions disconnected from real care.
- Loot boxes or aggressive monetization.
- Public sharing by default.
- Over-gamification that obscures actual maintenance information.

---

## 12. Information Architecture

```
Home / Garden Dashboard
  - Garden health, level, streak
  - This week's quests
  - Weather-aware alerts
  - Quick add activity

Map / Digital Twin
  - Asset layers (trees, lawn, fences, devices, buildings)
  - Add / edit geometry
  - Asset detail

Assets / Inventory
  - Filter by type
  - Asset detail: attributes, photos, history, care plan

Plan / Calendar
  - Upcoming activities (week/month/season)
  - Completed history
  - Ad hoc activities

Garden Game
  - Levels, badges, collection
  - Seasonal events
  - Stylized garden view

Settings
  - Property and location
  - Climate and preferences
  - Notifications
  - Data, privacy, export/delete
```

---

## 13. Architecture Overview

```
+--------------------------------------+
|  Browser / PWA                       |
|  3D map and editing                  |
|  Planning and rule evaluation        |
|  On-device vision inference          |
|  Offline cache                       |
+------------------+-------------------+
                   |
            HTTPS + WebSocket
                   |
+------------------v-------------------+
|  Rust application service            |
|  Auth, persistence, sync,            |
|  plan scheduling, notifications,     |
|  open-data orchestration             |
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

Key properties:

- **3D-first:** the web app renders a single 3D scene; the initial 2D view is a projection of it.
- **Client-heavy:** editing, planning, and vision inference run in the browser.
- **Open data:** no commercial map, imagery, geocoding, or weather account is required.
- **Small server:** the minimal deployment is the Rust service plus PostgreSQL with local storage.
- **Single-tenant:** one property per instance, with multiple family users and roles.

---

## 14. Deployment and Independence

- **Reference deployment:** one ARM64 single-board computer, roughly 4 GB RAM and 32 GB storage, preferably with a USB SSD.
- **Minimal stack:** two containers — the application service with embedded web assets, and PostgreSQL/PostGIS with local disk storage.
- **Optional:** reverse proxy, S3-compatible storage, and a tunnel sidecar.
- **Self-hosting modes:** in-house/LAN, VPN-only, or public through DNS plus a tunnel.
- **Managed hosting:** one isolated instance per tenant, with separate data and secrets.
- **Web-only:** no app stores, native wrappers, Google/Apple SDKs, APNs, or FCM.
- **Open data:** works without commercial API keys; open providers are configurable and replaceable.
- **Offline:** core maintenance and cached planning continue to work without connectivity; new imagery and weather refresh when online.

---

## 15. Security and Privacy

- Each deployment is isolated; there are no cross-tenant queries.
- Local accounts with family invites and owner/editor/viewer roles; optional generic OIDC.
- Aerial imagery and inference stay on the user's device; only accepted geometry and explicit uploads are stored.
- No third-party advertising, analytics, or social SDKs.
- Data is private by default, with full export and hard delete.
- Backups and restore are documented for the reference deployment.
- Open-source attribution is preserved in the app and exports.

---

## 16. Key Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Open imagery coverage and quality vary | Poor auto-detection | Region-aware providers, manual correction, manual pin/imagery fallback |
| Open data rate limits | Slow onboarding | Caching, polite usage, user-configurable endpoints |
| Tree species cannot be identified overhead | Wrong care rules | Never block on species; generic categories; photo ID |
| Fence detection unreliable | Bad automation | Suggestions only; manual tracing primary |
| Onboarding still requires corrections | Abandonment | Fast correction UX, bulk accept, sensible defaults |
| Wrong or noisy recommendations | Loss of trust | Explainable rationale, feedback, easy snooze/skip |
| Notification fatigue | Churn | Weekly digest default; only severe weather immediate |
| Weather forecast inaccuracy | Mistimed tasks | Use windows, not exact dates; re-evaluate daily |
| Privacy concerns about aerial imagery | Trust | On-device inference, private by default, deletion |
| Browser model size and inference cost | Slow onboarding on low-end devices | Compact models, caching, manual-mapping fallback |
| ARM SBC resource limits | Unreliable self-hosting | Two-container minimal stack, low-memory tuning, footprint gates |
| SD card wear | Data loss | USB SSD recommendation, backups, health checks |
| Web-only limitations on iOS | Missing push or storage eviction | Graceful degradation, email fallback, clear guidance |
| No app-store discoverability | Slower acquisition | Direct links, QR codes, SEO, privacy positioning |

---

## 17. Roadmap: Build the MVP Now

**Approach:** get the MVP into real use on my own property as fast as possible. This is not a multi-phase feature catalogue; it is an ordered build list for the next usable version. Everything not on this list is backlog until the MVP is in weekly use.

### MVP definition

The MVP is done when:

- The property and its main assets are in the app through user edits: areas marked, trees added, and species set.
- Full manual editing works from day one, so users can reach high-quality data without waiting for automation.
- The initial care knowledge base is in place for the asset types present.
- Knowledge/rule-based task generation produces proactive activities with a short rationale.
- Tasks are managed through a working kanban/todo flow with completion history.
- The owner uses the app weekly on the real garden.
- Basic weather-aware behavior works for the core rules.
- The app runs on the reference ARM stack and is usable from a phone.

### Build now, in order

1. **Property data initialisation** (one workflow, largely user-driven in the MVP)
   - Enter an address or pin, fetch open imagery, and establish the property boundary.
   - The user marks the main lawn, beds, fences, and buildings; adds trees; and sets species where known.
   - Provide **full manual editing from day one**: add, move, reshape, split, merge, and delete areas, trees, species, and attributes at any time.
   - Capture only minimal attributes, notes, and photos. Skip uncertain details for now; they remain editable in the same flow.
   - Manual editing is a prerequisite for usable data, not a later feature. Assisted detection is a later optimization.

2. **Knowledge-based data initialisation (LLM-assisted)**
   - Stand up the initial care knowledge base for the asset types present on the property.
   - Capture plant and facility care needs: seasonality, intervals, conditions, and rationale.
   - Use LLM assistance to draft the knowledge, then review and curate it into deterministic rules.
   - This must be in place before task generation begins.

3. **Task system** (three parts)
   - **Kanban/todo module:** statuses, add/edit, complete, skip, snooze, and history.
   - **Knowledge/rule-based task generation:** derive candidate tasks from property data plus the care knowledge base.
   - **Task orchestration/scheduling:** prioritize, set time windows, adjust for season and weather, and deduplicate.

4. **Daily-use interface**
   - Mobile-first map and task list.
   - Task details, notes, photos, and completion history.
   - Persistence, with offline use where practical.

5. **Basic awareness**
   - Integrate open weather.
   - Make the core rules weather-aware.
   - Start with in-app reminders or email; add Web Push when quick.

6. **Deploy and dogfood**
   - Run the minimal ARM stack.
   - Use it on the property for several weeks.
   - Keep a friction and issue log; fix blockers, not cosmetics.

### Not now

- Automated CV detection (manual tracing is enough to start).
- Species photo identification.
- Change detection.
- Full gamification: levels, badges, streaks, collection, and the stylized garden view.
- Community, marketplace, and leaderboards.
- Hardware integrations.
- Advanced 3D visuals.
- Multi-property.
- Broad external beta.
- Broad unit-test coverage and coverage targets.

### Ordering rule

Build the smallest thing that lets the next real garden task be entered and completed. If it does not help get the MVP into weekly use, it is backlog.

### Testing stance during the trial

- We apply a **least-unit-test strategy** while prototyping.
- Broad unit-test coverage is deliberately deferred: early tests encode changing assumptions and are more likely to create maintenance liability than value.
- Verification relies on real use on the trial property, a thin end-to-end smoke suite for the core loop, and targeted checks for stable or failure-prone logic.
- Unit or regression tests are added when an interface stabilizes or a bug recurs.
- Quality gates focus on what must not break: data safety, onboarding, plan generation, and activity completion. Coverage percentage is not a goal.

---

## 18. Success Metrics

### Activation
- Median time to first usable property map under 5 minutes, whether mapped manually or with assistance.
- Median time to first generated plan under 2 minutes.
- High share of quick data initiation completed in one session.

### Engagement
- Weekly active gardens versus monthly active gardens.
- Weekly quest completion rate above 50%.
- 4-week and 12-week retention.
- Notification opt-out rate below 10%.

### Outcome
- User-reported confidence in garden care.
- Reduction in missed seasonal tasks.
- Asset health trends over time.
- Net promoter score above 40.

### Quality and platform
- Recommendation acceptance and snooze rates.
- Onboarding completion with zero commercial API keys.
- PWA install and Web Push success by browser and OS.
- Minimal stack fits the ARM SBC footprint targets.
- Once automated detection ships: precision/recall per asset class and region, and correction rate per asset.

---

## 19. Open Questions

1. Which open imagery providers give the best coverage and resolution in target launch regions?
2. Start in the US with public-domain orthophotos, or in a European country with open orthophotos?
3. Which asset types must the MVP support in the first user-driven inventory?
4. For the MVP, is a species shortlist sufficient, or is photo identification needed early?
5. How much game is motivating versus distracting for each persona?
6. Where are the freemium boundaries?
7. Should property boundaries come from open cadastral data, OSM, or user drawing?
8. Which hardware integrations matter first?
9. Which open climate/hardiness model should be used per region?
10. How long should imagery snapshots be retained under each license?
11. Require a USB SSD, or support SD cards with warnings and reduced-write settings?
12. Public geocoder by default, or recommend self-hosting one?
13. Which iOS versions and behaviors must be supported for Web Push and storage?

---

## 20. Summary

MyGarden combines three ideas:

1. **A near-zero-setup digital twin** built from an address and open imagery, with browser-based vision.
2. **Proactive, weather- and season-aware maintenance** that explains what to do, when, and why.
3. **A game layer grounded in real care**, making property maintenance engaging rather than forgettable.

The differentiator is the **onboarding-to-plan loop**: address in, editable garden map and actionable plan out, in minutes — all on open data, without app stores, and small enough to run on a single-board computer.
