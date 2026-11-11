import type { FeatureCollection, Geometry } from 'geojson'
import type {
  DataSource,
  ResolvedAddress,
  WccAddressFeature,
  WccAddressProperties,
  WccBuildingFeature,
  WccBuildingProperties,
  WccContourFeature,
  WccContourProperties,
  WccParcelFeature,
  WccParcelProperties,
} from './types'

const WCC_BASE = 'https://gis.wcc.govt.nz/arcgis/rest/services'

const ELEVATION_CACHE = new Map<string, number | null>()

export const WCC_SOURCES: DataSource[] = [
  {
    name: 'Wellington City Council Address (LINZ)',
    url: `${WCC_BASE}/PropertyAndBoundaries/Address/MapServer`,
    attribution: 'Wellington City Council, Land Information New Zealand',
  },
  {
    name: 'Wellington City Council Parcels (LINZ)',
    url: `${WCC_BASE}/PropertyAndBoundaries/Parcels/MapServer`,
    attribution: 'Wellington City Council, Land Information New Zealand',
  },
  {
    name: 'Wellington City Council Building Footprints',
    url: `${WCC_BASE}/PropertyAndBoundaries/BuildingFootprints/MapServer`,
    attribution: 'Wellington City Council',
  },
  {
    name: 'Wellington City Council Contours 2020',
    url: `${WCC_BASE}/Elevation/Contours2020/MapServer`,
    attribution: 'Wellington City Council',
  },
  {
    name: 'Wellington City Council Aerial Imagery 2021',
    url: `${WCC_BASE}/Cache/Imagery2021/MapServer`,
    attribution: 'Wellington City Council, AAM',
  },
  {
    name: 'Wellington City Council 1 m DEM 2020',
    url: `${WCC_BASE}/Elevation/DigitalElevation1Metre_WGS84_2020/ImageServer`,
    attribution: 'Wellington City Council',
  },
  {
    name: 'Wellington City Council open data terms',
    url:
      'https://wellington.govt.nz/wellington-city/maps/open-data-portal-terms-and-conditions/gis-data',
    attribution: 'Wellington City Council',
  },
]

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}

async function queryGeoJson<P>(
  service: string,
  layer: number,
  params: Record<string, string>,
): Promise<FeatureCollection<Geometry, P>> {
  const url = new URL(`${WCC_BASE}/${service}/MapServer/${layer}/query`)
  url.search = new URLSearchParams({ ...params, f: 'geojson' }).toString()

  const response = await fetch(url, {
    headers: {
      Accept: 'application/geo+json, application/json',
    },
  })

  if (!response.ok) {
    throw new Error(
      `Wellington City Council request failed (${response.status} ${response.statusText}).`,
    )
  }

  const data = (await response.json()) as {
    error?: { message?: string }
  } & FeatureCollection<Geometry, P>

  if (data.error) {
    throw new Error(
      `Wellington City Council error: ${data.error.message ?? 'unknown error'}`,
    )
  }

  return data
}

function envelope(bbox: [number, number, number, number]): string {
  const [minLon, minLat, maxLon, maxLat] = bbox
  return JSON.stringify({
    xmin: minLon,
    ymin: minLat,
    xmax: maxLon,
    ymax: maxLat,
    spatialReference: { wkid: 4326 },
  })
}

