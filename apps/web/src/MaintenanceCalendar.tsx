import { useMemo, useRef, useState } from 'react'
import { downloadMaintenancePlan } from './property/export'
import type {
  CarePriority,
} from './knowledge/types'
import type {
  MaintenancePlan,
  PlannedActivity,
} from './knowledge/plan'

interface MaintenanceCalendarProps {
  plan: MaintenancePlan
  onOpenActivity: (activity: PlannedActivity) => void
  onSwipeTab?: (direction: 1 | -1) => void
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const PRIORITY_LABEL: Record<CarePriority, string> = {
  5: 'Critical',
  4: 'High',
  3: 'Routine',
  2: 'Low',
  1: 'Cosmetic',
}

function isoLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthPrefix(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatEffort(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

function formatSelectedDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-NZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function MaintenanceCalendar({
  plan,
  onOpenActivity,
  onSwipeTab,
}: MaintenanceCalendarProps) {
  const reference = new Date(`${plan.referenceDate}T00:00:00`)
  const firstPlanMonth = new Date(`${plan.horizonStart}T00:00:00`)
  const lastPlanMonth = new Date(`${plan.horizonEnd}T00:00:00`)
  lastPlanMonth.setMonth(lastPlanMonth.getMonth() - 1)

  const [monthCursor, setMonthCursor] = useState(
    new Date(reference.getFullYear(), reference.getMonth(), 1),
  )
  const [selectedDate, setSelectedDate] = useState(
    plan.referenceDate,
  )

  const swipeStart = useRef<{ x: number; y: number } | null>(null)

  const activitiesByDate = useMemo(() => {
    const map = new Map<string, PlannedActivity[]>()

    for (const activity of plan.activities) {
      const existing = map.get(activity.dueDate)
      if (existing) {
        existing.push(activity)
      } else {
        map.set(activity.dueDate, [activity])
      }
    }

    return map
  }, [plan.activities])

  const year = monthCursor.getFullYear()
  const month = monthCursor.getMonth() + 1
  const prefix = monthPrefix(monthCursor)
  const monthLabel = monthCursor.toLocaleDateString('en-NZ', {
    month: 'long',
    year: 'numeric',
  })
  const monthSummary = plan.totals.byMonth.find(
    (entry) => entry.month === prefix,
  )

  const firstOfMonth = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startOffset = (firstOfMonth.getDay() + 6) % 7

  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - startOffset + 1
    if (day < 1 || day > daysInMonth) return null

    const date = new Date(year, month - 1, day)
    const key = isoLocal(date)
    return {
      day,
      key,
      activities: activitiesByDate.get(key) ?? [],
    }
  })

  const selectedActivities =
    activitiesByDate.get(selectedDate) ?? []
  const selectedMinutes = selectedActivities.reduce(
    (sum, activity) => sum + activity.effortMinutes,
    0,
  )

  const canGoPrevious = monthCursor > firstPlanMonth
  const canGoNext = monthCursor < lastPlanMonth

  const selectFirstActivityOfMonth = (date: Date) => {
    const nextPrefix = monthPrefix(date)
    const firstActivity = plan.activities.find((activity) =>
      activity.dueDate.startsWith(nextPrefix),
    )
    setSelectedDate(firstActivity?.dueDate ?? `${nextPrefix}-01`)
  }

  const goMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1)
    setMonthCursor(next)
    selectFirstActivityOfMonth(next)
  }

  const goToday = () => {
    const next = new Date(reference.getFullYear(), reference.getMonth(), 1)
    setMonthCursor(next)
    setSelectedDate(plan.referenceDate)
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    swipeStart.current = { x: event.clientX, y: event.clientY }
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || !onSwipeTab) return

    const dx = event.clientX - start.x
    const dy = event.clientY - start.y

    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      onSwipeTab(dx < 0 ? 1 : -1)
    }
  }

  return (
    <section
      className="workspace-card calendar-card"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <div className="calendar-toolbar">
        <div>
          <h2>{monthLabel}</h2>
          <p>
            {monthSummary
              ? `${monthSummary.activities} activities · ${formatEffort(
                  monthSummary.minutes,
                )}`
              : 'No planned activities this month'}
          </p>
        </div>
        <div className="calendar-nav">
          <button
            type="button"
            onClick={() => goMonth(-1)}
            disabled={!canGoPrevious}
            aria-label="Previous month"
          >
            ‹
          </button>
          <button type="button" onClick={goToday}>
            Today
          </button>
          <button
            type="button"
            onClick={() => goMonth(1)}
            disabled={!canGoNext}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </div>

      <div className="calendar-layout">
        <div className="calendar-month">
          <div className="calendar-weekdays">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="calendar-grid">
            {cells.map((cell, index) =>
              cell ? (
                <button
                  type="button"
                  key={cell.key}
                  className={
                    cell.key === selectedDate
                      ? 'calendar-day selected'
                      : cell.key === plan.referenceDate
                        ? 'calendar-day today'
                        : 'calendar-day'
                  }
                  onClick={() => setSelectedDate(cell.key)}
                >
                  <span className="calendar-day-number">
                    {cell.day}
                  </span>
                  {cell.activities.length > 0 && (
                    <span className="calendar-day-count">
                      {cell.activities.length}
                    </span>
                  )}
                  <span className="calendar-day-items">
                    {cell.activities.slice(0, 2).map((activity) => (
                      <span
                        key={activity.id}
                        className={`calendar-item p${activity.priority}`}
                      >
                        {activity.title}
                      </span>
                    ))}
                    {cell.activities.length > 2 && (
                      <span className="calendar-more">
                        +{cell.activities.length - 2} more
                      </span>
                    )}
                  </span>
                </button>
              ) : (
                <span
                  className="calendar-day empty"
                  key={`empty-${index}`}
                />
              ),
            )}
          </div>
        </div>

        <aside className="calendar-agenda">
          <div className="agenda-head">
            <div>
              <h3>{formatSelectedDate(selectedDate)}</h3>
              <p>
                {selectedActivities.length} activities ·{' '}
                {formatEffort(selectedMinutes)}
              </p>
            </div>
            <button
              type="button"
              className="link-button"
              onClick={() => downloadMaintenancePlan(plan)}
            >
              Download plan
            </button>
          </div>

          {selectedActivities.length > 0 ? (
            <ul className="agenda-list">
              {selectedActivities.map((activity) => (
                <li key={activity.id}>
                  <button
                    type="button"
                    className="agenda-item"
                    onClick={() => onOpenActivity(activity)}
                  >
                    <span className="agenda-item-head">
                      <strong>{activity.title}</strong>
                      <span
                        className={`care-priority priority-${activity.priority}`}
                      >
                        {PRIORITY_LABEL[activity.priority]}
                      </span>
                    </span>
                    <span className="agenda-item-meta">
                      {activity.frequency} ·{' '}
                      {formatEffort(activity.effortMinutes)}
                      {activity.weatherSensitive
                        ? ' · weather-aware'
                        : ''}
                    </span>
                    <span className="agenda-item-assets">
                      {activity.assetLabels.join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">
              No planned activities for this day. Swipe left or right to
              switch views.
            </p>
          )}
        </aside>
      </div>
    </section>
  )
}
