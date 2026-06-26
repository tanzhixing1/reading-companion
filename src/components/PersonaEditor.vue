<template>
  <div class="persona-editor">
    <div class="persona-editor-head">
      <div>
        <h3 class="editor-title">角色设置</h3>
        <p class="editor-desc">切换当前共读角色，新生成的批注会使用当前角色。</p>
      </div>
      <span class="editor-current">当前：{{ editingTitle() }}</span>
    </div>

    <div class="persona-editor-body">
      <aside class="persona-sidebar">
        <div class="persona-sidebar-header">
          <h3 class="section-title">角色卡</h3>
          <button class="create-btn" @click="addPersonaCard">+ 新建角色</button>
        </div>

        <div class="persona-card-list">
          <div
            v-for="card in settings.personaCards"
            :key="card.id"
            class="persona-card-item"
            :class="{ active: card.id === settings.activePersonaId }"
            role="button"
            tabindex="0"
            @click="switchPersona(card.id)"
            @keydown.enter.prevent="switchPersona(card.id)"
            @keydown.space.prevent="switchPersona(card.id)"
          >
            <div class="card-topline">
              <span class="card-name" :title="cardTitle(card)">{{ cardTitle(card) }}</span>
              <span class="card-status" v-if="card.id === settings.activePersonaId">当前</span>
            </div>
            <div class="card-meta">{{ worldBookSummary(card) }}</div>
            <div class="card-actions">
              <button class="text-btn" @click.stop="duplicatePersonaCard(card)">复制</button>
              <button
                class="text-btn danger"
                :disabled="settings.personaCards.length <= 1"
                @click.stop="deletePersonaCard(card)"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main class="persona-main">
        <div class="detail-head">
          <span class="detail-kicker">正在编辑</span>
          <h3 class="detail-title">{{ editingTitle() }}</h3>
          <p class="detail-hint">切换角色前会自动保存当前编辑内容。</p>
        </div>

        <section class="setting-section">
          <h3 class="section-title">角色基础</h3>
          <label class="field">
            <span class="field-label">角色名称</span>
            <input class="field-input" v-model="form.personaName" placeholder="角色名称" />
          </label>
          <label class="field">
            <span class="field-label">角色设定</span>
            <textarea
              class="big-input persona-textarea"
              v-model="form.persona"
              placeholder="角色设定"
              rows="6"
            ></textarea>
          </label>
        </section>

        <section class="setting-section">
          <h3 class="section-title">用户面具</h3>
          <label class="field">
            <span class="field-label">用户称呼</span>
            <input class="field-input" v-model="form.userName" placeholder="用户称呼" />
          </label>
          <label class="field">
            <span class="field-label">用户面具</span>
            <textarea
              class="big-input mask-textarea"
              v-model="form.userMask"
              placeholder="用户身份描述"
              rows="3"
            ></textarea>
          </label>
        </section>

        <section class="setting-section worldbook-section">
          <div class="section-line">
            <h3 class="section-title">世界书</h3>
            <span class="section-note">{{ worldBookSummary(form) }}</span>
          </div>
          <div class="worldbook-list">
            <div v-for="(entry, idx) in form.worldBook" :key="idx" class="wb-entry">
              <div class="wb-header">
                <input class="wb-name" v-model="entry.name" placeholder="条目名称" />
                <label class="wb-toggle">
                  <input type="checkbox" v-model="entry.enabled" />
                  <span>启用</span>
                </label>
                <button class="chapter-del" @click="removeWbEntry(idx)">删除</button>
              </div>
              <textarea class="wb-content" v-model="entry.content" placeholder="条目内容" rows="3"></textarea>
            </div>
          </div>
          <button class="add-btn" @click="addWbEntry">+ 新增条目</button>
        </section>

        <div class="save-row">
          <span class="save-hint">切换角色会自动保存当前编辑内容</span>
          <button class="action-btn primary" @click="save">保存</button>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, toRaw } from 'vue'
import {
  createPersonaCard,
  getPersonaDisplayName,
  getPersonaSettings,
  savePersonaSettings
} from '../services/personaService.js'

const emit = defineEmits(['saved'])

const settings = ref({
  activePersonaId: '',
  personaCards: []
})
const form = ref(createPersonaCard())

onMounted(async () => {
  settings.value = await getPersonaSettings()
  loadActiveCardToForm()
})

function clone(value) {
  return JSON.parse(JSON.stringify(toRaw(value)))
}

function activeCardIndex() {
  return settings.value.personaCards.findIndex(card => card.id === settings.value.activePersonaId)
}

function activeCard() {
  const idx = activeCardIndex()
  return idx >= 0 ? settings.value.personaCards[idx] : settings.value.personaCards[0]
}

function cardTitle(card) {
  if (card.id === settings.value.activePersonaId) return form.value.personaName?.trim() || '未命名角色'
  return getPersonaDisplayName(card)
}

function editingTitle() {
  return form.value.personaName?.trim() || '未命名角色'
}

