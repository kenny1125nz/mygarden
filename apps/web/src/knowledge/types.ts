import type { UserAssetKind } from '../property/types'

export type CareCategory =
  | 'tree'
  | 'shrub'
  | 'hedge'
  | 'citrus'
  | 'fruit'
  | 'lawn'
  | 'vegetable'
  | 'hardscape'
  | 'generic'

export type CarePriority = 1 | 2 | 3 | 4 | 5

export type CareCadence =
  | { type: 'once' }
  | { type: 'monthly' }
  | { type: 'weekly' }
  | { type: 'fortnightly' }
  | { type: 'interval'; intervalDays: number }
  | { type: 'per_month' }
  | { type: 'as_needed' }

export interface CareWeatherTrigger {
  avoidRain?: boolean
  avoidFrost?: boolean
  avoidWetSoil?: boolean
  maxWindKmh?: number
}

export interface CareTask {
  id: string
  kind: 'inspection' | 'care'
  title: string
  description: string
  rationale: string
  months: number[]
  frequency: string
  cadence: CareCadence
  priority: CarePriority
  effortMinutes: number
  weatherSensitive?: boolean
  weather?: CareWeatherTrigger
  conditions?: string
  dependsOn?: string[]
}

export interface CareProfile {
  id: string
  name: string
  category: CareCategory
  match: {
    species?: string[]
    labels?: string[]
    kinds?: UserAssetKind[]
  }
  summary: string
  watchFor: string[]
  tasks: CareTask[]
  notes?: string
}

export interface CareKnowledgeMetadata {
  region: string
  hemisphere: 'southern' | 'northern'
  climate: string
  lastReviewed: string
  reviewStatus: string
  assumptions: string[]
}

export interface AssetCarePlan {
  assetId: string
  assetLabel: string
  assetKind: UserAssetKind
  species?: string
  profileId: string
  profileName: string
  category: CareCategory
  summary: string
  watchFor: string[]
  tasks: CareTask[]
  matchedBy: 'label' | 'species' | 'kind'
  notes?: string
}

export interface CareProfileGroup {
  profileId: string
  profileName: string
  category: CareCategory
  summary: string
  watchFor: string[]
  tasks: CareTask[]
  assets: string[]
  notes?: string
}
