import { getSetting, setSetting } from '../db/database.js'

const DEFAULT_PERSONA_NAME = '未命名角色'

export function createPersonaId() {
  return `persona-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function cloneWorldBook(worldBook) {
  return Array.isArray(worldBook)
    ? worldBook.map(entry => ({
        name: entry?.name || '',
        content: entry?.content || '',
        enabled: entry?.enabled !== false
      }))
    : []
}

export function createPersonaCard(overrides = {}) {
  const now = Date.now()
  return {
    id: overrides.id || createPersonaId(),
    personaName: overrides.personaName || '',
    persona: overrides.persona || '',
    userName: overrides.userName || '',
    userMask: overrides.userMask || '',
    worldBook: cloneWorldBook(overrides.worldBook),
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now
  }
}

export function getPersonaDisplayName(persona, fallback = DEFAULT_PERSONA_NAME) {
  return persona?.personaName?.trim() || fallback
}

export function normalizePersonaSettings(raw = null) {
  const source = raw && typeof raw === 'object' ? raw : {}
  let cards = []

  if (Array.isArray(source.personaCards) && source.personaCards.length) {
    cards = source.personaCards.map(card => createPersonaCard(card))
  } else {
    cards = [createPersonaCard({
      personaName: source.personaName || '',
      persona: source.persona || '',
      userName: source.userName || '',
      userMask: source.userMask || '',
      worldBook: cloneWorldBook(source.worldBook)
    })]
  }

  let activePersonaId = source.activePersonaId
  if (!cards.some(card => card.id === activePersonaId)) activePersonaId = cards[0].id
  const activeCard = cards.find(card => card.id === activePersonaId) || cards[0]

  return {
    ...source,
    activePersonaId,
    personaCards: cards,
    personaName: activeCard.personaName || '',
    persona: activeCard.persona || '',
    userName: activeCard.userName || '',
    userMask: activeCard.userMask || '',
    worldBook: cloneWorldBook(activeCard.worldBook)
  }
}

export async function getPersonaSettings() {
  const raw = await getSetting('personaSettings')
  const normalized = normalizePersonaSettings(raw)
  if (JSON.stringify(raw || null) !== JSON.stringify(normalized)) {
    await setSetting('personaSettings', normalized)
  }
  return normalized
}

export async function savePersonaSettings(settings) {
  const normalized = normalizePersonaSettings(settings)
  await setSetting('personaSettings', normalized)
  return normalized
}

export async function getActivePersona() {
  const settings = await getPersonaSettings()
  return settings.personaCards.find(card => card.id === settings.activePersonaId) || settings.personaCards[0]
}
