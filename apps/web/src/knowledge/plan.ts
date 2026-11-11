import type { UserAsset } from '../property/types'
import { buildAssetCarePlans } from './match'
import type {
  AssetCarePlan,
  CareCadence,
  CarePriority,
  CareWeatherTrigger,
  CareTask,
} from './types'

export interface InspectionItem {
  id: string
  title: string
  description: string
  rationale: string
  dueDate: string
  assetLabels: string[]
  priority: CarePriority
  effortMinutes: number
  frequency: string
  conditions?: string
}

export interface PlannedActivity {
  id: string
  profileId: string
  profileName: string
  taskId: string
  title: string
  description: string
  rationale: string
  category: string
  kind: 'inspection' | 'care'
  assetIds: string[]
  assetLabels: string[]
  dueDate: string
  windowStart: string
  windowEnd: string
  year: number
  month: number
  priority: CarePriority
  effortMinutes: number
  frequency: string
  cadence: CareCadence
  conditions?: string
  weatherSensitive: boolean
  weather?: CareWeatherTrigger
  checklist?: InspectionItem[]
}

export interface MaintenancePlanMonth {
  month: string
  label: string
  activities: number
  minutes: number
}

export interface MaintenancePlanTotals {
  activities: number
  minutes: number
  assets: number
  byMonth: MaintenancePlanMonth[]
}

export interface MaintenancePlan {
  generatedAt: string
  referenceDate: string
  horizonStart: string
  horizonEnd: string
  activities: PlannedActivity[]
  totals: MaintenancePlanTotals
}

export interface GeneratePlanOptions {
  referenceDate?: Date
  horizonMonths?: number
}

interface TaskGroup {
  plan: AssetCarePlan
  task: CareTask
  assets: AssetCarePlan[]
}

function isoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function monthStart(year: number, month: number): Date {
  return new Date(year, month - 1, 1)
}

function monthEnd(year: number, month: number): Date {
  return new Date(year, month, 0)
}

function isIntervalCadence(cadence: CareCadence): boolean {
  return (
    cadence.type === 'weekly' ||
    cadence.type === 'fortnightly' ||
    cadence.type === 'interval'
  )
}

function intervalDays(cadence: CareCadence): number {
  if (cadence.type === 'weekly') return 7
  if (cadence.type === 'fortnightly') return 14
  if (cadence.type === 'interval') return cadence.intervalDays
  return 30
}

function makeActivity(
  group: TaskGroup,
  date: Date,
  start: Date,
  end: Date,
): PlannedActivity {
  return {
    id: `${group.plan.profileId}:${group.task.id}:${isoDate(date)}`,
    profileId: group.plan.profileId,
    profileName: group.plan.profileName,
    taskId: group.task.id,
    title: group.task.title,
    description: group.task.description,
    rationale: group.task.rationale,
    category: group.plan.category,
    kind: group.task.kind,
    assetIds: group.assets.map((entry) => entry.assetId),
    assetLabels: group.assets.map((entry) => entry.assetLabel),
    dueDate: isoDate(date),
    windowStart: isoDate(start),
    windowEnd: isoDate(end),
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    priority: group.task.priority,
    effortMinutes:
      group.task.effortMinutes * group.assets.length,
    frequency: group.task.frequency,
    cadence: group.task.cadence,
    conditions: group.task.conditions,
    weatherSensitive: Boolean(
      group.task.weatherSensitive || group.task.weather,
    ),
    weather: group.task.weather,
  }
}

function mergeWeather(
  activities: PlannedActivity[],
): CareWeatherTrigger | undefined {
  const merged: CareWeatherTrigger = {}

  for (const activity of activities) {
    if (!activity.weather) continue
    if (activity.weather.avoidRain) merged.avoidRain = true
    if (activity.weather.avoidFrost) merged.avoidFrost = true
    if (activity.weather.avoidWetSoil) merged.avoidWetSoil = true
    if (activity.weather.maxWindKmh != null) {
      merged.maxWindKmh = Math.min(
        merged.maxWindKmh ?? Number.POSITIVE_INFINITY,
        activity.weather.maxWindKmh,
      )
    }
  }

  return Object.keys(merged).length ? merged : undefined
}

function weekStart(date: Date): Date {
  const day = (date.getDay() + 6) % 7
  const monday = new Date(date)
  monday.setDate(monday.getDate() - day)
  return monday
}

