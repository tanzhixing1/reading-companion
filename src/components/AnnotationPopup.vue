<template>
  <div class="popup-wrapper">
    <div class="popup-frame" ref="popupEl" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
      <header class="popup-header" @mousedown="startDrag">
        <span class="popup-title">¶{{ annotation.paragraphIndex + 1 }} 批注讨论</span>
        <button class="popup-close" @click="$emit('close')">✕</button>
      </header>

      <div class="popup-annotation">
        <span class="ann-label">{{ annotationAuthor }} 的批注：</span>
        <p class="ann-content">{{ annotation.content }}</p>
      </div>

      <hr class="rule-thin" />

      <div class="popup-chat" ref="chatBox">
        <div class="chat-msg" v-for="(msg, idx) in discussion" :key="idx" :class="msg.role">
          <div class="msg-meta">
            <span class="msg-role">{{ getMessageAuthor(msg) }}</span>
            <span class="msg-actions" v-if="editingIdx !== idx">
              <button class="act-btn" @click="startEditMsg(idx)" title="编辑">✎</button>
              <button class="act-btn" @click="deleteMsg(idx)" title="删除">✕</button>
            </span>
          </div>
          <div v-if="editingIdx === idx" class="msg-edit-box">
            <textarea class="msg-edit-input" v-model="editMsgText" rows="2"></textarea>
            <div class="msg-edit-actions">
              <button class="action-btn" @click="cancelEditMsg">取消</button>
              <button class="action-btn primary" @click="confirmEditMsg(idx)">保存</button>
            </div>
          </div>
          <p v-else class="msg-text">{{ msg.content }}</p>
        </div>

        <div v-if="replying && streamingReply" class="chat-msg assistant">
          <span class="msg-role">{{ characterName }}</span>
          <p class="msg-text">{{ streamingReply }}<span class="cursor-blink">|</span></p>
        </div>
        <div v-else-if="replying" class="chat-msg assistant">
          <span class="msg-role">{{ characterName }}</span>
          <p class="msg-text msg-loading">……</p>
        </div>
      </div>

      <div class="popup-input-row">
        <input class="popup-input" v-model="userInput" placeholder="就这条批注聊点什么…"
          @keydown.enter="sendMessage" :disabled="replying" />
        <button class="send-btn" @click="sendMessage" :disabled="replying || !userInput.trim()">发送</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, reactive, computed } from 'vue'
import { db, getSetting } from '../db/database.js'
import { streamChat } from '../services/llmApi.js'
import { getPreviousMemories } from '../services/memoryService.js'
import { getActivePersona, getPersonaDisplayName } from '../services/personaService.js'

const props = defineProps({
  annotation: Object, paragraphText: String,
  book: Object, chapter: Object, allParagraphs: Array
})
const emit = defineEmits(['close', 'updated'])

const discussion = ref([])
const userInput = ref('')
const replying = ref(false)
const streamingReply = ref('')
const chatBox = ref(null)
const popupEl = ref(null)
const characterName = ref('角色')
const userName = ref('你')
const activePersona = ref(null)
const annotationAuthor = computed(() => {
  if (props.annotation?.personaName?.trim()) return props.annotation.personaName
  if (props.annotation?.personaId) return '已删除角色'
  return '旧批注'
})
const pos = reactive({ x: 0, y: 0 })
let dragging = false
let dragOffset = { x: 0, y: 0 }
const editingIdx = ref(-1)
const editMsgText = ref('')

onMounted(async () => {
  await nextTick()
  if (popupEl.value) {
    const rect = popupEl.value.getBoundingClientRect()
    pos.x = Math.max(60, (window.innerWidth - rect.width) / 2)
    pos.y = Math.max(40, (window.innerHeight - rect.height) / 2)
  }
  const persona = await getActivePersona()
  activePersona.value = persona
  characterName.value = getPersonaDisplayName(persona)
  if (persona?.userName) userName.value = persona.userName
  if (props.annotation.dbId) {
    const record = await db.annotations.get(props.annotation.dbId)
    if (record?.discussion) discussion.value = [...record.discussion]
  }
  scrollChat()
})

