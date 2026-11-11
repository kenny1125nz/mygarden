import type { UserAsset } from '../property/types'
import type {
  AssetCarePlan,
  CareProfile,
  CareProfileGroup,
} from './types'
import { WELLINGTON_CARE_PROFILES } from './wellington'

export type MatchSource = 'label' | 'species' | 'kind'

export interface ProfileMatch {
  profile: CareProfile
  matchedBy: MatchSource
  score: number
}

export function normalizeKnowledgeText(
  value: string | null | undefined,
): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function scoreLabel(
  label: string,
  keywords: string[] | undefined,
): number {
  let best = 0

  for (const keyword of keywords ?? []) {
    const normalized = normalizeKnowledgeText(keyword)
    if (!normalized) continue

    if (label === normalized) {
      best = Math.max(best, 200 + normalized.length)
    } else if (label.includes(normalized)) {
      best = Math.max(best, 100 + normalized.length)
    }
  }

  return best
}

function scoreSpecies(
  species: string,
  keywords: string[] | undefined,
): number {
  let best = 0
  if (!species) return best

  for (const keyword of keywords ?? []) {
    const normalized = normalizeKnowledgeText(keyword)
    if (!normalized) continue

    if (species === normalized) {
      best = Math.max(best, 100 + normalized.length)
    } else if (species.includes(normalized)) {
      best = Math.max(best, 80 + normalized.length)
    }
  }

  return best
}

export function matchCareProfile(asset: UserAsset): ProfileMatch {
  const label = normalizeKnowledgeText(asset.label)
  const species = normalizeKnowledgeText(asset.species)
  let best: ProfileMatch | null = null

  for (const profile of WELLINGTON_CARE_PROFILES) {
    const labelScore = scoreLabel(label, profile.match.labels)
    const speciesScore = scoreSpecies(
      species,
      profile.match.species,
    )
    const kindScore =
      profile.match.kinds?.includes(asset.kind) ? 10 : 0
    const score = Math.max(labelScore, speciesScore, kindScore)

    if (score <= 0) continue

    const matchedBy: MatchSource =
      labelScore === score
        ? 'label'
        : speciesScore === score
          ? 'species'
          : 'kind'

    if (!best || score > best.score) {
      best = { profile, matchedBy, score }
    }
  }

  if (best) return best

  const fallback = WELLINGTON_CARE_PROFILES.find(
    (profile) => profile.id === 'generic-tree',
  )

  if (!fallback) {
    throw new Error('Care knowledge base is missing a fallback profile.')
  }

  return { profile: fallback, matchedBy: 'kind', score: 0 }
}

export function buildAssetCarePlans(
  assets: UserAsset[],
): AssetCarePlan[] {
  return assets.map((asset) => {
    const match = matchCareProfile(asset)

    return {
      assetId: asset.id,
      assetLabel: asset.label,
      assetKind: asset.kind,
      species: asset.species,
      profileId: match.profile.id,
      profileName: match.profile.name,
      category: match.profile.category,
      summary: match.profile.summary,
      watchFor: match.profile.watchFor,
      tasks: match.profile.tasks,
      matchedBy: match.matchedBy,
      notes: match.profile.notes,
    }
  })
}

export function groupCarePlansByProfile(
  plans: AssetCarePlan[],
): CareProfileGroup[] {
  const groups = new Map<string, CareProfileGroup>()

  for (const plan of plans) {
    const existing = groups.get(plan.profileId)

    if (existing) {
      existing.assets.push(plan.assetLabel)
      continue
    }

    groups.set(plan.profileId, {
      profileId: plan.profileId,
      profileName: plan.profileName,
      category: plan.category,
      summary: plan.summary,
      watchFor: plan.watchFor,
      tasks: plan.tasks,
      assets: [plan.assetLabel],
      notes: plan.notes,
    })
  }

  return [...groups.values()]
}
