import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Point, Polygon, Position } from 'geojson'
import {
  combineBounds,
  enuFromWgs84,
  type LocalBounds,
} from './geo'
import type {
  BuildingAsset,
  EditTool,
  LocalPosition,
  PropertyData,
  UserAsset,
  UserAssetKind,
} from './types'
import { wccImageryUrl } from './wcc'

export type ViewMode = 'plan' | '3d'

interface PropertySceneProps {
  property: PropertyData
  userAssets: UserAsset[]
  viewMode: ViewMode
  tool: EditTool
  draftPoints: LocalPosition[]
  selectedAssetId: string | null
  selectedBuildingId: string | null
  maskOutside: boolean
  onGroundClick: (point: LocalPosition) => void
  onSelectAsset: (id: string | null) => void
  onAssetGeometryChange: (
    id: string,
    geometryLocal: Point | Polygon,
    simplify?: boolean,
  ) => void
  onAssetRadiusChange: (id: string, radiusM: number) => void
  onSelectBuilding: (id: string | null) => void
}

interface BuildingMeshEntry {
  mesh: THREE.Mesh
  edges: THREE.LineSegments
  material: THREE.MeshStandardMaterial
  edgeMaterial: THREE.LineBasicMaterial
}

interface UserAssetVisual {
  asset: UserAsset
  group: THREE.Group
  fill?: THREE.Mesh
  outline?: THREE.LineLoop | THREE.LineSegments
  handles: THREE.Mesh[]
  pickMeshes: THREE.Object3D[]
  radiusHandle?: THREE.Mesh
  circle?: THREE.Mesh
}

interface VertexHandle {
  assetId: string
  index: number
  mesh: THREE.Mesh
}

interface SceneState {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  planCamera: THREE.OrthographicCamera
  orbitCamera: THREE.PerspectiveCamera
  activeCamera: THREE.Camera
  planControls: OrbitControls
  orbitControls: OrbitControls
  activeControls: OrbitControls
  buildingMeshes: Map<string, BuildingMeshEntry>
  userAssetsGroup: THREE.Group
  draftGroup: THREE.Group
  userAssetVisuals: Map<string, UserAssetVisual>
  vertexHandles: VertexHandle[]
  radiusHandles: Array<{ assetId: string; mesh: THREE.Mesh }>
  maskMesh: THREE.Mesh
  bounds: LocalBounds
  raf: number
}

interface DragState {
  kind: 'tree' | 'vertex' | 'radius'
  assetId: string
  vertexIndex: number
  geometryLocal: Point | Polygon
  radius?: number
}

function localToScene([east, north, up]: Position): THREE.Vector3 {
  return new THREE.Vector3(east, up, -north)
}

function wgs84Bounds(
  polygon: Polygon,
): [number, number, number, number] {
  let minLon = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLon = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY

  for (const ring of polygon.coordinates) {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon)
      minLat = Math.min(minLat, lat)
      maxLon = Math.max(maxLon, lon)
      maxLat = Math.max(maxLat, lat)
    }
  }

  return [minLon, minLat, maxLon, maxLat]
}

function openRing(ring: Position[]): Position[] {
  if (ring.length < 2) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1)
  }
  return ring
}

function shapeFromPolygon(polygon: Polygon): THREE.Shape {
  const rings = polygon.coordinates
  const outer = openRing(rings[0] ?? [])
  const shape = new THREE.Shape(
    outer.map(([east, north]) => new THREE.Vector2(east, north)),
  )

  for (let index = 1; index < rings.length; index += 1) {
    const hole = openRing(rings[index] ?? [])
    shape.holes.push(
      new THREE.Path(
        hole.map(([east, north]) => new THREE.Vector2(east, north)),
      ),
    )
  }

  return shape
}

function colorForElevation(
  elevation: number,
  min: number,
  max: number,
): THREE.Color {
  const range = max - min
  const t = range > 0.001 ? (elevation - min) / range : 0.5
  const low = new THREE.Color('#c9a06a')
  const high = new THREE.Color('#7a4a1d')
  return low.clone().lerp(high, t)
}

function updatePlanFrustum(
  camera: THREE.OrthographicCamera,
  bounds: LocalBounds,
  aspect: number,
): void {
  const padding = 1.08
  const spanE = Math.max(bounds.spanE * padding, 10)
  const spanN = Math.max(bounds.spanN * padding, 10)
  const halfW = Math.max(spanE, spanN * aspect) / 2
  const halfH = Math.max(spanN, spanE / aspect) / 2

  camera.left = -halfW
  camera.right = halfW
  camera.top = halfH
  camera.bottom = -halfH
  camera.updateProjectionMatrix()
}

function meshUpForBuilding(
  building: BuildingAsset,
  property: PropertyData,
): number {
  return building.baseElevationM - property.site.origin.altM
}