function batchInspections(
  activities: PlannedActivity[],
): PlannedActivity[] {
  const care = activities.filter(
    (activity) => activity.kind !== 'inspection',
  )
  const inspections = activities.filter(
    (activity) => activity.kind === 'inspection',
  )

  const groups = new Map<
    string,
    {
      kind: 'weekly' | 'monthly'
      key: string
      activities: PlannedActivity[]
    }
  >()

  for (const activity of inspections) {
    const cadence = activity.cadence
    const isWeekly =
      cadence.type === 'weekly' ||
      cadence.type === 'fortnightly' ||
      cadence.type === 'interval'
    const due = new Date(`${activity.dueDate}T00:00:00`)
    const kind = isWeekly ? 'weekly' : 'monthly'
    const key = isWeekly
      ? `week:${isoDate(weekStart(due))}`
      : `month:${activity.year}-${String(activity.month).padStart(2, '0')}`

    const existing = groups.get(key)
    if (existing) {
      existing.activities.push(activity)
    } else {
      groups.set(key, { kind, key, activities: [activity] })
    }
  }

  const batched: PlannedActivity[] = []

  for (const group of groups.values()) {
    const items = [...group.activities].sort(
      (left, right) =>
        left.dueDate.localeCompare(right.dueDate) ||
        right.priority - left.priority ||
        left.title.localeCompare(right.title),
    )
    const dueDates = items.map((item) => item.dueDate).sort()
    const windowStarts = items.map((item) => item.windowStart).sort()
    const windowEnds = items.map((item) => item.windowEnd).sort()

    const checklist: InspectionItem[] = items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      rationale: item.rationale,
      dueDate: item.dueDate,
      assetLabels: item.assetLabels,
      priority: item.priority,
      effortMinutes: item.effortMinutes,
      frequency: item.frequency,
      conditions: item.conditions,
    }))

    const assetIds = [
      ...new Set(items.flatMap((item) => item.assetIds)),
    ]
    const assetLabels = [
      ...new Set(items.flatMap((item) => item.assetLabels)),
    ]
    const priority = Math.max(
      ...items.map((item) => item.priority),
    ) as CarePriority
    const effortMinutes = items.reduce(
      (sum, item) => sum + item.effortMinutes,
      0,
    )
    const conditions = [
      ...new Set(
        items
          .map((item) => item.conditions)
          .filter((value): value is string => Boolean(value)),
      ),
    ].join(' · ')
    const weatherSensitive = items.some(
      (item) => item.weatherSensitive,
    )
    const title =
      group.kind === 'weekly'
        ? 'Weekly garden inspection'
        : 'Monthly garden inspection'
    const count = checklist.length

    batched.push({
      id: `inspection:${group.kind}:${group.key}`,
      profileId: 'inspection',
      profileName:
        group.kind === 'weekly'
          ? 'Weekly inspection'
          : 'Monthly inspection',
      taskId: `inspection-${group.kind}`,
      title,
      description:
        group.kind === 'weekly'
          ? `Combined weekly inspection covering ${count} check${count === 1 ? '' : 's'} across the property.`
          : `Combined monthly inspection covering ${count} check${count === 1 ? '' : 's'} across the property.`,
      rationale:
        'Batching regular checks into one inspection reduces switching between tasks and makes changes across the property easier to compare.',
      category: 'inspection',
      kind: 'inspection',
      assetIds,
      assetLabels,
      dueDate: dueDates[0],
      windowStart: windowStarts[0],
      windowEnd: windowEnds[windowEnds.length - 1],
      year: new Date(`${dueDates[0]}T00:00:00`).getFullYear(),
      month: new Date(`${dueDates[0]}T00:00:00`).getMonth() + 1,
      priority,
      effortMinutes,
      frequency:
        group.kind === 'weekly'
          ? 'Weekly combined inspection'
          : 'Monthly combined inspection',
      cadence:
        group.kind === 'weekly'
          ? { type: 'weekly' }
          : { type: 'monthly' },
      conditions: conditions || undefined,
      weatherSensitive,
      weather: mergeWeather(items),
      checklist,
    })
  }

  return [...care, ...batched]
}