function startDrag(e) {
  dragging = true; dragOffset.x = e.clientX - pos.x; dragOffset.y = e.clientY - pos.y
  const onMove = (ev) => { if (!dragging) return; pos.x = ev.clientX - dragOffset.x; pos.y = ev.clientY - dragOffset.y }
  const onUp = () => { dragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
}

function startEditMsg(idx) { editingIdx.value = idx; editMsgText.value = discussion.value[idx].content }
function cancelEditMsg() { editingIdx.value = -1; editMsgText.value = '' }
function getMessageAuthor(msg) {
  if (msg.role === 'user') return userName.value
  return msg.personaName || characterName.value
}
async function confirmEditMsg(idx) {
  const t = editMsgText.value.trim(); if (!t) return
  discussion.value[idx].content = t; await saveDiscussion(); cancelEditMsg()
}
async function deleteMsg(idx) {
  if (!confirm('确定删除这条消息？')) return
  discussion.value.splice(idx, 1); await saveDiscussion()
}

async function sendMessage() {
  const text = userInput.value.trim()
  if (!text || replying.value) return
  discussion.value.push({ role: 'user', content: text })
  userInput.value = ''; replying.value = true; streamingReply.value = ''
  await nextTick(); scrollChat()

  try {
    const settings = await getSetting('appSettings')
    const persona = await getActivePersona()
    activePersona.value = persona
    characterName.value = getPersonaDisplayName(persona)
    if (persona?.userName) userName.value = persona.userName
    const messages = await buildMessages(settings, persona)
    const config = { 
      baseURL: settings.baseURL, apiKey: settings.apiKey, 
      model: settings.model, temperature: 0.7, maxTokens: 2048,
      streamSpeed: settings.streamSpeed || 'normal'
    }
    await streamChat(config, messages, chunk => { streamingReply.value += chunk; scrollChat() })
    discussion.value.push({
      role: 'assistant',
      content: streamingReply.value,
      personaId: persona.id,
      personaName: getPersonaDisplayName(persona)
    })
    await saveDiscussion()
  } catch (e) {
    if (e.name !== 'AbortError') discussion.value.push({ role: 'assistant', content: `[错误] ${e.message}` })
  } finally { replying.value = false; streamingReply.value = '' }
}

async function buildMessages(settings, persona) {
  const messages = []
  if (persona?.worldBook) {
    const enabled = persona.worldBook.filter(e => e.enabled && e.content.trim())
    if (enabled.length) messages.push({ role: 'system', content: enabled.map(e => e.content).join('\n\n') })
  }
  const contextRange = settings?.contextRange || 'nearby'
  if (contextRange === 'chapter+memory' && props.chapter) {
    const prevMemories = await getPreviousMemories(props.book.id, props.chapter.order)
    if (prevMemories) messages.push({ role: 'system', content: prevMemories })
  }
  let sys = ''
  if (persona?.persona) sys += persona.persona + '\n\n'
  if (persona?.userMask) sys += `[关于用户] ${persona.userMask}\n\n`
  sys += `你正在阅读《${props.book.title}》「${props.chapter.title}」。`
  sys += `用户想就你的一条批注和你聊聊。请以角色身份自然地回应，不需要对角色进行动作描写，用角色的口吻回复。\n\n`
  if (contextRange === 'nearby') {
    const idx = props.annotation.paragraphIndex
    const paras = props.allParagraphs || []
    const start = Math.max(0, idx - 1); const end = Math.min(paras.length, idx + 2)
    sys += `[相关原文]\n${paras.slice(start, end).map((p, i) => `[${start + i}] ${p}`).join('\n')}\n\n`
  } else if (contextRange === 'chapter' || contextRange === 'chapter+memory') {
    sys += `[本章原文]\n${(props.allParagraphs || []).map((p, i) => `[${i}] ${p}`).join('\n')}\n\n`
  }
  sys += `[你的批注（针对第 ${props.annotation.paragraphIndex + 1} 段）]\n${props.annotation.content}`
  messages.push({ role: 'system', content: sys })
  for (const msg of discussion.value) messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content })
  return messages
}

