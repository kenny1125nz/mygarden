import type { Point, Polygon } from 'geojson'
import type { UserAsset } from './types'

const KEY_PREFIX = 'mygarden.edits.v1.'

interface StoredUserAssets {
  schemaVersion: 1
  assets: UserAsset[]
}

export function userAssetStorageKey(parcelId: number): string {
  return `${KEY_PREFIX}${parcelId}`
}

export function loadUserAssets(parcelId: number): UserAsset[] {
  try {
    const raw = localStorage.getItem(userAssetStorageKey(parcelId))
    if (!raw) return []

    const parsed = JSON.parse(raw) as Partial<StoredUserAssets>
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.assets)) {
      return []
    }

    return parsed.assets
  } catch {
    return []
  }
}

export function saveUserAssets(
  parcelId: number,
  assets: UserAsset[],
): void {
  try {
    const payload: StoredUserAssets = {
      schemaVersion: 1,
      assets,
    }
    localStorage.setItem(
      userAssetStorageKey(parcelId),
      JSON.stringify(payload),
    )
  } catch {
    // Storage can be unavailable; the in-memory session still works.
  }
}

export function createUserId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `asset-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function isPolygonGeometry(
  geometry: Point | Polygon,
): geometry is Polygon {
  return geometry.type === 'Polygon'
}
