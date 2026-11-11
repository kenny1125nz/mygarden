import * as turf from '@turf/turf'
import type {
  Feature,
  Geometry,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
  Position,
} from 'geojson'

export interface Origin {
  lon: number
  lat: number
  altM: number
}

export interface LocalBounds {
  minE: number
  maxE: number
  minN: number
  maxN: number
  centerE: number
  centerN: number
  spanE: number
  spanN: number
}

const WGS84_A = 6378137.0
const WGS84_E2 = 6.69437999014e-3

function ecef(lon: number, lat: number, alt: number): [number, number, number] {
  const lambda = (lon * Math.PI) / 180
  const phi = (lat * Math.PI) / 180
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi)

  return [
    (n + alt) * cosPhi * Math.cos(lambda),
    (n + alt) * cosPhi * Math.sin(lambda),
    (n * (1 - WGS84_E2) + alt) * sinPhi,
  ]
}

export function enuFromWgs84(
  lon: number,
  lat: number,
  alt: number,
  origin: Origin,
): [number, number, number] {
  const [x, y, z] = ecef(lon, lat, alt)
  const [x0, y0, z0] = ecef(origin.lon, origin.lat, origin.altM)
  const dx = x - x0
  const dy = y - y0
  const dz = z - z0

  const lambda = (origin.lon * Math.PI) / 180
  const phi = (origin.lat * Math.PI) / 180
  const sinLambda = Math.sin(lambda)
  const cosLambda = Math.cos(lambda)
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)

  const east = -sinLambda * dx + cosLambda * dy
  const north =
    -sinPhi * cosLambda * dx - sinPhi * sinLambda * dy + cosPhi * dz
  const up = cosPhi * cosLambda * dx + cosPhi * sinLambda * dy + sinPhi * dz

  return [east, north, up]
}

export function wgs84FromEnu(
  east: number,
  north: number,
  up: number,
  origin: Origin,
): [number, number, number] {
  const [x0, y0, z0] = ecef(origin.lon, origin.lat, origin.altM)
  const lambda = (origin.lon * Math.PI) / 180
  const phi = (origin.lat * Math.PI) / 180
  const sinLambda = Math.sin(lambda)
  const cosLambda = Math.cos(lambda)
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)

  const dx =
    -sinLambda * east -
    sinPhi * cosLambda * north +
    cosPhi * cosLambda * up
  const dy =
    cosLambda * east -
    sinPhi * sinLambda * north +
    cosPhi * sinLambda * up
  const dz = cosPhi * north + sinPhi * up

  const x = x0 + dx
  const y = y0 + dy
  const z = z0 + dz

  const lon = Math.atan2(y, x)
  const p = Math.hypot(x, y)
  let lat = Math.atan2(z, p * (1 - WGS84_E2))
  let alt = 0

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const sinLat = Math.sin(lat)
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat)
    alt = p / Math.cos(lat) - n
    const next = Math.atan2(
      z,
      p * (1 - (WGS84_E2 * n) / (n + alt)),
    )
    if (Math.abs(next - lat) < 1e-12) {
      lat = next
      break
    }
    lat = next
  }

  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI, alt]
}

export function localGeometryToWgs84(
  geometry: Geometry,
  origin: Origin,
): Geometry {
  const raw = geometry as unknown as {
    type: string
    coordinates: unknown
  }

  const mapCoords = (coords: unknown): unknown => {
    if (
      Array.isArray(coords) &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      const east = coords[0]
      const north = coords[1]
      const up =
        typeof coords[2] === 'number' ? coords[2] : origin.altM
      return wgs84FromEnu(east, north, up, origin)
    }

    return (coords as unknown[]).map(mapCoords)
  }

  return {
    type: raw.type,
    coordinates: mapCoords(raw.coordinates),
  } as Geometry
}

export function toLocalGeometry(
  geometry: Geometry,
  origin: Origin,
  zFor?: (lon: number, lat: number) => number,
): Geometry {
  const raw = geometry as unknown as { type: string; coordinates: unknown }

  const mapCoords = (coords: unknown): unknown => {
    if (
      Array.isArray(coords) &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      const lon = coords[0]
      const lat = coords[1]
      const z =
        typeof coords[2] === 'number'
          ? coords[2]
          : zFor?.(lon, lat) ?? origin.altM
      return enuFromWgs84(lon, lat, z, origin)
    }

    return (coords as unknown[]).map(mapCoords)
  }

  return {
    type: raw.type,
    coordinates: mapCoords(raw.coordinates),
  } as Geometry
}