function worldBookSummary(card) {
  const worldBook = card?.id === settings.value.activePersonaId
    ? form.value.worldBook
    : card?.worldBook
  const count = Array.isArray(worldBook) ? worldBook.length : 0
  return count > 0 ? `世界书 ${count} 条` : '未设置世界书'
}

function loadActiveCardToForm() {
  const card = activeCard() || createPersonaCard()
  form.value = createPersonaCard(clone(card))
}

async function persistSettings() {
  settings.value = await savePersonaSettings(settings.value)
}

async function saveCurrentCard() {
  const idx = activeCardIndex()
  if (idx < 0) return
  settings.value.personaCards[idx] = {
    ...settings.value.personaCards[idx],
    personaName: form.value.personaName || '',
    persona: form.value.persona || '',
    userName: form.value.userName || '',
    userMask: form.value.userMask || '',
    worldBook: clone(form.value.worldBook || []),
    updatedAt: Date.now()
  }
  await persistSettings()
}

async function switchPersona(id) {
  if (id === settings.value.activePersonaId) return
  await saveCurrentCard()
  settings.value.activePersonaId = id
  await persistSettings()
  loadActiveCardToForm()
}

async function addPersonaCard() {
  await saveCurrentCard()
  const card = createPersonaCard({ personaName: `新角色 ${settings.value.personaCards.length + 1}` })
  settings.value.personaCards.push(card)
  settings.value.activePersonaId = card.id
  await persistSettings()
  loadActiveCardToForm()
}

async function duplicatePersonaCard(sourceCard = null) {
  await saveCurrentCard()
  const source = settings.value.personaCards.find(item => item.id === sourceCard?.id) || activeCard() || createPersonaCard()
  const card = createPersonaCard({
    ...clone(source),
    id: undefined,
    personaName: `${getPersonaDisplayName(source)} 副本`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  settings.value.personaCards.push(card)
  settings.value.activePersonaId = card.id
  await persistSettings()
  loadActiveCardToForm()
}

async function deletePersonaCard(targetCard = null) {
  if (settings.value.personaCards.length <= 1) {
    alert('至少保留一张角色卡')
    return
  }
  const card = settings.value.personaCards.find(item => item.id === targetCard?.id) || activeCard()
  if (!card) return
  if (!confirm(`确定删除角色卡「${getPersonaDisplayName(card)}」吗？\n\n不会删除这个角色过去生成的批注。`)) return
  await saveCurrentCard()
  settings.value.personaCards = settings.value.personaCards.filter(item => item.id !== card.id)
  if (!settings.value.personaCards.some(item => item.id === settings.value.activePersonaId)) {
    settings.value.activePersonaId = settings.value.personaCards[0].id
  }
  await persistSettings()
  loadActiveCardToForm()
}

function addWbEntry() {
  if (!Array.isArray(form.value.worldBook)) form.value.worldBook = []
  form.value.worldBook.push({ name: '', content: '', enabled: true })
}

function removeWbEntry(idx) {
  form.value.worldBook.splice(idx, 1)
}

async function save() {
  await saveCurrentCard()
  emit('saved')
}
</script>

<style scoped>
:global(.modal-frame:has(.persona-editor)) {
  width: min(960px, 94vw);
}

:global(.modal-frame:has(.persona-editor) .modal-body) {
  overflow: hidden;
}

.persona-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: calc(85vh - 112px);
  min-height: 0;
}

.persona-editor-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 14px;
  border-bottom: 3px double var(--line-strong);
}

.editor-title {
  font-size: 17px;
  font-weight: normal;
  letter-spacing: 0.2em;
  margin-bottom: 2px;
}

.editor-desc,
.detail-hint,
.save-hint,
.section-note {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-soft);
}

.editor-current {
  max-width: 240px;
  padding: 3px 8px;
  border: 1px solid var(--line);
  background: var(--paper-deep);
  color: var(--accent);
  font-size: 12px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.persona-editor-body {
  display: grid;
  grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
  gap: 20px;
  min-height: 0;
  flex: 1;
}

.persona-sidebar {
  border-right: 1px solid var(--line);
  padding-right: 16px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.persona-sidebar-header,
.save-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.persona-sidebar-header {
  align-items: flex-start;
  flex-direction: column;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}

.persona-card-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-right: 4px;
  overflow-y: auto;
  min-height: 0;
}

.persona-card-item {
  width: 100%;
  display: block;
  padding: 9px 10px 8px;
  border: 1px solid var(--line);
  color: var(--ink);
  text-align: left;
  background: rgba(244, 241, 235, 0.5);
  transition: border-color 0.2s, background 0.2s, color 0.2s;
}

.persona-card-item:hover,
.persona-card-item:focus-visible {
  border-color: var(--line-strong);
  background: var(--paper-deep);
  outline: none;
}

.persona-card-item.active {
  border-color: var(--line-strong);
  background: var(--paper-deep);
  box-shadow: inset 3px 0 0 var(--accent);
}

.card-topline,
.card-actions,
.section-line,
.wb-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-topline {
  justify-content: space-between;
}

.card-name {
  min-width: 0;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.6;
}

.card-status {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--line-strong);
  color: var(--accent);
  background: var(--paper);
  font-size: 11px;
  line-height: 1.4;
}

