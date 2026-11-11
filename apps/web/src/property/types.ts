import type { Feature, LineString, Point, Polygon, Position } from 'geojson'

export type LonLat = [number, number]
export type LocalPosition = [number, number, number]

export interface ResolvedAddress {
  fullAddress: string
  addressId: number
  suburb: string
  city: string
  location: LonLat
}

export interface AddressInfo extends ResolvedAddress {
  query: string
  local: LocalPosition
}

export interface DataSource {
  name: string
  url: string
  attribution: string
  note?: string
}

export interface TerrainInfo {
  elevationM: number
  elevationRangeM: [number, number] | null
  contourCount: number
  contourSource: string
}

export interface BuildingAsset {
  id: string
  kind: 'building'
  label: string
  geometry: Polygon
  geometryLocal: Polygon
  baseElevationM: number
  heightM: number
  areaM2: number
  withinPropertyM2: number
  attributes: {
    objectId?: number
    status?: string
    exceptionCode?: number
    buildingSpatialId?: number
    baseElevation?: number
    approximateHeight?: number
    lastEditedAt?: string
  }
}

export interface ContourSegment {
  id: string
  elevationM: number
  layer: string
  geometry: LineString
  geometryLocal: LineString
  lengthM: number
}

export type UserAssetKind = 'tree' | 'lawn' | 'bush' | 'area'
export type EditTool = 'pan' | 'select' | UserAssetKind

export interface UserAsset {
  id: string
  kind: UserAssetKind
  label: string
  species?: string
  notes?: string
  radiusM?: number
  geometry: Point | Polygon
  geometryLocal: Point | Polygon
  createdAt: string
  updatedAt: string
}

export interface PropertyData {
  schemaVersion: 1
  generatedAt: string
  address: AddressInfo
  site: {
    crs: 'EPSG:4326'
    origin: {
      lon: number
      lat: number
      altM: number
    }
    boundary: Polygon
    boundaryLocal: Polygon
    areaM2: number
    perimeterM: number
    parcelId: number
    appellation: string
    attributes: Record<string, unknown>
    terrain: TerrainInfo
  }
  buildings: BuildingAsset[]
  contours: ContourSegment[]
  sources: DataSource[]
}

export interface WccAddressProperties {
  address_id: number
  full_address: string
  suburb_locality: string
  town_city: string
  address_lifecycle: string
}

export interface WccParcelProperties {
  OBJECTID?: number
  parcel_id?: number
  full_app?: string
  surv_area?: number
  Shape_Area?: number
  wufi?: number
  [key: string]: unknown
}

export interface WccBuildingProperties {
  OBJECTID_1?: number
  Status?: string
  Excep_code?: number
  base_elev?: number
  approx_hei?: number
  Last_Edit_?: number
  Building_Spatial_ID_1?: number
  [key: string]: unknown
}

export interface WccContourProperties {
  ELEVATION: number
  LAYER: string
  OBJECTID?: number
  [key: string]: unknown
}

export type WccAddressFeature = Feature<Point, WccAddressProperties> & {
  geometry: { type: 'Point'; coordinates: Position }
}

export type WccParcelFeature = Feature<Polygon, WccParcelProperties>
export type WccBuildingFeature = Feature<Polygon, WccBuildingProperties>
export type WccContourFeature = Feature<LineString, WccContourProperties>
