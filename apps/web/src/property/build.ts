import * as turf from '@turf/turf'
import type { Feature, LineString, Polygon } from 'geojson'
import {
  areaM2,
  centroidOf,
  clipLineToPolygon,
  enuFromWgs84,
  intersectionAreaM2,
  lineLengthM,
  polygonPerimeterM,
  toLocalGeometry,
  type Origin,
} from './geo'
import type {
  BuildingAsset,
  ContourSegment,
  PropertyData,
  ResolvedAddress,
  WccBuildingFeature,
  WccContourFeature,
  WccParcelFeature,
} from './types'
import { WCC_SOURCES } from './wcc'

export interface BuildPropertyArgs {
  address: ResolvedAddress & { query: string }
  parcel: WccParcelFeature
  buildings: WccBuildingFeature[]
  contours: WccContourFeature[]
  contourSource: string
  bufferM: number
  fetchElevation: (lon: number, lat: number) => Promise<number | null>
  onProgress?: (message: string) => void
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export async function buildPropertyData(
  args: BuildPropertyArgs,
): Promise<PropertyData> {
  const parcel = args.parcel as Feature<Polygon>
  const parcelGeometry = parcel.geometry

  const [originLon, originLat] = centroidOf(parcel)
  const originAlt =
    (await args.fetchElevation(originLon, originLat)) ?? 0

  const origin: Origin = {
    lon: originLon,
    lat: originLat,
    altM: originAlt,
  }

  const buffer = turf.buffer(parcel, args.bufferM / 1000, {
    units: 'kilometers',
  })

  if (!buffer) {
    throw new Error('Could not build a property buffer for contour clipping.')
  }

  const buildings: BuildingAsset[] = []
  let buildingIndex = 0

  for (const source of args.buildings) {
    const building = source as Feature<Polygon>
    const buildingAreaM2 = areaM2(building)
    const withinPropertyM2 = intersectionAreaM2(building, parcel)
    const withinRatio =
      buildingAreaM2 > 0 ? withinPropertyM2 / buildingAreaM2 : 0

    if (withinPropertyM2 < 1 || withinRatio < 0.15) continue

    const [lon, lat] = centroidOf(building)
    const properties = source.properties

    const baseElevation =
      Number.isFinite(properties.base_elev) && Number(properties.base_elev) > -1000
        ? Number(properties.base_elev)
        : (await args.fetchElevation(lon, lat)) ?? originAlt

    const height =
      Number.isFinite(properties.approx_hei) &&
      Number(properties.approx_hei) > 0
        ? Number(properties.approx_hei)
        : 3

    const geometryLocal = toLocalGeometry(
      building.geometry,
      origin,
      () => baseElevation,
    ) as Polygon

    buildings.push({
      id: `building-${properties.OBJECTID_1 ?? buildingIndex}`,
      kind: 'building',
      label: `Building ${buildingIndex + 1}`,
      geometry: building.geometry,
      geometryLocal,
      baseElevationM: baseElevation,
      heightM: height,
      areaM2: buildingAreaM2,
      withinPropertyM2,
      attributes: {
        objectId: properties.OBJECTID_1,
        status: properties.Status,
        exceptionCode: properties.Excep_code,
        buildingSpatialId: properties.Building_Spatial_ID_1,
        baseElevation: properties.base_elev,
        approximateHeight: properties.approx_hei,
        lastEditedAt: properties.Last_Edit_
          ? new Date(properties.Last_Edit_).toISOString()
          : undefined,
      },
    })

    buildingIndex += 1
  }

  buildings.sort((a, b) => b.areaM2 - a.areaM2)
  buildings.forEach((building, index) => {
    building.label =
      index === 0 ? 'Main building' : `Outbuilding ${index}`
  })

  const parcelElevations: number[] = []
  const contours: ContourSegment[] = []
  let contourIndex = 0

  for (const source of args.contours) {
    const line = source as Feature<LineString>
    const elevation = Number(source.properties.ELEVATION)

    if (!Number.isFinite(elevation)) continue

    const insideParcel = clipLineToPolygon(line, parcel)
    if (insideParcel.length) parcelElevations.push(elevation)

    const pieces = clipLineToPolygon(line, buffer)
    for (const piece of pieces) {
      const lengthM = lineLengthM(piece)
      if (lengthM <= 0.2) continue

      const geometryLocal = toLocalGeometry(
        piece.geometry,
        origin,
        () => elevation,
      ) as LineString

      contours.push({
        id: `contour-${contourIndex}`,
        elevationM: elevation,
        layer: String(source.properties.LAYER ?? ''),
        geometry: piece.geometry,
        geometryLocal,
        lengthM,
      })

      contourIndex += 1
    }
  }

  contours.sort(
    (a, b) =>
      a.elevationM - b.elevationM || b.lengthM - a.lengthM,
  )

  const ring = parcelGeometry.coordinates[0] ?? []
  const uniqueBoundary = new Map<string, [number, number]>()

  for (const [lon, lat] of ring) {
    uniqueBoundary.set(`${lon.toFixed(7)},${lat.toFixed(7)}`, [lon, lat])
  }

  const boundaryElevations = new Map<string, number>()
  let sampled = 0

  for (const [key, [lon, lat]] of uniqueBoundary) {
    sampled += 1
    args.onProgress?.(
      `Sampling elevation ${sampled} of ${uniqueBoundary.size}`,
    )
    const value = await args.fetchElevation(lon, lat)
    boundaryElevations.set(key, value ?? originAlt)
  }

  const zForBoundary = (lon: number, lat: number): number =>
    boundaryElevations.get(`${lon.toFixed(7)},${lat.toFixed(7)}`) ??
    originAlt

  const boundaryLocal = toLocalGeometry(
    parcelGeometry,
    origin,
    zForBoundary,
  ) as Polygon

  const [addressLon, addressLat] = args.address.location
  const addressAlt =
    (await args.fetchElevation(addressLon, addressLat)) ?? originAlt
  const addressLocal = enuFromWgs84(
    addressLon,
    addressLat,
    addressAlt,
    origin,
  )

  let terrainValues = parcelElevations
  if (!terrainValues.length) {
    terrainValues = contours.map((contour) => contour.elevationM)
  }
  if (!terrainValues.length) {
    terrainValues = [...boundaryElevations.values()]
  }

  const elevationRangeM: [number, number] | null = terrainValues.length
    ? [round1(Math.min(...terrainValues)), round1(Math.max(...terrainValues))]
    : null

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    address: {
      query: args.address.query,
      fullAddress: args.address.fullAddress,
      addressId: args.address.addressId,
      suburb: args.address.suburb,
      city: args.address.city,
      location: args.address.location,
      local: addressLocal,
    },
    site: {
      crs: 'EPSG:4326',
      origin,
      boundary: parcelGeometry,
      boundaryLocal,
      areaM2: areaM2(parcel),
      perimeterM: polygonPerimeterM(parcel),
      parcelId: Number(args.parcel.properties.parcel_id ?? 0),
      appellation: String(
        args.parcel.properties.full_app ?? 'Unknown parcel',
      ),
      attributes: { ...args.parcel.properties },
      terrain: {
        elevationM: round1(originAlt),
        elevationRangeM,
        contourCount: contours.length,
        contourSource: args.contourSource,
      },
    },
    buildings,
    contours,
    sources: WCC_SOURCES,
  }
}