export function collectPositions(geometry: Geometry): Position[] {
  const positions: Position[] = []
  const raw = geometry as unknown as { type: string; coordinates: unknown }

  const walk = (value: unknown) => {
    if (
      Array.isArray(value) &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      positions.push(value as Position)
      return
    }
    if (Array.isArray(value)) {
      for (const child of value) walk(child)
    }
  }

  walk(raw.coordinates)
  return positions
}

export function combineBounds(geometries: Geometry[], paddingM = 4): LocalBounds {
  const positions = geometries.flatMap(collectPositions)
  if (!positions.length) {
    return {
      minE: -10,
      maxE: 10,
      minN: -10,
      maxN: 10,
      centerE: 0,
      centerN: 0,
      spanE: 20,
      spanN: 20,
    }
  }

  let minE = Number.POSITIVE_INFINITY
  let maxE = Number.NEGATIVE_INFINITY
  let minN = Number.POSITIVE_INFINITY
  let maxN = Number.NEGATIVE_INFINITY

  for (const position of positions) {
    minE = Math.min(minE, position[0])
    maxE = Math.max(maxE, position[0])
    minN = Math.min(minN, position[1])
    maxN = Math.max(maxN, position[1])
  }

  minE -= paddingM
  maxE += paddingM
  minN -= paddingM
  maxN += paddingM

  return {
    minE,
    maxE,
    minN,
    maxN,
    centerE: (minE + maxE) / 2,
    centerN: (minN + maxN) / 2,
    spanE: maxE - minE,
    spanN: maxN - minN,
  }
}

export function localRingArea(ring: Position[]): number {
  if (ring.length < 3) return 0

  let sum = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]
    sum += current[0] * next[1] - next[0] * current[1]
  }

  return Math.abs(sum) / 2
}

export function simplifyRing(
  ring: Position[],
  toleranceM = 0.3,
): Position[] {
  if (ring.length < 3) return ring

  const isClosed =
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  const points = (isClosed ? ring.slice(0, -1) : ring.slice()).map(
    (position) => [...position] as Position,
  )

  if (points.length <= 3) {
    return isClosed ? [...points, points[0]] : points
  }

  let changed = true

  while (changed && points.length > 3) {
    changed = false

    for (let index = 0; index < points.length; index += 1) {
      if (points.length <= 3) break

      const previous =
        points[(index - 1 + points.length) % points.length]
      const current = points[index]
      const next = points[(index + 1) % points.length]

      const acx = next[0] - previous[0]
      const acy = next[1] - previous[1]
      const lengthSquared = acx * acx + acy * acy
      if (lengthSquared < 1e-9) continue

      const t =
        ((current[0] - previous[0]) * acx +
          (current[1] - previous[1]) * acy) /
        lengthSquared
      if (t <= 0 || t >= 1) continue

      const projectedX = previous[0] + t * acx
      const projectedY = previous[1] + t * acy
      const distance = Math.hypot(
        current[0] - projectedX,
        current[1] - projectedY,
      )

      if (distance <= toleranceM) {
        points.splice(index, 1)
        changed = true
        break
      }
    }
  }

  return isClosed ? [...points, points[0]] : points
}

export function simplifyDraft(
  points: Position[],
  toleranceM = 0.3,
): Position[] {
  if (points.length < 3) return points
  const closed = [...points, points[0]]
  return simplifyRing(closed, toleranceM).slice(0, -1)
}

export function bufferParcel(
  parcel: Feature<Polygon>,
  meters: number,
): Feature<Polygon | MultiPolygon> {
  return (
    turf.buffer(parcel, meters / 1000, { units: 'kilometers' }) ?? parcel
  )
}

type Point2 = [number, number]

function toPoint2(position: Position): Point2 {
  return [position[0], position[1]]
}

function samePoint(a: Point2, b: Point2): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

