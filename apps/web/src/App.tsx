import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as turf from '@turf/turf'
import { ActivityDetailModal } from './ActivityDetailModal'
import { AssetEditModal } from './AssetEditModal'
import { MaintenanceCalendar } from './MaintenanceCalendar'
import { SpeciesKnowledge } from './SpeciesKnowledge'
import type { Point, Polygon } from 'geojson'
import {
  PropertyScene,
  type ViewMode,
} from './property/PropertyScene'
import { buildPropertyData } from './property/build'
import {
  downloadPropertyGeoJSON,
  downloadPropertyJson,
} from './property/export'
import {
  buildAssetCarePlans,
  generateMaintenancePlan,
  groupCarePlansByProfile,
  WELLINGTON_CARE_METADATA,
} from './knowledge'
import type { PlannedActivity } from './knowledge'
import {
  localGeometryToWgs84,
  localRingArea,
  simplifyDraft,
  simplifyRing,
  wgs84FromEnu,
} from './property/geo'
import type {
  EditTool,
  LocalPosition,
  PropertyData,
  UserAsset,
  UserAssetKind,
} from './property/types'
import {
  createUserId,
  loadUserAssets,
  saveUserAssets,
} from './property/userAssets'
import {
  fetchAddress,
  fetchBuildings,
  fetchContours,
  fetchElevation,
  fetchParcel,
} from './property/wcc'

const DEFAULT_ADDRESS = '3 Jay Street, Paparangi, Wellington'
const BUFFER_M = 6
const STORAGE_KEY = 'mygarden.property.v1'

type Status = { phase: string; detail?: string } | null

const TOOLS: Array<{ id: EditTool; label: string }> = [
  { id: 'pan', label: 'Pan' },
  { id: 'select', label: 'Select' },
  { id: 'tree', label: 'Tree' },
  { id: 'lawn', label: 'Lawn' },
  { id: 'bush', label: 'Bush/hedge' },
  { id: 'area', label: 'Area' },
]

function assetKindLabel(kind: UserAssetKind): string {
  if (kind === 'bush') return 'Bush/hedge'
  if (kind === 'area') return 'Area'
  if (kind === 'lawn') return 'Lawn'
  return 'Tree'
}

const ASSET_GROUP_DEFS: Array<{
  kind: UserAssetKind
  label: string
}> = [
  { kind: 'tree', label: 'Trees' },
  { kind: 'lawn', label: 'Lawns' },
  { kind: 'bush', label: 'Bush & hedges' },
  { kind: 'area', label: 'Areas' },
]

function groupBySpecies(
  assets: UserAsset[],
): Array<{ species: string; assets: UserAsset[] }> {
  const groups = new Map<string, UserAsset[]>()

  for (const asset of assets) {
    const species = asset.species?.trim() || 'Unspecified'
    const current = groups.get(species) ?? []
    current.push(asset)
    groups.set(species, current)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([species, entries]) => ({ species, assets: entries }))
}

function assetMeta(asset: UserAsset): string {
  if (asset.kind === 'tree') {
    return `${(asset.radiusM ?? 1.2).toFixed(1)} m`
  }
  if (asset.geometryLocal.type === 'Polygon') {
    const ring = asset.geometryLocal.coordinates[0] ?? []
    const area = localRingArea(ring)
    return `${area.toFixed(1)} m² · ${Math.max(
      0,
      ring.length - 1,
    )} pts`
  }
  return ''
}

function TreeGroup({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: ReactNode
  count?: number
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="tree-group">
      <button
        type="button"
        className="tree-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className={`tree-chevron ${open ? 'open' : ''}`}>
          ▸
        </span>
        <span className="tree-title">{title}</span>
        {count != null && (
          <span className="tree-count">{count}</span>
        )}
      </button>
      {open && <div className="tree-children">{children}</div>}
    </div>
  )
}

function loadStoredProperty(): PropertyData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as PropertyData
    if (data.schemaVersion !== 1 || !data.site || !data.address) {
      return null
    }
    return data
  } catch {
    return null
  }
}

function saveStoredProperty(data: PropertyData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Storage can be unavailable in private modes; the app still works.
  }
}

const areaFormatter = new Intl.NumberFormat('en-NZ', {
  maximumFractionDigits: 1,
})

function formatArea(value: number): string {
  return `${areaFormatter.format(value)} m²`
}