function insertPointOnPolygon(
  polygon: Polygon,
  point: LocalPosition,
  maxDistance = 3,
): Polygon | null {
  const rings = polygon.coordinates
  const open = openRing(rings[0] ?? [])
  if (open.length < 3) return null

  let bestDistance = Number.POSITIVE_INFINITY
  let bestIndex = -1
  let bestPoint: LocalPosition | null = null

  for (let index = 0; index < open.length; index += 1) {
    const start = open[index]
    const end = open[(index + 1) % open.length]
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared < 1e-9) continue

    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - start[0]) * dx +
          (point[1] - start[1]) * dy) /
          lengthSquared,
      ),
    )
    const projectedX = start[0] + t * dx
    const projectedY = start[1] + t * dy
    const distance = Math.hypot(
      point[0] - projectedX,
      point[1] - projectedY,
    )

    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index + 1
      const startZ =
        typeof start[2] === 'number' ? start[2] : point[2]
      const endZ = typeof end[2] === 'number' ? end[2] : point[2]
      bestPoint = [
        projectedX,
        projectedY,
        startZ + (endZ - startZ) * t,
      ]
    }
  }

  if (
    bestDistance > maxDistance ||
    bestIndex < 0 ||
    !bestPoint
  ) {
    return null
  }

  const nextRing = [...open]
  nextRing.splice(bestIndex, 0, bestPoint)
  nextRing.push(nextRing[0])

  return {
    type: 'Polygon',
    coordinates: [nextRing, ...rings.slice(1)],
  }
}

const ASSET_COLORS: Record<
  UserAssetKind,
  { fill: number; outline: number }
> = {
  lawn: { fill: 0x4caf50, outline: 0x2e7d32 },
  bush: { fill: 0x2f6b3a, outline: 0x1b4d24 },
  area: { fill: 0xb08968, outline: 0x8d6e63 },
  tree: { fill: 0x3f8f46, outline: 0x2e7d32 },
}

function averageUpOfRing(ring: Position[]): number {
  const values = ring
    .map((position) => position[2])
    .filter((value): value is number => typeof value === 'number')
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function disposeMaterial(
  material: THREE.Material | THREE.Material[],
): void {
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose()
  } else {
    material.dispose()
  }
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child)
    child.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.LineSegments
      ) {
        object.geometry.dispose()
        disposeMaterial(object.material)
      }
    })
  }
}