async function saveDiscussion() {
  if (!props.annotation.dbId) return
  await db.annotations.update(props.annotation.dbId, {
    discussion: discussion.value.map(m => ({
      role: m.role,
      content: m.content,
      personaId: m.personaId || '',
      personaName: m.personaName || ''
    }))
  })
  emit('updated')
}

function scrollChat() { setTimeout(() => { if (chatBox.value) chatBox.value.scrollTop = chatBox.value.scrollHeight }, 0) }
</script>

<style scoped>
.popup-wrapper { position: fixed; inset: 0; z-index: 150; pointer-events: none; }
.popup-frame {
  position: absolute; pointer-events: all; background: var(--paper);
  width: min(480px, 88vw); max-height: 70vh; display: flex; flex-direction: column;
  border: 1px solid var(--line-strong); outline: 2px double var(--line-strong); outline-offset: 2px;
  box-shadow: 4px 4px 0 rgba(47, 42, 34, 0.12);
}
.popup-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--line);
  background: var(--paper-deep); cursor: grab; user-select: none;
}
.popup-header:active { cursor: grabbing; }
.popup-title { font-size: 13px; letter-spacing: 0.15em; }
.popup-close { font-size: 14px; color: var(--ink-soft); transition: color 0.2s; }
.popup-close:hover { color: var(--close-hover); }
.popup-annotation { padding: 10px 16px; }
.ann-label { font-size: 11px; color: var(--accent); }
.ann-content { font-size: 13px; line-height: 1.7; margin-top: 2px; }
.popup-chat {
  flex: 1; overflow-y: auto; padding: 12px 16px;
  display: flex; flex-direction: column; gap: 10px; min-height: 80px;
}
.chat-msg { max-width: 85%; }
.chat-msg.user { align-self: flex-end; text-align: right; }
.chat-msg.assistant { align-self: flex-start; }
.msg-meta { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
.chat-msg.user .msg-meta { flex-direction: row-reverse; }
.msg-role { font-size: 10px; color: var(--ink-soft); letter-spacing: 0.1em; }
.msg-actions { display: flex; gap: 2px; }
.act-btn { font-size: 11px; color: var(--ink-soft); padding: 1px 4px; opacity: 0.4; transition: opacity 0.2s; }
.act-btn:hover { opacity: 1; color: var(--accent); }
.msg-text { font-size: 13px; line-height: 1.7; margin-top: 2px; padding: 6px 10px; border: 1px solid var(--line); }
.chat-msg.user .msg-text { border-color: var(--line); background: var(--paper-deep); }
.chat-msg.assistant .msg-text { border-color: var(--accent); }
.msg-loading { color: var(--ink-soft); font-style: italic; }
.msg-edit-box { margin-top: 4px; }
.msg-edit-input { width: 100%; font-family: inherit; font-size: 12px; line-height: 1.6; padding: 5px 8px; border: 1px solid var(--accent); background: var(--paper); color: var(--ink); resize: vertical; }
.msg-edit-input:focus { outline: none; }
.msg-edit-actions { display: flex; gap: 6px; margin-top: 4px; justify-content: flex-end; }
.action-btn { font-size: 11px; padding: 3px 10px; border: 1px solid var(--line-strong); letter-spacing: 0.05em; }
.action-btn:hover { background: var(--paper-deep); }
.action-btn.primary { background: var(--line-strong); color: var(--paper); }
.action-btn.primary:hover { background: var(--ink); }
.cursor-blink { animation: blink 0.8s step-end infinite; color: var(--accent); }
@keyframes blink { 50% { opacity: 0; } }
.popup-input-row { display: flex; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--line); }
.popup-input { flex: 1; font-family: inherit; font-size: 13px; padding: 6px 10px; border: 1px solid var(--line); background: var(--paper); color: var(--ink); }
.popup-input:focus { outline: none; border-color: var(--accent); }
.send-btn { font-size: 13px; padding: 6px 14px; border: 1px solid var(--accent); color: var(--accent); }
.send-btn:hover:not(:disabled) { background: var(--accent); color: var(--paper); }
.send-btn:disabled { opacity: 0.4; }
</style>
