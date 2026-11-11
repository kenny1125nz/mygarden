import { useEffect, useRef, useState } from 'react'
import type {
  CareKnowledgeMetadata,
  CarePriority,
  CareProfileGroup,
} from './knowledge/types'

interface SpeciesKnowledgeProps {
  groups: CareProfileGroup[]
  metadata: CareKnowledgeMetadata
  focusProfileId?: string | null
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const PRIORITY_LABEL: Record<CarePriority, string> = {
  5: 'Critical',
  4: 'High',
  3: 'Routine',
  2: 'Low',
  1: 'Cosmetic',
}

function formatMonths(months: number[]): string {
  if (!months.length) return 'Any time'

  const sorted = [...new Set(months)].sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0]
  let previous = sorted[0]

  const rangeLabel = (from: number, to: number) =>
    from === to
      ? MONTHS[from - 1]
      : `${MONTHS[from - 1]}–${MONTHS[to - 1]}`

  for (let index = 1; index < sorted.length; index += 1) {
    const month = sorted[index]
    if (month === previous + 1) {
      previous = month
      continue
    }
    ranges.push(rangeLabel(start, previous))
    start = month
    previous = month
  }
  ranges.push(rangeLabel(start, previous))

  return ranges.join(', ')
}

export function SpeciesKnowledge({
  groups,
  metadata,
  focusProfileId,
}: SpeciesKnowledgeProps) {
  const [index, setIndex] = useState(0)
  const swipeStart = useRef<{ x: number; y: number } | null>(null)

  const goNext = () => {
    setIndex((current) =>
      groups.length ? (current + 1) % groups.length : 0,
    )
  }

  const goPrevious = () => {
    setIndex((current) =>
      groups.length
        ? (current - 1 + groups.length) % groups.length
        : 0,
    )
  }

  useEffect(() => {
    if (!focusProfileId) return
    const nextIndex = groups.findIndex(
      (group) => group.profileId === focusProfileId,
    )
    if (nextIndex >= 0) setIndex(nextIndex)
  }, [focusProfileId, groups])

  useEffect(() => {
    setIndex((current) =>
      Math.min(current, Math.max(0, groups.length - 1)),
    )
  }, [groups.length])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') goNext()
      if (event.key === 'ArrowLeft') goPrevious()
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [groups.length])

  if (!groups.length) {
    return (
      <section className="workspace-card species-card">
        <div className="species-toolbar">
          <div>
            <h2>Species knowledge</h2>
            <p>{metadata.region}</p>
          </div>
        </div>
        <p className="hint">
          Add assets to see species-specific care knowledge.
        </p>
      </section>
    )
  }

  const group = groups[Math.min(index, groups.length - 1)]

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    swipeStart.current = { x: event.clientX, y: event.clientY }
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return

    const dx = event.clientX - start.x
    const dy = event.clientY - start.y

    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) goNext()
      else goPrevious()
    }
  }

  return (
    <section className="workspace-card species-card">
      <div className="species-toolbar">
        <div>
          <h2>Species knowledge</h2>
          <p>
            {metadata.region} · {metadata.reviewStatus} ·{' '}
            {metadata.lastReviewed}
          </p>
        </div>
        <span className="species-counter">
          {index + 1} of {groups.length}
        </span>
      </div>

      <div
        className="species-carousel"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <button
          type="button"
          className="species-nav previous"
          onClick={goPrevious}
          aria-label="Previous species"
        >
          ‹
        </button>

        <article className="species-slide">
          <div className="species-slide-head">
            <div>
              <h3>{group.profileName}</h3>
              <p>{group.assets.join(' · ')}</p>
            </div>
            <span className="care-category">
              {group.category}
            </span>
          </div>

          <p className="species-summary">{group.summary}</p>

          {group.watchFor.length > 0 && (
            <div className="species-watch">
              <strong>Watch for</strong>{' '}
              {group.watchFor.join(' · ')}
            </div>
          )}

          <div className="species-tasks">
            <h4>Regular care</h4>
            <ul>
              {group.tasks.map((task) => (
                <li key={task.id}>
                  <div className="species-task-head">
                    <strong>{task.title}</strong>
                    <span
                      className={`care-priority priority-${task.priority}`}
                    >
                      {PRIORITY_LABEL[task.priority]}
                    </span>
                  </div>
                  <div className="species-task-meta">
                    {formatMonths(task.months)} · {task.frequency}
                  </div>
                  <p>{task.description}</p>
                </li>
              ))}
            </ul>
          </div>

          {group.notes && (
            <p className="care-notes">{group.notes}</p>
          )}
        </article>

        <button
          type="button"
          className="species-nav next"
          onClick={goNext}
          aria-label="Next species"
        >
          ›
        </button>
      </div>

      <div className="species-dots">
        {groups.map((entry, entryIndex) => (
          <button
            key={entry.profileId}
            type="button"
            className={
              entryIndex === index ? 'species-dot active' : 'species-dot'
            }
            onClick={() => setIndex(entryIndex)}
            aria-label={`Show ${entry.profileName}`}
          />
        ))}
      </div>

      <p className="species-note">
        {metadata.assumptions[0]} Check local rules and product labels
        before acting.
      </p>
    </section>
  )
}
