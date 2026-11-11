import { useEffect, useRef } from 'react'
import type {
  CarePriority,
  CareProfileGroup,
} from './knowledge/types'
import type { PlannedActivity } from './knowledge/plan'

interface ActivityDetailModalProps {
  activity: PlannedActivity
  group?: CareProfileGroup
  onClose: () => void
  onOpenSpecies?: (profileId: string) => void
}

const PRIORITY_LABEL: Record<CarePriority, string> = {
  5: 'Critical',
  4: 'High',
  3: 'Routine',
  2: 'Low',
  1: 'Cosmetic',
}

function formatEffort(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

export function ActivityDetailModal({
  activity,
  group,
  onClose,
  onOpenSpecies,
}: ActivityDetailModalProps) {
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKey)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKey)
    }
  }, [])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="asset-modal activity-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-modal-title"
      >
        <div className="modal-head">
          <div>
            <h2 id="activity-modal-title">{activity.title}</h2>
            <p>
              {activity.profileName} · {activity.dueDate}
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="activity-meta">
          <span
            className={`care-priority priority-${activity.priority}`}
          >
            {PRIORITY_LABEL[activity.priority]}
          </span>
          <span>{activity.frequency}</span>
          <span>{formatEffort(activity.effortMinutes)}</span>
          {activity.weatherSensitive && <span>Weather-aware</span>}
        </div>

        <div className="activity-assets">
          <strong>Assets</strong>{' '}
          {activity.assetLabels.join(' · ')}
        </div>

        <div className="activity-body">
          <p>{activity.description}</p>
          <p className="care-rationale">{activity.rationale}</p>
          {activity.conditions && (
            <p className="care-condition">{activity.conditions}</p>
          )}
        </div>

        {activity.checklist && activity.checklist.length > 0 && (
          <div className="inspection-checklist">
            <h3>Inspection checklist</h3>
            <p className="inspection-hint">
              These checks are grouped into this regular inspection.
            </p>
            <ul>
              {activity.checklist.map((item) => (
                <li key={item.id}>
                  <div className="inspection-item-head">
                    <strong>{item.title}</strong>
                    <span
                      className={`care-priority priority-${item.priority}`}
                    >
                      {PRIORITY_LABEL[item.priority]}
                    </span>
                  </div>
                  <div className="inspection-item-meta">
                    {item.assetLabels.join(' · ')} ·{' '}
                    {item.frequency} ·{' '}
                    {formatEffort(item.effortMinutes)}
                  </div>
                  <p>{item.description}</p>
                  <p className="care-rationale">
                    {item.rationale}
                  </p>
                  {item.conditions && (
                    <p className="care-condition">
                      {item.conditions}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {group && (
          <div className="activity-knowledge">
            <h3>{group.profileName}</h3>
            <p>{group.summary}</p>
            {group.watchFor.length > 0 && (
              <p>
                <strong>Watch for:</strong>{' '}
                {group.watchFor.join(' · ')}
              </p>
            )}
          </div>
        )}

        <div className="modal-actions">
          <span className="care-count">
            {activity.cadence.type.replaceAll('_', ' ')}
          </span>
          <div className="right">
            {group && onOpenSpecies && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onOpenSpecies(group.profileId)}
              >
                View species knowledge
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
