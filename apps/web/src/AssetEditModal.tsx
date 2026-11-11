import { useEffect, useRef } from 'react'
import type { UserAsset } from './property/types'
import { localRingArea } from './property/geo'

interface AssetEditModalProps {
  asset: UserAsset
  title: string
  onClose: () => void
  onChange: (
    patch: Partial<
      Pick<UserAsset, 'label' | 'species' | 'notes' | 'radiusM'>
    >,
  ) => void
  onDelete: () => void
}

export function AssetEditModal({
  asset,
  title,
  onClose,
  onChange,
  onDelete,
}: AssetEditModalProps) {
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

  const vertexCount =
    asset.geometryLocal.type === 'Polygon'
      ? Math.max(
          0,
          asset.geometryLocal.coordinates[0].length - 1,
        )
      : null
  const areaM2 =
    asset.geometryLocal.type === 'Polygon'
      ? localRingArea(asset.geometryLocal.coordinates[0] ?? [])
      : null

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="asset-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-modal-title"
      >
        <div className="modal-head">
          <div>
            <h2 id="asset-modal-title">Edit {title}</h2>
            <p>
              Changes apply immediately. Use the map to move, resize,
              or reshape.
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

        <div className="modal-form">
          <label>
            Label
            <input
              autoFocus
              value={asset.label}
              onChange={(event) =>
                onChange({ label: event.target.value })
              }
            />
          </label>

          {(asset.kind === 'tree' || asset.kind === 'bush') && (
            <label>
              Species
              <input
                value={asset.species ?? ''}
                placeholder="e.g. apple, feijoa, box hedge"
                onChange={(event) =>
                  onChange({ species: event.target.value })
                }
              />
            </label>
          )}

          {asset.kind === 'tree' && (
            <label>
              Canopy radius (m)
              <input
                type="number"
                min="0.2"
                step="0.1"
                value={asset.radiusM ?? 1.2}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (Number.isFinite(value)) {
                    onChange({ radiusM: Math.max(0.2, value) })
                  }
                }}
              />
            </label>
          )}

          <label>
            Notes
            <textarea
              rows={4}
              value={asset.notes ?? ''}
              onChange={(event) =>
                onChange({ notes: event.target.value })
              }
            />
          </label>

          <div className="modal-meta">
            {vertexCount !== null ? (
              <span>
                {areaM2?.toFixed(1)} m² · {vertexCount} vertices
              </span>
            ) : (
              <span>
                {(asset.radiusM ?? 1.2).toFixed(1)} m radius
              </span>
            )}
            <span>
              {asset.kind === 'tree'
                ? 'Drag the circle edge to resize'
                : 'Drag points on the map to reshape'}
            </span>
          </div>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="danger-button"
            onClick={onDelete}
          >
            Delete asset
          </button>
          <div className="right">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
