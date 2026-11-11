import type { Feature, FeatureCollection } from 'geojson'
import type { PropertyData, UserAsset } from './types'
import type { MaintenancePlan } from '../knowledge/plan'

export function propertyToGeoJSON(
  property: PropertyData,
  userAssets: UserAsset[] = [],
): FeatureCollection {
  const features: Feature[] = [
    {
      type: 'Feature',
      geometry: property.site.boundary,
      properties: {
        kind: 'parcel',
        parcelId: property.site.parcelId,
        appellation: property.site.appellation,
        areaM2: property.site.areaM2,
        perimeterM: property.site.perimeterM,
      },
    },
    ...property.buildings.map<Feature>((building) => ({
      type: 'Feature',
      geometry: building.geometry,
      properties: {
        kind: 'building',
        id: building.id,
        label: building.label,
        areaM2: building.areaM2,
        withinPropertyM2: building.withinPropertyM2,
        heightM: building.heightM,
        baseElevationM: building.baseElevationM,
      },
    })),
    ...property.contours.map<Feature>((contour) => ({
      type: 'Feature',
      geometry: contour.geometry,
      properties: {
        kind: 'contour',
        elevationM: contour.elevationM,
        layer: contour.layer,
        lengthM: contour.lengthM,
      },
    })),
    ...userAssets.map<Feature>((asset) => ({
      type: 'Feature',
      geometry: asset.geometry,
      properties: {
        kind: `user-${asset.kind}`,
        id: asset.id,
        label: asset.label,
        species: asset.species ?? '',
        notes: asset.notes ?? '',
        source: 'user',
      },
    })),
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: property.address.location,
      },
      properties: {
        kind: 'address',
        fullAddress: property.address.fullAddress,
        addressId: property.address.addressId,
      },
    },
  ]

  return {
    type: 'FeatureCollection',
    features,
  }
}

function slugAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function download(
  filename: string,
  content: string,
  contentType: string,
): void {
  const blob = new Blob([content], { type: contentType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadPropertyJson(
  property: PropertyData,
  userAssets: UserAsset[] = [],
): void {
  download(
    `mygarden-${slugAddress(property.address.fullAddress)}.json`,
    JSON.stringify({ ...property, userAssets }, null, 2),
    'application/json',
  )
}

export function downloadPropertyGeoJSON(
  property: PropertyData,
  userAssets: UserAsset[] = [],
): void {
  download(
    `mygarden-${slugAddress(property.address.fullAddress)}.geojson`,
    JSON.stringify(propertyToGeoJSON(property, userAssets), null, 2),
    'application/geo+json',
  )
}

export function downloadMaintenancePlan(
  plan: MaintenancePlan,
): void {
  download(
    `mygarden-maintenance-plan-${plan.referenceDate}.json`,
    JSON.stringify(plan, null, 2),
    'application/json',
  )
}