function polygonEdges(
  polygon: Feature<Polygon | MultiPolygon>,
): Array<[Point2, Point2]> {
  const rings =
    polygon.geometry.type === 'Polygon'
      ? polygon.geometry.coordinates
      : polygon.geometry.coordinates.flat()

  const edges: Array<[Point2, Point2]> = []

  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const a = toPoint2(ring[index])
      const b = toPoint2(ring[(index + 1) % ring.length])
      if (!samePoint(a, b)) edges.push([a, b])
    }
  }

  return edges
}

function intersectSegment(
  a: Point2,
  b: Point2,
  c: Point2,
  d: Point2,
): { t: number; point: Point2 } | null {
  const rx = b[0] - a[0]
  const ry = b[1] - a[1]
  const sx = d[0] - c[0]
  const sy = d[1] - c[1]
  const denominator = cross(rx, ry, sx, sy)

  if (Math.abs(denominator) < 1e-12) return null

  const qpx = c[0] - a[0]
  const qpy = c[1] - a[1]
  const t = cross(qpx, qpy, sx, sy) / denominator
  const u = cross(qpx, qpy, rx, ry) / denominator

  if (t <= 0 || t >= 1 || u < 0 || u > 1) return null

  return {
    t,
    point: [a[0] + t * rx, a[1] + t * ry],
  }
}

function clipSegment(
  a: Point2,
  b: Point2,
  edges: Array<[Point2, Point2]>,
  polygon: Feature<Polygon | MultiPolygon>,
): Array<[Point2, Point2]> {
  const cuts: Array<{ t: number; point: Point2 }> = [
    { t: 0, point: a },
    { t: 1, point: b },
  ]

  for (const [c, d] of edges) {
    const intersection = intersectSegment(a, b, c, d)
    if (intersection) cuts.push(intersection)
  }

  cuts.sort((left, right) => left.t - right.t)

  const unique: Array<{ t: number; point: Point2 }> = []
  for (const cut of cuts) {
    const previous = unique[unique.length - 1]
    if (!previous || Math.abs(cut.t - previous.t) > 1e-9) {
      unique.push(cut)
    }
  }

  const segments: Array<[Point2, Point2]> = []

  for (let index = 0; index < unique.length - 1; index += 1) {
    const start = unique[index].point
    const end = unique[index + 1].point
    const midpoint: Point2 = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
    ]

    if (turf.booleanPointInPolygon(midpoint, polygon)) {
      segments.push([start, end])
    }
  }

  return segments
}

export function clipLineToPolygon(
  line: Feature<LineString>,
  polygon: Feature<Polygon | MultiPolygon>,
): Feature<LineString>[] {
  const edges = polygonEdges(polygon)
  const coordinates = line.geometry.coordinates
  const pieces: Feature<LineString>[] = []
  let current: Point2[] | null = null

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const a = toPoint2(coordinates[index])
    const b = toPoint2(coordinates[index + 1])

    for (const [start, end] of clipSegment(a, b, edges, polygon)) {
      if (!current) {
        current = [start, end]
      } else if (samePoint(current[current.length - 1], start)) {
        current.push(end)
      } else {
        if (current.length >= 2) pieces.push(turf.lineString(current))
        current = [start, end]
      }
    }
  }

  if (current && current.length >= 2) {
    pieces.push(turf.lineString(current))
  }

  return pieces.filter((piece) => lineLengthM(piece) > 0.2)
}

export function areaM2(feature: Feature<Polygon | MultiPolygon>): number {
  return turf.area(feature)
}

export function lineLengthM(feature: Feature<LineString>): number {
  return turf.length(feature, { units: 'meters' })
}

export function polygonPerimeterM(feature: Feature<Polygon>): number {
  const boundary = turf.polygonToLine(feature) as Feature<
    LineString | MultiLineString
  >
  return turf.length(boundary, { units: 'meters' })
}

export function intersectionAreaM2(
  building: Feature<Polygon>,
  parcel: Feature<Polygon>,
): number {
  const intersection = turf.intersect(
    turf.featureCollection([building, parcel]),
  )
  return intersection ? turf.area(intersection) : 0
}

export function centroidOf(feature: Feature<Polygon>): [number, number] {
  const [lon, lat] = turf.centroid(feature).geometry.coordinates
  return [lon, lat]
}

export function bboxOf(
  feature: Feature<Polygon | MultiPolygon>,
): [number, number, number, number] {
  return turf.bbox(feature) as [number, number, number, number]
}