export async function fetchAddress(query: string): Promise<ResolvedAddress> {
  const trimmed = query.trim()
  if (!trimmed) throw new Error('Enter an address to initialise the property.')

  const baseParams = {
    outFields:
      'address_id,full_address,suburb_locality,town_city,address_lifecycle',
    returnGeometry: 'true',
    outSR: '4326',
  }

  let data = await queryGeoJson<WccAddressProperties>(
    'PropertyAndBoundaries/Address',
    0,
    {
      ...baseParams,
      where: `full_address LIKE '${escapeSql(trimmed)}%'`,
    },
  )

  if (!data.features.length) {
    const firstPart = trimmed.split(',')[0]?.trim() ?? trimmed
    data = await queryGeoJson<WccAddressProperties>(
      'PropertyAndBoundaries/Address',
      0,
      {
        ...baseParams,
        where: `full_address LIKE '${escapeSql(firstPart)}%'`,
      },
    )
  }

  const features = data.features as WccAddressFeature[]
  if (!features.length) {
    throw new Error(
      `No Wellington City Council address found for "${trimmed}". Try a more specific address.`,
    )
  }

  const feature =
    features.find(
      (candidate) => candidate.properties.address_lifecycle === 'Current',
    ) ?? features[0]

  const [lon, lat] = feature.geometry.coordinates

  return {
    fullAddress: feature.properties.full_address,
    addressId: feature.properties.address_id,
    suburb: feature.properties.suburb_locality,
    city: feature.properties.town_city,
    location: [lon, lat],
  }
}

export async function fetchParcel(
  lon: number,
  lat: number,
): Promise<WccParcelFeature> {
  const data = await queryGeoJson<WccParcelProperties>(
    'PropertyAndBoundaries/Parcels',
    1,
    {
      geometry: JSON.stringify({
        x: lon,
        y: lat,
        spatialReference: { wkid: 4326 },
      }),
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
    },
  )

  const feature = data.features[0] as WccParcelFeature | undefined
  if (!feature) {
    throw new Error('No Wellington City Council parcel found at this address.')
  }

  return feature
}

export async function fetchBuildings(
  bbox: [number, number, number, number],
): Promise<WccBuildingFeature[]> {
  const data = await queryGeoJson<WccBuildingProperties>(
    'PropertyAndBoundaries/BuildingFootprints',
    0,
    {
      geometry: envelope(bbox),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
    },
  )

  return data.features as WccBuildingFeature[]
}

export async function fetchContours(
  bbox: [number, number, number, number],
  layer: number,
): Promise<WccContourFeature[]> {
  const data = await queryGeoJson<WccContourProperties>(
    'Elevation/Contours2020',
    layer,
    {
      geometry: envelope(bbox),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ELEVATION,LAYER,OBJECTID',
      returnGeometry: 'true',
      outSR: '4326',
    },
  )

  return data.features as WccContourFeature[]
}

export async function fetchElevation(
  lon: number,
  lat: number,
): Promise<number | null> {
  const key = `${lon.toFixed(7)},${lat.toFixed(7)}`
  if (ELEVATION_CACHE.has(key)) {
    return ELEVATION_CACHE.get(key) ?? null
  }

  const url = new URL(
    `${WCC_BASE}/Elevation/DigitalElevation1Metre_WGS84_2020/ImageServer/identify`,
  )
  url.search = new URLSearchParams({
    geometry: JSON.stringify({
      x: lon,
      y: lat,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryPoint',
    returnCatalogItems: 'false',
    returnGeometry: 'false',
    f: 'json',
  }).toString()

  let result: number | null = null

  try {
    const response = await fetch(url)
    if (response.ok) {
      const data = (await response.json()) as {
        value?: string
        error?: unknown
      }
      if (!data.error && data.value != null) {
        const value = Number(data.value)
        if (Number.isFinite(value) && value > -1000) {
          result = value
        }
      }
    }
  } catch {
    result = null
  }

  ELEVATION_CACHE.set(key, result)
  return result
}

export function wccImageryUrl(
  bbox: [number, number, number, number],
  size = 1024,
): string {
  const url = new URL(
    `${WCC_BASE}/Cache/Imagery2021/MapServer/export`,
  )
  url.search = new URLSearchParams({
    bbox: bbox.join(','),
    bboxSR: '4326',
    imageSR: '4326',
    size: `${size},${size}`,
    format: 'jpg',
    f: 'image',
  }).toString()
  return url.toString()
}
