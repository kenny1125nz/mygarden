# Care Knowledge Base

This folder holds the **deterministic care knowledge** used by MyGarden. It was initialised from the user’s property data for **3 Jay Street, Paparangi, Wellington**, and is intended to grow into the rule source for proactive task generation.

## Files

- `types.ts` — task/profile/plan types.
- `wellington.ts` — region metadata and the curated care profiles.
- `match.ts` — label/species/kind matching and care-plan grouping.
- `index.ts` — public exports.

The runtime does **not** call an LLM. The knowledge is curated into data and evaluated deterministically.

## Region assumptions

- Southern Hemisphere seasons: spring Sep–Nov, summer Dec–Feb, autumn Mar–May, winter Jun–Aug.
- Temperate maritime Wellington climate: mild, windy, humid, occasional frosts, summer dry spells.
- Approximate timing for a suburban garden around 150 m elevation; adjust for aspect, shelter, soil, cultivar, and microclimate.
- Check for nesting birds before cutting hedges/trees, and follow local rules and product labels.
- Confirm species and any pest/disease treatment with a local horticulturist or garden centre.

This is an **LLM-assisted draft for local horticultural review**, not a substitute for expert advice, product labels, or local regulations.

## Matching rules

A profile is chosen by the highest score:

1. **Label match** — exact or substring match on the asset label (highest priority; specific phrases win).
2. **Species match** — exact or alias match on the asset species.
3. **Kind fallback** — tree/lawn/bush/area fallback profile.

This is important for the trial property because several assets are labelled in ways that differ from their app kind:

- `Vegie Beds` is stored as a **lawn** but is matched to **Vegetable beds** by label.
- `Hedge Unknown` and `Hedge` are stored as **tree points** but matched to the generic **Hedge / shrub** profile by label.
- `Fence Hedge` matches the more specific **Fence-line hedge** profile.
- `Bamboo` appears as both a tree point and a bush polygon; both match **Bamboo**.
- `Boxwood` polygons match **Boxwood / Buxus hedge**.
- `Camilia` (misspelled) matches **Camellia** through the aliases.
- `Yellow Pohutokawa` matches **Pōhutukawa**.
- Driveway, pavements, and paver labels match the shared **hardscape** profile.

All 29 trial assets currently resolve to a specific profile; none fall back to the generic tree profile.

## What each profile contains

Each `CareProfile` has:

- identity, category, matching aliases;
- a plain-language summary;
- `watchFor` risks;
- regular care tasks with:
  - a seasonal window (`months`, 1–12),
  - frequency,
  - priority (1 cosmetic to 5 critical),
  - estimated effort,
  - description and rationale,
  - conditions and weather sensitivity where relevant.

The task engine can use the months/priority/effort/conditions directly. Each task also has:

- `cadence` — machine-readable repeat type: `once`, `monthly`, `weekly`, `fortnightly`, `interval`, `per_month`, or `as_needed`.
- `weather` — structured weather flags such as `avoidRain`, `avoidFrost`, `avoidWetSoil`, and `maxWindKmh`.

These fields are derived deterministically from the human-readable frequency and conditions, so the knowledge remains readable while still being usable by the plan generator.

## Plan generation

`plan.ts` turns the profiles and the property assets into a 12-month `MaintenancePlan`:

- Matches each asset to a profile.
- Groups identical profile tasks across assets.
- Expands task windows into dated activities.
- Multiplies effort by the number of affected assets.
- Emits a stable activity ID, due date, window, priority, effort, asset IDs/labels, cadence, conditions, and weather flags.
- Produces monthly totals for planning and previews.

Scheduling rules:

- `once`, `monthly`, `per_month`, and `as_needed` produce one prompt in each relevant month, spread across the month rather than clustered on day one.
- `weekly`, `fortnightly`, and `interval` produce a continuous schedule across the relevant months.
- A partial current month starts from the reference date.
- The horizon is 12 months, ending at the start of the same month next year.

## Inspection batching

Tasks whose titles start with **Check**, **Inspect**, **Monitor**, **Look for**, or **Watch** are marked as `kind: 'inspection'`. The plan generator batches them into regular inspections:

- Weekly / fortnightly / interval inspections are grouped by week into a **Weekly garden inspection**.
- Monthly / annual / as-needed inspections are grouped by month into a **Monthly garden inspection**.
- Each batched activity carries a checklist preserving the individual task title, assets, description, rationale, conditions, priority, effort, and original due date.
- Effort is summed, priority is the highest item, and weather flags are merged.
- This keeps regular checks visible without filling the calendar with dozens of separate “Check …” activities.

Inspection activities are not linked to a species profile; their checklist contains the species-specific checks instead.

The generated plan is a preview of the deterministic schedule. The next layer is the kanban/todo task system, which will apply user completion, skips, snoozes, and weather overrides.

## Review checklist

Before relying on the knowledge base, review:

1. **Species confirmation** — especially camellia cultivars, the bamboo’s running/clumping habit, citrus types, and the unknown flowering tree.
2. **Pruning timing** — confirm against the actual flowering/harvest cycle and local advice.
3. **Myrtle rust** — confirm current MPI reporting and handling guidance for pōhutukawa.
4. **Pest/disease products** — verify local availability, labels, and restrictions; the knowledge base does not prescribe chemicals.
5. **Nesting birds** — confirm local wildlife rules and timing before hedge/tree work.
6. **Water restrictions** — confirm current local rules before recommending irrigation.
7. **Frost and wind** — adjust for the property’s actual shelter and microclimate.

## Extending

Add a profile in `wellington.ts` with:

- normalized species/label aliases in `match`;
- a summary and `watchFor`;
- tasks with months, frequency, priority, effort, rationale, and conditions.

Then add or update a matching test/smoke check. Keep advice conservative, explain the reason for each task, and prefer observation + light intervention where species or conditions are uncertain.