function formatLength(value: number): string {
  return `${areaFormatter.format(value)} m`
}

function formatElevation(value: number): string {
  return `${value.toFixed(1)} m`
}

function formatRange(range: [number, number] | null): string {
  if (!range) return '—'
  return `${range[0].toFixed(1)}–${range[1].toFixed(1)} m`
}

export default function App() {
  const [address, setAddress] = useState(DEFAULT_ADDRESS)
  const [property, setProperty] = useState<PropertyData | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    new URLSearchParams(window.location.search).get('view') === '3d'
      ? '3d'
      : 'plan',
  )
  const [maskOutside, setMaskOutside] = useState(
    () =>
      new URLSearchParams(window.location.search).get('mask') === '1',
  )
  const [selectedBuildingId, setSelectedBuildingId] = useState<
    string | null
  >(null)
  const [tool, setTool] = useState<EditTool>('pan')
  const [userAssets, setUserAssets] = useState<UserAsset[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(
    null,
  )
  const [draftPoints, setDraftPoints] = useState<LocalPosition[]>([])
  const [editError, setEditError] = useState<string | null>(null)
  const [editingAssetId, setEditingAssetId] = useState<string | null>(
    null,
  )
  const [assetFilter, setAssetFilter] = useState('')
  const [activeTab, setActiveTab] = useState<
    'calendar' | 'map' | 'species'
  >('calendar')
  const [speciesProfileId, setSpeciesProfileId] = useState<
    string | null
  >(null)
  const [activityDetail, setActivityDetail] =
    useState<PlannedActivity | null>(null)
  const didAutoLoad = useRef(false)
  const editsParcelRef = useRef<number | null>(null)

  const applyLoadedProperty = useCallback((data: PropertyData) => {
    const edits = loadUserAssets(data.site.parcelId)
    editsParcelRef.current = data.site.parcelId
    setProperty(data)
    setUserAssets(edits)
    setSelectedAssetId(null)
    setSelectedBuildingId(null)
    setDraftPoints([])
    setTool('pan')
    setEditError(null)
    setEditingAssetId(null)
    setAssetFilter('')
  }, [])

  const initialise = useCallback(
    async (query: string) => {
      const trimmed = query.trim()
      if (!trimmed) {
        setError('Enter an address to initialise the property.')
        return
      }

      setError(null)
      setStatus({ phase: 'Finding address' })
      setProperty(null)
      setSelectedBuildingId(null)
      setSelectedAssetId(null)
      setDraftPoints([])
      setTool('pan')

      try {
        const resolved = await fetchAddress(trimmed)

        setStatus({ phase: 'Loading section' })
        const parcel = await fetchParcel(
          resolved.location[0],
          resolved.location[1],
        )

        const buffer = turf.buffer(parcel, BUFFER_M / 1000, {
          units: 'kilometers',
        })
        const bbox = turf.bbox(buffer ?? parcel) as [
          number,
          number,
          number,
          number,
        ]

        setStatus({ phase: 'Loading buildings and contours' })
        const [buildingFeatures, contoursAtHalfMetre] =
          await Promise.all([
            fetchBuildings(bbox),
            fetchContours(bbox, 2),
          ])

        let contourFeatures = contoursAtHalfMetre
        let contourSource = 'WCC Contours 2020 (0.5 m)'

        if (!contourFeatures.length) {
          setStatus({ phase: 'Loading contours' })
          contourFeatures = await fetchContours(bbox, 0)
          contourSource = 'WCC Contours 2020 (1 m)'
        }

        setStatus({ phase: 'Building property record' })
        const data = await buildPropertyData({
          address: { ...resolved, query: trimmed },
          parcel,
          buildings: buildingFeatures,
          contours: contourFeatures,
          contourSource,
          bufferM: BUFFER_M,
          fetchElevation,
          onProgress: (detail) =>
            setStatus({ phase: 'Sampling elevation', detail }),
        })

        saveStoredProperty(data)
        applyLoadedProperty(data)
        setAddress(trimmed)
        setStatus(null)
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not load the property.',
        )
        setStatus(null)
      }
    },
    [applyLoadedProperty],
  )

  useEffect(() => {
    const stored = loadStoredProperty()
    if (stored) {
      applyLoadedProperty(stored)
      setAddress(stored.address.query)
      return
    }

    if (didAutoLoad.current) return
    didAutoLoad.current = true
    void initialise(DEFAULT_ADDRESS)
  }, [applyLoadedProperty, initialise])

  useEffect(() => {
    if (!property) return
    if (editsParcelRef.current !== property.site.parcelId) return
    saveUserAssets(property.site.parcelId, userAssets)
  }, [userAssets, property])

  const refresh = () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore storage failures.
    }
    void initialise(address)
  }

  const selectTool = (next: EditTool) => {
    setTool(next)
    setDraftPoints([])
    setEditError(null)
    if (next !== 'select') {
      setSelectedAssetId(null)
    }
  }

  const handleGroundClick = (point: LocalPosition) => {
    if (!property) return

    if (tool === 'tree') {
      const [lon, lat, alt] = wgs84FromEnu(
        point[0],
        point[1],
        point[2],
        property.site.origin,
      )
      const count =
        userAssets.filter((asset) => asset.kind === 'tree').length + 1
      const timestamp = new Date().toISOString()

      const asset: UserAsset = {
        id: createUserId(),
        kind: 'tree',
        label: `Tree ${count}`,
        species: '',
        notes: '',
        radiusM: 1.2,
        geometry: {
          type: 'Point',
          coordinates: [lon, lat, alt],
        },
        geometryLocal: {
          type: 'Point',
          coordinates: point,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      setUserAssets((current) => [...current, asset])
      setSelectedAssetId(asset.id)
      setSelectedBuildingId(null)
      setTool('select')
      return
    }

    if (tool === 'lawn' || tool === 'bush' || tool === 'area') {
      setDraftPoints((current) =>
        simplifyDraft([...current, point]) as LocalPosition[],
      )
    }
  }

  const finishArea = () => {
    if (!property || draftPoints.length < 3) return
    if (tool !== 'lawn' && tool !== 'bush' && tool !== 'area') return

    const ringLocal = simplifyRing([
      ...draftPoints,
      draftPoints[0],
    ])

    if (ringLocal.length < 4 || localRingArea(ringLocal) < 0.5) {
      setEditError(
        'Draw a larger area with at least three non-collinear points.',
      )
      return
    }

    const polygonLocal: Polygon = {
      type: 'Polygon',
      coordinates: [ringLocal],
    }
    const polygonWgs84 = localGeometryToWgs84(
      polygonLocal,
      property.site.origin,
    ) as Polygon

    const count =
      userAssets.filter((asset) => asset.kind === tool).length + 1
    const label =
      tool === 'lawn'
        ? `Lawn ${count}`
        : tool === 'bush'
          ? `Bush/hedge ${count}`
          : `Area ${count}`
    const timestamp = new Date().toISOString()

    const asset: UserAsset = {
      id: createUserId(),
      kind: tool,
      label,
      species: '',
      notes: '',
      geometry: polygonWgs84,
      geometryLocal: polygonLocal,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    setUserAssets((current) => [...current, asset])
    setSelectedAssetId(asset.id)
    setSelectedBuildingId(null)
    setDraftPoints([])
    setEditError(null)
    setTool('select')
  }

  const cancelDraft = () => {
    setDraftPoints([])
    setEditError(null)
    setTool('select')
  }

  const updateAssetGeometry = (
    id: string,
    geometryLocal: Point | Polygon,
    simplify = false,
  ) => {
    if (!property) return

    let nextGeometry = geometryLocal

    if (simplify && geometryLocal.type === 'Polygon') {
      const rings = geometryLocal.coordinates
      const simplified = simplifyRing(rings[0] ?? [])

      if (simplified.length >= 4 && localRingArea(simplified) >= 0.5) {
        nextGeometry = {
          type: 'Polygon',
          coordinates: [simplified, ...rings.slice(1)],
        }
      }
    }

    const geometry = localGeometryToWgs84(
      nextGeometry,
      property.site.origin,
    ) as Point | Polygon
    const timestamp = new Date().toISOString()

    setUserAssets((current) =>
      current.map((asset) =>
        asset.id === id
          ? {
              ...asset,
              geometryLocal: nextGeometry,
              geometry,
              updatedAt: timestamp,
            }
          : asset,
      ),
    )
  }

  const updateAssetRadius = (id: string, radiusM: number) => {
    const timestamp = new Date().toISOString()
    setUserAssets((current) =>
      current.map((asset) =>
        asset.id === id
          ? { ...asset, radiusM, updatedAt: timestamp }
          : asset,
      ),
    )
  }

  const updateAssetAttributes = (
    id: string,
    patch: Partial<
      Pick<UserAsset, 'label' | 'species' | 'notes' | 'radiusM'>
    >,
  ) => {
    const timestamp = new Date().toISOString()
    setUserAssets((current) =>
      current.map((asset) =>
        asset.id === id
          ? { ...asset, ...patch, updatedAt: timestamp }
          : asset,
      ),
    )
  }

  const deleteAsset = (id: string) => {
    setUserAssets((current) =>
      current.filter((asset) => asset.id !== id),
    )
    setSelectedAssetId((current) =>
      current === id ? null : current,
    )
    setEditingAssetId((current) =>
      current === id ? null : current,
    )
  }

  const selectAsset = (id: string | null) => {
    setSelectedAssetId(id)
    if (id) {
      setSelectedBuildingId(null)
      setTool('select')
    }
  }

  const selectBuilding = (id: string | null) => {
    setSelectedBuildingId(id)
    if (id) setSelectedAssetId(null)
  }

  const openAssetModal = (id: string) => {
    setSelectedAssetId(id)
    setSelectedBuildingId(null)
    setTool('select')
    setEditingAssetId(id)
  }

  const editingAsset =
    userAssets.find((asset) => asset.id === editingAssetId) ?? null
  const normalizedFilter = assetFilter.trim().toLowerCase()
  const visibleAssets = normalizedFilter
    ? userAssets.filter((asset) =>
        `${asset.label} ${asset.species ?? ''} ${assetKindLabel(
          asset.kind,
        )}`
          .toLowerCase()
          .includes(normalizedFilter),
      )
    : userAssets
  const carePlans = useMemo(
    () => buildAssetCarePlans(userAssets),
    [userAssets],
  )
  const maintenancePlan = useMemo(
    () => generateMaintenancePlan(userAssets),
    [userAssets],
  )
  const speciesGroups = useMemo(
    () => groupCarePlansByProfile(carePlans),
    [carePlans],
  )

  const openTab = (tab: 'calendar' | 'map' | 'species') => {
    setActiveTab(tab)
    if (tab === 'species') setSpeciesProfileId(null)
  }

  const cycleTab = (direction: 1 | -1) => {
    const tabs = ['calendar', 'map', 'species'] as const
    const index = tabs.indexOf(activeTab)
    const next = tabs[(index + direction + tabs.length) % tabs.length]
    setActiveTab(next)
    if (next === 'species') setSpeciesProfileId(null)
  }

  const openSpeciesKnowledge = (profileId: string) => {
    setSpeciesProfileId(profileId)
    setActiveTab('species')
    setActivityDetail(null)
  }

  const activityGroup = activityDetail
    ? speciesGroups.find(
        (group) => group.profileId === activityDetail.profileId,
      )
    : undefined
  const isDrawing =
    tool === 'lawn' || tool === 'bush' || tool === 'area'
  const toolHint = !property
    ? ''
    : tool === 'pan'
      ? 'Drag to pan and scroll to zoom.'
      : tool === 'select'
        ? 'Select an asset or building. Drag a tree to move it, drag its edge handle to resize it, drag an area vertex to reshape it, or double-click an area edge to add a point.'
        : tool === 'tree'
          ? 'Click the map to place a tree.'
          : 'Click to add points. Finish when the area has at least 3 points. Roughly collinear points are removed automatically.'

  const mapHint =
    tool === 'pan'
      ? viewMode === 'plan'
        ? 'Plan view · north is up · drag to pan · scroll to zoom'
        : '3D view · drag to orbit · scroll to zoom'
      : tool === 'select'
        ? 'Select mode · double-click an area edge to add a point'
        : tool === 'tree'
          ? 'Tree mode · click to place a tree'
          : 'Draw mode · click to add points'

  const renderAssetRow = (asset: UserAsset) => (
    <div className="asset-row" key={asset.id}>
      <button
        type="button"
        className={
          selectedAssetId === asset.id
            ? 'asset-row-main selected'
            : 'asset-row-main'
        }
        onClick={() => selectAsset(asset.id)}
      >
        <span className={`asset-dot ${asset.kind}`} />
        <span className="asset-row-label">{asset.label}</span>
        <small>{assetMeta(asset)}</small>
      </button>
      <button
        type="button"
        className="asset-row-edit"
        onClick={() => openAssetModal(asset.id)}
      >
        Edit
      </button>
    </div>
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <div>
            <h1>MyGarden</h1>
            <p>Property initialisation · open data prototype</p>
          </div>
        </div>
        <span className="badge">Prototype</span>
      </header>

      <main className="layout">
        {property ? (
          <section className="workspace">
            <div
              className="tab-bar"
              role="tablist"
              aria-label="Workspace views"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'calendar'}
                className={
                  activeTab === 'calendar'
                    ? 'tab-button active'
                    : 'tab-button'
                }
                onClick={() => openTab('calendar')}
              >
                Calendar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'map'}
                className={
                  activeTab === 'map'
                    ? 'tab-button active'
                    : 'tab-button'
                }
                onClick={() => openTab('map')}
              >
                Map
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'species'}
                className={
                  activeTab === 'species'
                    ? 'tab-button active'
                    : 'tab-button'
                }
                onClick={() => openTab('species')}
              >
                Species
              </button>
            </div>

            {activeTab === 'calendar' && (
              <MaintenanceCalendar
                plan={maintenancePlan}
                onOpenActivity={setActivityDetail}
                onSwipeTab={cycleTab}
              />
            )}

            {activeTab === 'map' && (
              <section className="map-card">
                <PropertyScene
                  property={property}
                  userAssets={userAssets}
                  viewMode={viewMode}
                  tool={tool}
                  draftPoints={draftPoints}
                  selectedAssetId={selectedAssetId}
                  selectedBuildingId={selectedBuildingId}
                  maskOutside={maskOutside}
                  onGroundClick={handleGroundClick}
                  onSelectAsset={selectAsset}
                  onAssetGeometryChange={updateAssetGeometry}
                  onAssetRadiusChange={updateAssetRadius}
                  onSelectBuilding={selectBuilding}
                />

                <div
                  className="view-toggle"
                  role="group"
                  aria-label="View"
                >
                  <button
                    type="button"
                    className={
                      viewMode === 'plan' ? 'active' : ''
                    }
                    onClick={() => setViewMode('plan')}
                  >
                    Plan
                  </button>
                  <button
                    type="button"
                    className={viewMode === '3d' ? 'active' : ''}
                    onClick={() => setViewMode('3d')}
                  >
                    3D
                  </button>
                </div>

                <div className="legend">
                  <span>
                    <i className="swatch parcel" /> Section
                  </span>
                  <span>
                    <i className="swatch building" /> Building
                  </span>
                  <span>
                    <i className="swatch contour" /> Contour
                  </span>
                  <span>
                    <i className="swatch address" /> Address
                  </span>
                </div>

                <div className="map-hint">{mapHint}</div>

                <div className="map-attribution">
                  Aerial imagery © WCC 2021
                </div>

                <label className="map-mask-toggle">
                  <input
                    type="checkbox"
                    checked={maskOutside}
                    onChange={(event) =>
                      setMaskOutside(event.target.checked)
                    }
                  />
                  Mask outside property
                </label>
              </section>
            )}

            {activeTab === 'species' && (
              <SpeciesKnowledge
                groups={speciesGroups}
                metadata={WELLINGTON_CARE_METADATA}
                focusProfileId={speciesProfileId}
              />
            )}
          </section>
        ) : (
          <section className="map-card">
            <div className="map-empty">
              <div className="map-empty-inner">
                <h2>Property data initialisation</h2>
                <p>
                  Enter an address to load the section, buildings,
                  contours, and elevation from Wellington City Council
                  open data.
                </p>
              </div>
            </div>

            {status && (
              <div className="loading-overlay">
                <div className="spinner" aria-hidden="true" />
                <div>
                  <strong>{status.phase}</strong>
                  {status.detail && <span>{status.detail}</span>}
                </div>
              </div>
            )}
          </section>
        )}

        <aside className="sidebar">
          <section className="card">
            <h2>Address</h2>
            <form
              className="address-form"
              onSubmit={(event) => {
                event.preventDefault()
                void initialise(address)
              }}
            >
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                aria-label="Property address"
                autoComplete="street-address"
              />
              <button type="submit" disabled={status !== null}>
                Load
              </button>
            </form>
            <p className="hint">
              Open data: Wellington City Council. No API key required.
            </p>
            {error && <div className="error">{error}</div>}
          </section>

          {property ? (
            <>
              <section className="card edit-card">
                <div className="card-heading">
                  <h2>Edit property</h2>
                  <span className="mini-count">
                    {userAssets.length} assets
                  </span>
                </div>

                <div className="tool-grid">
                  {TOOLS.map((toolOption) => (
                    <button
                      key={toolOption.id}
                      type="button"
                      className={
                        tool === toolOption.id
                          ? 'tool-button active'
                          : 'tool-button'
                      }
                      onClick={() => selectTool(toolOption.id)}
                    >
                      <span
                        className={`tool-dot ${toolOption.id}`}
                      />
                      {toolOption.label}
                    </button>
                  ))}
                </div>

                {isDrawing && (
                  <div className="draft-controls">
                    <span>{draftPoints.length} points</span>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={finishArea}
                      disabled={draftPoints.length < 3}
                    >
                      Finish area
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={cancelDraft}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                <p className="hint">{toolHint}</p>
                {editError && <div className="error">{editError}</div>}

                {userAssets.length > 0 ? (
                  <>
                    <input
                      className="asset-filter"
                      value={assetFilter}
                      onChange={(event) =>
                        setAssetFilter(event.target.value)
                      }
                      placeholder="Filter assets by name or species"
                      aria-label="Filter assets"
                    />

                    <div
                      className="asset-tree"
                      key={normalizedFilter ? 'filtered' : 'all'}
                    >
                      {ASSET_GROUP_DEFS.map((group) => {
                        const groupAssets = visibleAssets.filter(
                          (asset) => asset.kind === group.kind,
                        )
                        if (!groupAssets.length) return null

                        const speciesGroups =
                          group.kind === 'tree' ||
                          group.kind === 'bush'
                            ? groupBySpecies(groupAssets)
                            : []

                        return (
                          <TreeGroup
                            key={group.kind}
                            title={
                              <>
                                <span
                                  className={`asset-dot ${group.kind}`}
                                />{' '}
                                {group.label}
                              </>
                            }
                            count={groupAssets.length}
                            defaultOpen
                          >
                            {speciesGroups.length > 1
                              ? speciesGroups.map(
                                  (speciesGroup) => (
                                    <TreeGroup
                                      key={`${group.kind}-${speciesGroup.species}`}
                                      title={speciesGroup.species}
                                      count={
                                        speciesGroup.assets.length
                                      }
                                      defaultOpen={Boolean(
                                        normalizedFilter,
                                      )}
                                    >
                                      {speciesGroup.assets.map(
                                        renderAssetRow,
                                      )}
                                    </TreeGroup>
                                  ),
                                )
                              : groupAssets.map(renderAssetRow)}
                          </TreeGroup>
                        )
                      })}

                      {visibleAssets.length === 0 && (
                        <p className="hint">
                          No assets match the filter.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="hint">
                    No user assets yet. Add a tree or draw a lawn,
                    bush/hedge, or area.
                  </p>
                )}
              </section>

              <details className="card collapsible" open>
                <summary>Property</summary>
                <div className="details-body">
                  <div className="details-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={refresh}
                      disabled={status !== null}
                    >
                      Refresh from WCC
                    </button>
                  </div>
                  <p className="address-line">
                    {property.address.fullAddress}
                  </p>
                  <dl className="summary-grid">
                    <div>
                      <dt>Parcel</dt>
                      <dd>{property.site.parcelId}</dd>
                    </div>
                    <div>
                      <dt>Appellation</dt>
                      <dd>{property.site.appellation}</dd>
                    </div>
                    <div>
                      <dt>Area</dt>
                      <dd>{formatArea(property.site.areaM2)}</dd>
                    </div>
                    <div>
                      <dt>Perimeter</dt>
                      <dd>{formatLength(property.site.perimeterM)}</dd>
                    </div>
                    <div>
                      <dt>Ground elevation</dt>
                      <dd>
                        {formatElevation(
                          property.site.terrain.elevationM,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Contour range</dt>
                      <dd>
                        {formatRange(
                          property.site.terrain.elevationRangeM,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Buildings</dt>
                      <dd>{property.buildings.length}</dd>
                    </div>
                    <div>
                      <dt>Contours</dt>
                      <dd>{property.site.terrain.contourCount}</dd>
                    </div>
                  </dl>
                  <p className="meta">
                    Generated{' '}
                    {new Date(property.generatedAt).toLocaleString(
                      'en-NZ',
                    )}{' '}
                    · {property.site.terrain.contourSource}
                  </p>
                </div>
              </details>

              <details className="card collapsible">
                <summary>Buildings</summary>
                <div className="details-body">
                  {property.buildings.length ? (
                    <ul className="building-list">
                      {property.buildings.map((building) => (
                        <li key={building.id}>
                          <button
                            type="button"
                            className={
                              selectedBuildingId === building.id
                                ? 'building-row selected'
                                : 'building-row'
                            }
                            onClick={() =>
                              selectBuilding(
                                selectedBuildingId === building.id
                                  ? null
                                  : building.id,
                              )
                            }
                          >
                            <span>
                              <strong>{building.label}</strong>
                              <small>
                                {formatArea(building.areaM2)} ·{' '}
                                {building.heightM.toFixed(1)} m high
                              </small>
                            </span>
                            <span className="chevron">
                              {selectedBuildingId === building.id
                                ? '−'
                                : '+'}
                            </span>
                          </button>
                          {selectedBuildingId === building.id && (
                            <dl className="building-detail">
                              <div>
                                <dt>On section</dt>
                                <dd>
                                  {formatArea(
                                    building.withinPropertyM2,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Base elevation</dt>
                                <dd>
                                  {formatElevation(
                                    building.baseElevationM,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Status</dt>
                                <dd>
                                  {building.attributes.status ??
                                    'Unknown'}
                                </dd>
                              </div>
                              <div>
                                <dt>WCC object</dt>
                                <dd>
                                  {building.attributes.objectId ?? '—'}
                                </dd>
                              </div>
                            </dl>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="hint">
                      No buildings found on the section.
                    </p>
                  )}
                </div>
              </details>

              <details className="card collapsible">
                <summary>Export</summary>
                <div className="details-body">
                  <div className="download-row">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        downloadPropertyJson(property, userAssets)
                      }
                    >
                      Property JSON
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        downloadPropertyGeoJSON(property, userAssets)
                      }
                    >
                      GeoJSON
                    </button>
                  </div>
                  <p className="hint">
                    The JSON is the 3D-ready property record including your
                    edits. GeoJSON is WGS84 for interoperability.
                  </p>
                </div>
              </details>

              <details className="card collapsible sources-card">
                <summary>Data sources</summary>
                <div className="details-body">
                  <ul className="source-list">
                    {property.sources.map((source) => (
                      <li key={source.name}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {source.name}
                        </a>
                        <span>{source.attribution}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="attribution">
                    Contains data © Wellington City Council and Land
                    Information New Zealand (LINZ). Check the open data
                    terms before redistribution.
                  </p>
                </div>
              </details>
            </>
          ) : (
            <section className="card">
              <h2>What loads</h2>
              <ul className="plain-list">
                <li>Section boundary and survey coordinates</li>
                <li>
                  Building footprints with base elevation and approximate
                  height
                </li>
                <li>
                  0.5 m or 1 m contours, clipped to the property and its
                  surroundings
                </li>
                <li>1 m DEM samples for ground elevation</li>
              </ul>
              <p className="hint">
                This is the first front-end slice of property data
                initialisation.
              </p>
            </section>
          )}
        </aside>
      </main>

      <footer className="footer">
        <span>
          MyGarden prototype · open data · web only · low footprint
        </span>
      </footer>

      {editingAsset && (
        <AssetEditModal
          asset={editingAsset}
          title={assetKindLabel(editingAsset.kind)}
          onClose={() => setEditingAssetId(null)}
          onChange={(patch) =>
            updateAssetAttributes(editingAsset.id, patch)
          }
          onDelete={() => deleteAsset(editingAsset.id)}
        />
      )}

      {activityDetail && (
        <ActivityDetailModal
          activity={activityDetail}
          group={activityGroup}
          onClose={() => setActivityDetail(null)}
          onOpenSpecies={openSpeciesKnowledge}
        />
      )}
    </div>
  )
}