function createUserAssetVisual(
  asset: UserAsset,
  selected: boolean,
  showHandles: boolean,
): UserAssetVisual {
  const group = new THREE.Group()
  const handles: THREE.Mesh[] = []
  const pickMeshes: THREE.Object3D[] = []

  if (asset.geometryLocal.type === 'Point') {
    const [east, north, up] = asset.geometryLocal.coordinates
    const radius = Math.max(0.2, asset.radiusM ?? 1.2)
    group.position.set(east, up, -north)

    const circle = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({
        color: selected ? 0xd97706 : ASSET_COLORS.tree.fill,
        transparent: true,
        opacity: selected ? 0.42 : 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    circle.rotation.x = -Math.PI / 2
    circle.position.y = 0.08
    circle.scale.setScalar(radius)
    circle.renderOrder = 3
    circle.userData.assetId = asset.id
    circle.userData.assetKind = 'tree'
    group.add(circle)
    pickMeshes.push(circle)

    const outlinePoints = Array.from({ length: 49 }, (_, index) => {
      const angle = (index / 48) * Math.PI * 2
      return new THREE.Vector3(
        Math.cos(angle),
        0.12,
        Math.sin(angle),
      )
    })
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(outlinePoints),
      new THREE.LineBasicMaterial({
        color: selected ? 0xf59e0b : ASSET_COLORS.tree.outline,
        transparent: true,
        opacity: 0.9,
      }),
    )
    outline.scale.setScalar(radius)
    outline.renderOrder = 4
    group.add(outline)

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.16, 1.0, 8),
      new THREE.MeshStandardMaterial({
        color: 0x6b4f3a,
        roughness: 0.95,
        metalness: 0,
      }),
    )
    trunk.position.y = 0.5
    trunk.userData.assetId = asset.id
    trunk.userData.assetKind = 'tree'
    group.add(trunk)
    pickMeshes.push(trunk)

    let radiusHandle: THREE.Mesh | undefined

    if (selected && showHandles) {
      radiusHandle = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xf59e0b }),
      )
      radiusHandle.position.set(radius, 0.4, 0)
      radiusHandle.renderOrder = 6
      radiusHandle.userData.assetId = asset.id
      radiusHandle.userData.radiusHandle = true
      group.add(radiusHandle)
    }

    return {
      asset,
      group,
      handles,
      pickMeshes,
      radiusHandle,
      circle,
      outline,
    }
  }

  const polygon = asset.geometryLocal
  const ring = openRing(polygon.coordinates[0] ?? [])
  const up = averageUpOfRing(ring)
  const colors = ASSET_COLORS[asset.kind]

  if (asset.kind === 'bush') {
    const geometry = new THREE.ExtrudeGeometry(
      shapeFromPolygon(polygon),
      { depth: 0.7, bevelEnabled: false, steps: 1 },
    )
    geometry.rotateX(-Math.PI / 2)
    const material = new THREE.MeshStandardMaterial({
      color: selected ? 0xd97706 : colors.fill,
      transparent: true,
      opacity: selected ? 0.65 : 0.5,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    })
    const fill = new THREE.Mesh(geometry, material)
    fill.position.y = up
    fill.renderOrder = 3
    fill.userData.assetId = asset.id
    fill.userData.assetKind = 'bush'
    group.add(fill)
    pickMeshes.push(fill)

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: selected ? 0xf59e0b : colors.outline,
        transparent: true,
        opacity: 0.75,
      }),
    )
    edges.renderOrder = 4
    fill.add(edges)
  } else {
    const geometry = new THREE.ShapeGeometry(
      shapeFromPolygon(polygon),
    )
    geometry.rotateX(-Math.PI / 2)
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: selected ? 0xd97706 : colors.fill,
        transparent: true,
        opacity: selected ? 0.4 : 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    fill.position.y = up + 0.05
    fill.renderOrder = 3
    fill.userData.assetId = asset.id
    fill.userData.assetKind = asset.kind
    group.add(fill)
    pickMeshes.push(fill)

    const points = ring.map(
      ([east, north, z]) =>
        new THREE.Vector3(
          east,
          (typeof z === 'number' ? z : up) + 0.08,
          -north,
        ),
    )
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: selected ? 0xf59e0b : colors.outline,
        transparent: true,
        opacity: 0.85,
      }),
    )
    outline.renderOrder = 4
    group.add(outline)
  }

  if (selected && showHandles) {
    const handleMaterial = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
    })
    ring.forEach(([east, north, z], index) => {
      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 12, 10),
        handleMaterial,
      )
      handle.position.set(
        east,
        (typeof z === 'number' ? z : up) + 0.35,
        -north,
      )
      handle.renderOrder = 6
      handle.userData.assetId = asset.id
      handle.userData.vertexIndex = index
      group.add(handle)
      handles.push(handle)
    })
  }

  return { asset, group, handles, pickMeshes }
}