export function generateMaintenancePlan(
  assets: UserAsset[],
  options: GeneratePlanOptions = {},
): MaintenancePlan {
  const referenceDate = options.referenceDate ?? new Date()
  const horizonMonths = options.horizonMonths ?? 12

  const horizonStart = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  )
  const horizonEnd = new Date(
    horizonStart.getFullYear(),
    horizonStart.getMonth() + horizonMonths,
    1,
  )

  const carePlans = buildAssetCarePlans(assets)
  const taskGroups = new Map<string, TaskGroup>()

  for (const plan of carePlans) {
    for (const task of plan.tasks) {
      const key = `${plan.profileId}::${task.id}`
      const existing = taskGroups.get(key)

      if (existing) {
        existing.assets.push(plan)
      } else {
        taskGroups.set(key, {
          plan,
          task,
          assets: [plan],
        })
      }
    }
  }

  const activities: PlannedActivity[] = []

  // Non-interval tasks: one prompt in each relevant month.
  const cursor = new Date(
    horizonStart.getFullYear(),
    horizonStart.getMonth(),
    1,
  )

  while (cursor < horizonEnd) {
    const year = cursor.getFullYear()
    const month = cursor.getMonth() + 1
    const start = monthStart(year, month)
    const end = monthEnd(year, month)

    const candidates: TaskGroup[] = []

    for (const group of taskGroups.values()) {
      if (isIntervalCadence(group.task.cadence)) continue
      if (!group.task.months.includes(month)) continue
      candidates.push(group)
    }

    candidates.sort(
      (left, right) =>
        right.task.priority - left.task.priority ||
        right.task.effortMinutes - left.task.effortMinutes ||
        left.plan.profileId.localeCompare(right.plan.profileId) ||
        left.task.id.localeCompare(right.task.id),
    )

    const earliest =
      start < horizonStart ? horizonStart : start
    const latest =
      end < horizonEnd
        ? end
        : new Date(horizonEnd.getTime() - 24 * 60 * 60 * 1000)

    if (candidates.length && earliest <= latest) {
      const availableDays =
        Math.floor(
          (latest.getTime() - earliest.getTime()) /
            (24 * 60 * 60 * 1000),
        ) + 1

      for (let index = 0; index < candidates.length; index += 1) {
        const offset =
          candidates.length === 1
            ? 0
            : Math.floor(
                (index * (availableDays - 1)) /
                  (candidates.length - 1),
              )
        const due = addDays(earliest, offset)

        if (due >= horizonStart && due < horizonEnd) {
          activities.push(
            makeActivity(candidates[index], due, start, end),
          )
        }
      }
    }

    cursor.setMonth(cursor.getMonth() + 1)
  }

  // Interval tasks: continuous schedule across each run of relevant months.
  for (const group of taskGroups.values()) {
    if (!isIntervalCadence(group.task.cadence)) continue

    const relevantMonths: Array<{
      year: number
      month: number
      start: Date
      end: Date
    }> = []

    const monthCursor = new Date(
      horizonStart.getFullYear(),
      horizonStart.getMonth(),
      1,
    )

    while (monthCursor < horizonEnd) {
      const year = monthCursor.getFullYear()
      const month = monthCursor.getMonth() + 1
      if (group.task.months.includes(month)) {
        relevantMonths.push({
          year,
          month,
          start: monthStart(year, month),
          end: monthEnd(year, month),
        })
      }
      monthCursor.setMonth(monthCursor.getMonth() + 1)
    }

    if (!relevantMonths.length) continue

    const first = relevantMonths[0].start
    const last = relevantMonths[relevantMonths.length - 1].end
    const step = intervalDays(group.task.cadence)
    let date = new Date(first)

    while (date <= last) {
      const month = date.getMonth() + 1
      if (
        date >= horizonStart &&
        date < horizonEnd &&
        group.task.months.includes(month)
      ) {
        const year = date.getFullYear()
        activities.push(
          makeActivity(
            group,
            date,
            monthStart(year, month),
            monthEnd(year, month),
          ),
        )
      }
      date = addDays(date, step)
    }
  }

  const plannedActivities = batchInspections(activities)

  plannedActivities.sort(
    (left, right) =>
      left.dueDate.localeCompare(right.dueDate) ||
      right.priority - left.priority ||
      right.effortMinutes - left.effortMinutes,
  )

  const monthTotals = new Map<
    string,
    { label: string; activities: number; minutes: number }
  >()

  for (const activity of plannedActivities) {
    const key = `${activity.year}-${String(activity.month).padStart(2, '0')}`
    const existing = monthTotals.get(key)
    const label = new Date(
      activity.year,
      activity.month - 1,
      1,
    ).toLocaleDateString('en-NZ', {
      month: 'long',
      year: 'numeric',
    })

    if (existing) {
      existing.activities += 1
      existing.minutes += activity.effortMinutes
    } else {
      monthTotals.set(key, {
        label,
        activities: 1,
        minutes: activity.effortMinutes,
      })
    }
  }

  const byMonth = [...monthTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, value]) => ({
      month,
      label: value.label,
      activities: value.activities,
      minutes: value.minutes,
    }))

  return {
    generatedAt: new Date().toISOString(),
    referenceDate: isoDate(referenceDate),
    horizonStart: isoDate(horizonStart),
    horizonEnd: isoDate(horizonEnd),
    activities: plannedActivities,
    totals: {
      activities: plannedActivities.length,
      minutes: plannedActivities.reduce(
        (sum, activity) => sum + activity.effortMinutes,
        0,
      ),
      assets: new Set(
        plannedActivities.flatMap((activity) => activity.assetIds),
      ).size,
      byMonth,
    },
  }
}