.card-meta {
  margin-top: 2px;
  color: var(--ink-soft);
  font-size: 11px;
  line-height: 1.5;
}

.card-actions {
  justify-content: flex-end;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(139, 115, 85, 0.18);
}

.create-btn,
.text-btn {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-soft);
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}

.create-btn {
  width: 100%;
  padding: 5px 10px;
  border: 1px solid var(--line);
  background: var(--paper);
  text-align: center;
}

.text-btn {
  padding: 1px 6px;
  border: 1px solid transparent;
}

.create-btn:hover,
.text-btn:hover {
  border-color: var(--line-strong);
  background: var(--paper);
  color: var(--accent);
}

.text-btn.danger {
  color: var(--ink-soft);
}

.text-btn.danger:hover {
  color: var(--close-hover);
  border-color: rgba(140, 59, 46, 0.35);
}

.text-btn:disabled,
.text-btn:disabled:hover {
  cursor: not-allowed;
  opacity: 0.35;
  color: var(--ink-soft);
  border-color: transparent;
  background: transparent;
}

.persona-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.detail-head {
  padding: 2px 0 12px;
  border-bottom: 1px solid var(--line);
}

.detail-kicker {
  display: block;
  color: var(--ink-soft);
  font-size: 11px;
  line-height: 1.5;
}

.detail-title {
  max-width: 100%;
  margin-top: 2px;
  font-size: 18px;
  font-weight: normal;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setting-section {
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.detail-head + .setting-section {
  border-top: 0;
  padding-top: 0;
}

.section-title {
  font-size: 14px;
  font-weight: normal;
  letter-spacing: 0.16em;
  margin-bottom: 10px;
}

.section-line {
  justify-content: space-between;
  margin-bottom: 10px;
}

.section-line .section-title {
  margin-bottom: 0;
}

.field {
  display: grid;
  grid-template-columns: 78px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  margin-top: 10px;
}

.field-label {
  padding-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-soft);
}

.field-input {
  width: 100%;
  font-family: inherit;
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
}

.field-input:focus {
  outline: none;
  border-color: var(--accent);
}

.big-input {
  width: 100%;
  min-width: 0;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.8;
  padding: 10px 12px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  resize: vertical;
}

.persona-textarea {
  min-height: 132px;
  max-height: 260px;
  overflow-y: auto;
}

.mask-textarea {
  min-height: 86px;
  max-height: 180px;
  overflow-y: auto;
}

.big-input:focus {
  outline: none;
  border-color: var(--accent);
}

.worldbook-section {
  min-height: 0;
}

.worldbook-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wb-entry {
  border: 1px solid var(--line);
  padding: 10px;
  background: rgba(244, 241, 235, 0.45);
}

.wb-header {
  margin-bottom: 6px;
}

.wb-name {
  flex: 1;
  min-width: 0;
  font-family: inherit;
  font-size: 13px;
  border: none;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  padding: 2px 4px;
}

.wb-name:focus {
  outline: none;
  border-color: var(--accent);
}

.wb-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-soft);
}

.wb-toggle input {
  accent-color: var(--accent);
}

.wb-content {
  width: 100%;
  min-height: 78px;
  max-height: 180px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.7;
  padding: 6px 8px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  resize: vertical;
  overflow-y: auto;
}

.wb-content:focus {
  outline: none;
  border-color: var(--accent);
}

.add-btn {
  font-size: 12px;
  margin-top: 10px;
  padding: 5px 12px;
  border: 1px dashed var(--line);
  color: var(--ink-soft);
}

.add-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--paper-deep);
}

.chapter-del {
  font-size: 12px;
  color: var(--ink-soft);
  padding: 2px 6px;
  border: 1px solid transparent;
  transition: color 0.2s, border-color 0.2s;
}

.chapter-del:hover {
  color: var(--close-hover);
  border-color: rgba(140, 59, 46, 0.35);
}

.save-row {
  justify-content: flex-end;
  position: sticky;
  bottom: 0;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  background: var(--paper);
}

.save-hint {
  margin-right: auto;
}

.action-btn {
  font-size: 13px;
  padding: 6px 18px;
  border: 1px solid var(--line-strong);
  letter-spacing: 0.1em;
}

.action-btn:hover {
  background: var(--paper-deep);
}

.action-btn.primary {
  background: var(--line-strong);
  color: var(--paper);
}

.action-btn.primary:hover {
  background: var(--ink);
}

@media (max-width: 760px) {
  :global(.modal-frame:has(.persona-editor)) {
    width: min(94vw, 720px);
  }

  .persona-editor {
    max-height: calc(85vh - 96px);
  }

  .persona-editor-head {
    flex-direction: column;
    gap: 8px;
  }

  .editor-current {
    max-width: 100%;
  }

  .persona-editor-body {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .persona-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--line);
    padding-right: 0;
    padding-bottom: 14px;
    max-height: 240px;
  }

  .persona-main {
    overflow-y: visible;
    padding-right: 0;
  }

  .field {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .field-label {
    padding-top: 0;
  }
}
</style>