export function PropertyScene({
  property,
  userAssets,
  viewMode,
  tool,
  draftPoints,
  selectedAssetId,
  selectedBuildingId,
  maskOutside,
  onGroundClick,
  onSelectAsset,
  onAssetGeometryChange,
  onAssetRadiusChange,
  onSelectBuilding,
}: PropertySceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SceneState | null>(null)
  const toolRef = useRef(tool)
  const selectedAssetIdRef = useRef(selectedAssetId)
  const onGroundClickRef = useRef(onGroundClick)
  const onSelectAssetRef = useRef(onSelectAsset)
  const onAssetGeometryChangeRef = useRef(onAssetGeometryChange)
  const onAssetRadiusChangeRef = useRef(onAssetRadiusChange)
  const onSelectBuildingRef = useRef(onSelectBuilding)

  useEffect(() => {
    toolRef.current = tool
  }, [tool])

  useEffect(() => {
    selectedAssetIdRef.current = selectedAssetId
  }, [selectedAssetId])

  useEffect(() => {
    onGroundClickRef.current = onGroundClick
  }, [onGroundClick])

  useEffect(() => {
    onSelectAssetRef.current = onSelectAsset
  }, [onSelectAsset])

  useEffect(() => {
    onAssetGeometryChangeRef.current = onAssetGeometryChange
  }, [onAssetGeometryChange])

  useEffect(() => {
    onAssetRadiusChangeRef.current = onAssetRadiusChange
  }, [onAssetRadiusChange])

  useEffect(() => {
    onSelectBuildingRef.current = onSelectBuilding
  }, [onSelectBuilding])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth || 800
    const height = container.clientHeight || 600

    // Frame the canvas to the section itself, not the surrounding contours.
    const bounds = combineBounds([property.site.boundaryLocal], 2)

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.setClearColor(0xf4f1ea, 1)
    renderer.domElement.style.display = 'block'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#f4f1ea')

    scene.add(new THREE.AmbientLight(0xffffff, 1.8))
    const sun = new THREE.DirectionalLight(0xffffff, 2.1)
    sun.position.set(60, 120, 80)
    scene.add(sun)

    const userAssetsGroup = new THREE.Group()
    scene.add(userAssetsGroup)
    const draftGroup = new THREE.Group()
    scene.add(draftGroup)

    const parcelShape = shapeFromPolygon(property.site.boundaryLocal)
    const parcelGeometry = new THREE.ShapeGeometry(parcelShape)
    parcelGeometry.rotateX(-Math.PI / 2)

    const ringUps = (property.site.boundaryLocal.coordinates[0] ?? [])
      .map((position) => position[2] ?? 0)
    const averageUp = ringUps.length
      ? ringUps.reduce((sum, value) => sum + value, 0) / ringUps.length
      : 0

    const [minLon, minLat, maxLon, maxLat] = wgs84Bounds(
      property.site.boundary,
    )
    const padLon = (maxLon - minLon) * 0.7
    const padLat = (maxLat - minLat) * 0.7
    const imageBbox: [number, number, number, number] = [
      minLon - padLon,
      minLat - padLat,
      maxLon + padLon,
      maxLat + padLat,
    ]

    const imageCorners = [
      enuFromWgs84(
        imageBbox[0],
        imageBbox[1],
        averageUp,
        property.site.origin,
      ),
      enuFromWgs84(
        imageBbox[2],
        imageBbox[1],
        averageUp,
        property.site.origin,
      ),
      enuFromWgs84(
        imageBbox[2],
        imageBbox[3],
        averageUp,
        property.site.origin,
      ),
      enuFromWgs84(
        imageBbox[0],
        imageBbox[3],
        averageUp,
        property.site.origin,
      ),
    ]

    const imageMinE = Math.min(...imageCorners.map((corner) => corner[0]))
    const imageMaxE = Math.max(...imageCorners.map((corner) => corner[0]))
    const imageMinN = Math.min(...imageCorners.map((corner) => corner[1]))
    const imageMaxN = Math.max(...imageCorners.map((corner) => corner[1]))
    const imageWidth = imageMaxE - imageMinE
    const imageHeight = imageMaxN - imageMinN
    const imageCenterE = (imageMinE + imageMaxE) / 2
    const imageCenterN = (imageMinN + imageMaxN) / 2

    let disposed = false
    let backgroundTexture: THREE.Texture | null = null
    const textureLoader = new THREE.TextureLoader()

    textureLoader.load(
      wccImageryUrl(imageBbox, 1024),
      (texture) => {
        if (disposed) {
          texture.dispose()
          return
        }

        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
        backgroundTexture = texture

        const background = new THREE.Mesh(
          new THREE.PlaneGeometry(imageWidth, imageHeight),
          new THREE.MeshBasicMaterial({
            map: texture,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
          }),
        )
        background.rotation.x = -Math.PI / 2
        background.position.set(
          imageCenterE,
          averageUp - 0.4,
          -imageCenterN,
        )
        background.renderOrder = -100
        scene.add(background)
      },
      undefined,
      () => {
        // The plan still works without the aerial backdrop.
      },
    )

    const maskShape = new THREE.Shape()
    maskShape.moveTo(imageMinE, imageMinN)
    maskShape.lineTo(imageMaxE, imageMinN)
    maskShape.lineTo(imageMaxE, imageMaxN)
    maskShape.lineTo(imageMinE, imageMaxN)
    maskShape.closePath()

    const parcelOuter = openRing(
      property.site.boundaryLocal.coordinates[0] ?? [],
    )
    if (parcelOuter.length >= 3) {
      maskShape.holes.push(
        new THREE.Path(
          parcelOuter.map(
            ([east, north]) => new THREE.Vector2(east, north),
          ),
        ),
      )
    }

    const maskGeometry = new THREE.ShapeGeometry(maskShape)
    maskGeometry.rotateX(-Math.PI / 2)
    const maskMesh = new THREE.Mesh(
      maskGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x1f2a24,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    )
    maskMesh.position.y = averageUp - 0.3
    maskMesh.renderOrder = -50
    maskMesh.visible = maskOutside
    scene.add(maskMesh)

    const parcelMesh = new THREE.Mesh(
      parcelGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x2e7d32,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    parcelMesh.position.y = averageUp + 0.03
    parcelMesh.renderOrder = 1
    scene.add(parcelMesh)

    for (const ring of property.site.boundaryLocal.coordinates) {
      const points = ring.map(
        (position) =>
          new THREE.Vector3(position[0], (position[2] ?? 0) + 0.06, -position[1]),
      )
      if (points.length < 2) continue
      const boundaryLine = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x2e7d32 }),
      )
      boundaryLine.renderOrder = 2
      scene.add(boundaryLine)
    }

    const buildingMeshes = new Map<string, BuildingMeshEntry>()

    for (const building of property.buildings) {
      const shape = shapeFromPolygon(building.geometryLocal)
      const depth = Math.max(building.heightM, 0.5)
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: false,
        steps: 1,
      })
      geometry.rotateX(-Math.PI / 2)

      const material = new THREE.MeshStandardMaterial({
        color: 0x9aa0a6,
        roughness: 0.85,
        metalness: 0,
        transparent: true,
        opacity: 0.38,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.y = meshUpForBuilding(building, property)
      mesh.userData.buildingId = building.id
      mesh.renderOrder = 3

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({
          color: 0x4b5563,
          transparent: true,
          opacity: 0.35,
        }),
      )
      edges.renderOrder = 4
      mesh.add(edges)
      scene.add(mesh)

      buildingMeshes.set(building.id, {
        mesh,
        edges,
        material,
        edgeMaterial: edges.material as THREE.LineBasicMaterial,
      })
    }

    const elevations = property.contours.map(
      (contour) => contour.elevationM,
    )
    const minElevation = elevations.length
      ? Math.min(...elevations)
      : 0
    const maxElevation = elevations.length
      ? Math.max(...elevations)
      : 1

    for (const contour of property.contours) {
      const points = contour.geometryLocal.coordinates.map(
        (position) =>
          new THREE.Vector3(
            position[0],
            (position[2] ?? 0) + 0.08,
            -position[1],
          ),
      )
      if (points.length < 2) continue

      const color = colorForElevation(
        contour.elevationM,
        minElevation,
        maxElevation,
      )
      const contourLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
        }),
      )
      contourLine.renderOrder = -60
      scene.add(contourLine)
    }

    const addressScene = localToScene(property.address.local)
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xd97706 }),
    )
    marker.position.set(
      addressScene.x,
      addressScene.y + 1.5,
      addressScene.z,
    )
    scene.add(marker)

    scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(
            addressScene.x,
            addressScene.y,
            addressScene.z,
          ),
          new THREE.Vector3(
            addressScene.x,
            addressScene.y + 1.5,
            addressScene.z,
          ),
        ]),
        new THREE.LineBasicMaterial({ color: 0xd97706 }),
      ),
    )

    const aspect = width / height

    const planCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
    planCamera.up.set(0, 0, -1)
    planCamera.position.set(
      bounds.centerE,
      200,
      -bounds.centerN,
    )
    planCamera.lookAt(bounds.centerE, 0, -bounds.centerN)
    updatePlanFrustum(planCamera, bounds, aspect)

    const span = Math.max(bounds.spanE, bounds.spanN, 12)
    const orbitCamera = new THREE.PerspectiveCamera(
      45,
      aspect,
      0.1,
      2000,
    )
    orbitCamera.up.set(0, 1, 0)
    orbitCamera.position.set(
      bounds.centerE + span * 0.75,
      span * 0.85,
      -bounds.centerN + span * 0.75,
    )
    orbitCamera.lookAt(bounds.centerE, 0, -bounds.centerN)

    const planControls = new OrbitControls(
      planCamera,
      renderer.domElement,
    )
    planControls.target.set(bounds.centerE, 0, -bounds.centerN)
    planControls.enableRotate = false
    planControls.enablePan = true
    planControls.screenSpacePanning = true
    planControls.enableZoom = true
    planControls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }
    planControls.update()

    const orbitControls = new OrbitControls(
      orbitCamera,
      renderer.domElement,
    )
    orbitControls.target.set(bounds.centerE, 0, -bounds.centerN)
    orbitControls.enableDamping = true
    orbitControls.dampingFactor = 0.08
    orbitControls.maxPolarAngle = Math.PI / 2.05
    orbitControls.minDistance = Math.max(5, span * 0.3)
    orbitControls.maxDistance = span * 5
    orbitControls.update()

    const activeCamera =
      viewMode === 'plan' ? planCamera : orbitCamera
    const activeControls =
      viewMode === 'plan' ? planControls : orbitControls

    planControls.enabled = viewMode === 'plan'
    orbitControls.enabled = viewMode === '3d'

    const state: SceneState = {
      scene,
      renderer,
      planCamera,
      orbitCamera,
      activeCamera,
      planControls,
      orbitControls,
      activeControls,
      buildingMeshes,
      userAssetsGroup,
      draftGroup,
      userAssetVisuals: new Map(),
      vertexHandles: [],
      radiusHandles: [],
      maskMesh,
      bounds,
      raf: 0,
    }
    stateRef.current = state

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const groundPlane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -averageUp,
    )
    let pointerDown = { x: 0, y: 0, moved: false }
    let hitOnPointerDown = false
    let dragState: DragState | null = null

    const setControlsForTool = () => {
      const editing = toolRef.current !== 'pan'
      const plan = viewMode === 'plan'
      const active = plan ? planControls : orbitControls
      const inactive = plan ? orbitControls : planControls
      inactive.enabled = false
      active.enabled = !editing
    }

    const updatePointer = (
      clientX: number,
      clientY: number,
    ): LocalPosition | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, state.activeCamera)
      const point = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(groundPlane, point)) {
        return null
      }
      return [point.x, -point.z, point.y]
    }

    const raycast = (objects: THREE.Object3D[]) =>
      raycaster.intersectObjects(objects, false)

    const getVertexHandle = (
      clientX: number,
      clientY: number,
    ): VertexHandle | null => {
      const stateNow = stateRef.current
      if (!stateNow) return null
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, state.activeCamera)
      const hits = raycast(
        stateNow.vertexHandles.map((handle) => handle.mesh),
      )
      if (!hits.length) return null
      return (
        stateNow.vertexHandles.find(
          (handle) => handle.mesh === hits[0].object,
        ) ?? null
      )
    }

    const getRadiusHandle = (
      clientX: number,
      clientY: number,
    ): { assetId: string; mesh: THREE.Mesh } | null => {
      const stateNow = stateRef.current
      if (!stateNow) return null
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, state.activeCamera)
      const hits = raycast(
        stateNow.radiusHandles.map((handle) => handle.mesh),
      )
      if (!hits.length) return null
      return (
        stateNow.radiusHandles.find(
          (handle) => handle.mesh === hits[0].object,
        ) ?? null
      )
    }

    const getAssetHit = (
      clientX: number,
      clientY: number,
      treesOnly = false,
    ): string | null => {
      const stateNow = stateRef.current
      if (!stateNow) return null
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, state.activeCamera)

      const meshes = [...stateNow.userAssetVisuals.values()].flatMap(
        (visual) => visual.pickMeshes,
      )
      for (const hit of raycast(meshes)) {
        const id = hit.object.userData.assetId as string | undefined
        if (!id) continue
        const visual = stateNow.userAssetVisuals.get(id)
        if (treesOnly && visual?.asset.kind !== 'tree') continue
        return id
      }
      return null
    }

    const getBuildingHit = (
      clientX: number,
      clientY: number,
    ): string | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, state.activeCamera)

      const hits = raycast(
        [...buildingMeshes.values()].map((entry) => entry.mesh),
      )
      for (const hit of hits) {
        const id = hit.object.userData.buildingId as
          | string
          | undefined
        if (id) return id
      }
      return null
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      pointerDown = {
        x: event.clientX,
        y: event.clientY,
        moved: false,
      }
      hitOnPointerDown = false

      if (toolRef.current !== 'select') return

      const stateNow = stateRef.current
      if (!stateNow) return

      const radiusHandle = getRadiusHandle(
        event.clientX,
        event.clientY,
      )
      if (radiusHandle) {
        const visual = stateNow.userAssetVisuals.get(
          radiusHandle.assetId,
        )
        if (visual && visual.asset.geometryLocal.type === 'Point') {
          hitOnPointerDown = true
          onSelectAssetRef.current(radiusHandle.assetId)
          dragState = {
            kind: 'radius',
            assetId: radiusHandle.assetId,
            vertexIndex: 0,
            geometryLocal: visual.asset.geometryLocal,
            radius: visual.asset.radiusM ?? 1.2,
          }
          planControls.enabled = false
          orbitControls.enabled = false
          renderer.domElement.setPointerCapture(event.pointerId)
        }
        return
      }

      const handle = getVertexHandle(event.clientX, event.clientY)
      if (handle) {
        const visual = stateNow.userAssetVisuals.get(handle.assetId)
        if (visual && visual.asset.geometryLocal.type === 'Polygon') {
          hitOnPointerDown = true
          onSelectAssetRef.current(handle.assetId)
          dragState = {
            kind: 'vertex',
            assetId: handle.assetId,
            vertexIndex: handle.index,
            geometryLocal: {
              type: 'Polygon',
              coordinates: visual.asset.geometryLocal.coordinates.map(
                (ring) =>
                  ring.map(
                    (position) => [...position] as Position,
                  ),
              ),
            },
          }
          planControls.enabled = false
          orbitControls.enabled = false
          renderer.domElement.setPointerCapture(event.pointerId)
        }
        return
      }

      const treeId = getAssetHit(event.clientX, event.clientY, true)
      if (treeId) {
        const visual = stateNow.userAssetVisuals.get(treeId)
        if (visual && visual.asset.geometryLocal.type === 'Point') {
          hitOnPointerDown = true
          onSelectAssetRef.current(treeId)
          dragState = {
            kind: 'tree',
            assetId: treeId,
            vertexIndex: 0,
            geometryLocal: {
              type: 'Point',
              coordinates: [
                ...visual.asset.geometryLocal.coordinates,
              ] as Position,
            },
          }
          planControls.enabled = false
          orbitControls.enabled = false
          renderer.domElement.setPointerCapture(event.pointerId)
        }
        return
      }

      const assetId = getAssetHit(event.clientX, event.clientY)
      if (assetId) {
        hitOnPointerDown = true
        onSelectAssetRef.current(assetId)
        return
      }

      const buildingId = getBuildingHit(event.clientX, event.clientY)
      if (buildingId) {
        hitOnPointerDown = true
        onSelectBuildingRef.current(buildingId)
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (
        !pointerDown.moved &&
        Math.hypot(
          event.clientX - pointerDown.x,
          event.clientY - pointerDown.y,
        ) > 5
      ) {
        pointerDown.moved = true
      }

      if (!dragState) return

      const local = updatePointer(event.clientX, event.clientY)
      if (!local) return

      const stateNow = stateRef.current
      if (!stateNow) return

      if (dragState.kind === 'radius') {
        const visual = stateNow.userAssetVisuals.get(
          dragState.assetId,
        )
        if (
          !visual ||
          visual.asset.geometryLocal.type !== 'Point'
        ) {
          return
        }

        const [centerEast, centerNorth] =
          visual.asset.geometryLocal.coordinates
        const radius = Math.max(
          0.2,
          Math.min(
            20,
            Math.hypot(
              local[0] - centerEast,
              local[1] - centerNorth,
            ),
          ),
        )

        dragState.radius = radius
        visual.circle?.scale.setScalar(radius)
        visual.outline?.scale.setScalar(radius)
        if (visual.radiusHandle) {
          visual.radiusHandle.position.x = radius
        }
        return
      }

      if (dragState.kind === 'tree') {
        const visual = stateNow.userAssetVisuals.get(
          dragState.assetId,
        )
        if (visual) {
          visual.group.position.set(local[0], local[2], -local[1])
        }
        dragState.geometryLocal = {
          type: 'Point',
          coordinates: local,
        }
        return
      }

      if (dragState.geometryLocal.type !== 'Polygon') return
      const ring = dragState.geometryLocal.coordinates[0]
      if (!ring) return
      const index = dragState.vertexIndex
      if (index < 0 || index >= ring.length) return

      ring[index] = local
      if (index === 0 && ring.length > 1) {
        ring[ring.length - 1] = local
      }

      const visual = stateNow.userAssetVisuals.get(dragState.assetId)
      if (!visual) return

      const handle = stateNow.vertexHandles.find(
        (entry) =>
          entry.assetId === dragState?.assetId &&
          entry.index === index,
      )
      if (handle) {
        handle.mesh.position.set(
          local[0],
          local[2] + 0.35,
          -local[1],
        )
      }

      if (visual.outline instanceof THREE.LineLoop) {
        const points = ring.slice(0, -1).map(([east, north, z]) => {
          return new THREE.Vector3(
            east,
            (typeof z === 'number' ? z : local[2]) + 0.08,
            -north,
          )
        })
        visual.outline.geometry.dispose()
        visual.outline.geometry =
          new THREE.BufferGeometry().setFromPoints(points)
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const stateNow = stateRef.current
      if (!stateNow) return

      if (dragState) {
        if (dragState.kind === 'radius') {
          onAssetRadiusChangeRef.current(
            dragState.assetId,
            dragState.radius ?? 1.2,
          )
        } else {
          onAssetGeometryChangeRef.current(
            dragState.assetId,
            dragState.geometryLocal,
            true,
          )
        }
        dragState = null
        if (
          renderer.domElement.hasPointerCapture(event.pointerId)
        ) {
          renderer.domElement.releasePointerCapture(
            event.pointerId,
          )
        }
        setControlsForTool()
        return
      }

      if (pointerDown.moved) return

      const activeTool = toolRef.current
      if (activeTool === 'pan') return

      if (activeTool === 'select') {
        if (!hitOnPointerDown) {
          onSelectAssetRef.current(null)
          onSelectBuildingRef.current(null)
        }
        return
      }

      const local = updatePointer(event.clientX, event.clientY)
      if (local) onGroundClickRef.current(local)
    }

    const handleDoubleClick = (event: MouseEvent) => {
      if (toolRef.current !== 'select') return

      const local = updatePointer(event.clientX, event.clientY)
      if (!local) return

      const stateNow = stateRef.current
      if (!stateNow) return

      const visuals = [...stateNow.userAssetVisuals.values()]
      const selectedIndex = visuals.findIndex(
        (visual) =>
          visual.asset.id === selectedAssetIdRef.current,
      )
      if (selectedIndex > 0) {
        const [selected] = visuals.splice(selectedIndex, 1)
        visuals.unshift(selected)
      }

      for (const visual of visuals) {
        if (visual.asset.geometryLocal.type !== 'Polygon') continue

        const next = insertPointOnPolygon(
          visual.asset.geometryLocal,
          local,
          3,
        )
        if (!next) continue

        onAssetGeometryChangeRef.current(
          visual.asset.id,
          next,
          false,
        )
        onSelectAssetRef.current(visual.asset.id)
        return
      }
    }

    renderer.domElement.addEventListener(
      'pointerdown',
      handlePointerDown,
    )
    renderer.domElement.addEventListener(
      'pointermove',
      handlePointerMove,
    )
    renderer.domElement.addEventListener(
      'pointerup',
      handlePointerUp,
    )
    renderer.domElement.addEventListener(
      'dblclick',
      handleDoubleClick,
    )

    const render = () => {
      state.activeControls.update()
      renderer.render(scene, state.activeCamera)
      state.raf = requestAnimationFrame(render)
    }
    render()

    const resize = () => {
      const nextWidth = container.clientWidth
      const nextHeight = container.clientHeight
      if (!nextWidth || !nextHeight) return

      renderer.setSize(nextWidth, nextHeight)
      const nextAspect = nextWidth / nextHeight

      orbitCamera.aspect = nextAspect
      orbitCamera.updateProjectionMatrix()
      updatePlanFrustum(planCamera, bounds, nextAspect)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)

    return () => {
      disposed = true
      backgroundTexture?.dispose()
      cancelAnimationFrame(state.raf)
      observer.disconnect()
      renderer.domElement.removeEventListener(
        'pointerdown',
        handlePointerDown,
      )
      renderer.domElement.removeEventListener(
        'pointermove',
        handlePointerMove,
      )
      renderer.domElement.removeEventListener(
        'pointerup',
        handlePointerUp,
      )
      renderer.domElement.removeEventListener(
        'dblclick',
        handleDoubleClick,
      )
      planControls.dispose()
      orbitControls.dispose()

      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.Line ||
          object instanceof THREE.LineSegments
        ) {
          object.geometry.dispose()
          const material = object.material
          if (Array.isArray(material)) {
            for (const entry of material) entry.dispose()
          } else {
            material.dispose()
          }
        }
      })

      renderer.dispose()
      renderer.domElement.remove()
      stateRef.current = null
    }
  }, [property, viewMode])

  useEffect(() => {
    const state = stateRef.current
    if (!state) return

    const plan = viewMode === 'plan'
    const active = plan ? state.planControls : state.orbitControls
    const inactive = plan ? state.orbitControls : state.planControls
    inactive.enabled = false
    active.enabled = tool === 'pan'
  }, [tool, viewMode, property])

  useEffect(() => {
    const state = stateRef.current
    if (!state) return

    clearGroup(state.userAssetsGroup)
    state.userAssetVisuals.clear()
    state.vertexHandles = []
    state.radiusHandles = []

    const showHandles = tool === 'select'

    for (const asset of userAssets) {
      const visual = createUserAssetVisual(
        asset,
        asset.id === selectedAssetId,
        showHandles,
      )
      state.userAssetsGroup.add(visual.group)
      state.userAssetVisuals.set(asset.id, visual)

      for (const handle of visual.handles) {
        const index = handle.userData.vertexIndex as number
        state.vertexHandles.push({
          assetId: asset.id,
          index,
          mesh: handle,
        })
      }

      if (visual.radiusHandle) {
        state.radiusHandles.push({
          assetId: asset.id,
          mesh: visual.radiusHandle,
        })
      }
    }
  }, [userAssets, selectedAssetId, tool, property, viewMode])

  useEffect(() => {
    const state = stateRef.current
    if (!state) return

    clearGroup(state.draftGroup)
    if (!draftPoints.length) return

    const points = draftPoints.map(
      ([east, north, up]) =>
        new THREE.Vector3(east, up + 0.2, -north),
    )

    for (const point of points) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xf59e0b }),
      )
      marker.position.copy(point)
      marker.renderOrder = 10
      state.draftGroup.add(marker)
    }

    if (points.length >= 2) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.9,
        }),
      )
      line.renderOrder = 10
      state.draftGroup.add(line)
    }
  }, [draftPoints, property, viewMode])

  useEffect(() => {
    const state = stateRef.current
    if (!state) return

    for (const [id, entry] of state.buildingMeshes) {
      const selected = id === selectedBuildingId
      entry.material.color.set(selected ? 0xd97706 : 0x9aa0a6)
      entry.material.emissive.set(selected ? 0x5a2c00 : 0x000000)
      entry.material.emissiveIntensity = selected ? 0.2 : 0
      entry.material.opacity = selected ? 0.65 : 0.38
      entry.edgeMaterial.color.set(selected ? 0xd97706 : 0x4b5563)
    }
  }, [selectedBuildingId, property, viewMode])

  useEffect(() => {
    const state = stateRef.current
    if (state) {
      state.maskMesh.visible = maskOutside
    }
  }, [maskOutside, property, viewMode])

  return <div ref={containerRef} className="map-canvas" />
}
