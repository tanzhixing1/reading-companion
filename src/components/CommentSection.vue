<template>
  <div class="comment-section">
    <hr class="rule-double" />
    <h3 class="comment-title">章末评论区</h3>

    <div class="comment-list" ref="commentList">
      <div
        class="comment-item"
        v-for="(msg, idx) in comments"
        :key="idx"
        :class="msg.role"
      >
        <div class="comment-meta">
          <span class="comment-role">{{ getCommentAuthor(msg) }}</span>
          <span class="comment-actions" v-if="!editing || editIdx !== idx">
            <button class="act-btn" @click="startEdit(idx)" title="编辑">✎</button>
            <button class="act-btn" @click="deleteComment(idx)" title="删除">✕</button>
          </span>
        </div>
        <div v-if="editing && editIdx === idx" class="edit-box">
          <textarea class="edit-input" v-model="editText" rows="3"></textarea>
          <div class="edit-actions">
            <button class="action-btn" @click="cancelEdit">取消</button>
            <button class="action-btn primary" @click="confirmEdit(idx)">保存</button>
          </div>
        </div>
        <p v-else class="comment-text">{{ msg.content }}</p>
      </div>

      <div v-if="replying && streamingReply" class="comment-item assistant">
        <span class="comment-role">{{ characterName }}</span>
        <p class="comment-text">{{ streamingReply }}<span class="cursor-blink">|</span></p>
      </div>
      <div v-else-if="replying" class="comment-item assistant">
        <span class="comment-role">{{ characterName }}</span>
        <p class="comment-text comment-loading">……</p>
      </div>
    </div>

    <div class="comment-input-row">
      <input
        class="comment-input"
        v-model="userInput"
        placeholder="读完这章，聊聊你的感受…"
        @keydown.enter="sendComment"
        :disabled="replying"
      />
      <button class="send-btn" @click="sendComment" :disabled="replying || !userInput.trim()">发送</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'
import { db, getSetting } from '../db/database.js'
import { streamChat } from '../services/llmApi.js'
import { getActivePersona, getPersonaDisplayName } from '../services/personaService.js'

const props = defineProps({
  book: Object,
  chapter: Object,
  annotations: Array
})

const comments = ref([])
const userInput = ref('')
const replying = ref(false)
const streamingReply = ref('')
const commentList = ref(null)
const characterName = ref('角色')
const userName = ref('你')
const editing = ref(false)
const editIdx = ref(-1)
const editText = ref('')

async function loadNames() {
  const persona = await getActivePersona()
  characterName.value = getPersonaDisplayName(persona)
  if (persona?.userName) userName.value = persona.userName
}

onMounted(async () => {
  await loadNames()
  loadComments()
})

watch(() => props.chapter, async () => {
  await loadNames()
  loadComments()
})

async function loadComments() {
  if (!props.chapter) { comments.value = []; return }
  const saved = await db.comments.where('chapterId').equals(props.chapter.id).toArray()
  saved.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  comments.value = saved.map(c => ({
    role: c.role,
    content: c.content,
    personaId: c.personaId || '',
    personaName: c.personaName || '',
    dbId: c.id
  }))
}

async function deleteComment(idx) {
  if (!confirm('确定删除这条评论？')) return
  const msg = comments.value[idx]
  if (msg.dbId) await db.comments.delete(msg.dbId)
  comments.value.splice(idx, 1)
}

function getCommentAuthor(msg) {
  if (msg.role === 'user') return userName.value
  return msg.personaName || characterName.value
}

function startEdit(idx) { editing.value = true; editIdx.value = idx; editText.value = comments.value[idx].content }
function cancelEdit() { editing.value = false; editIdx.value = -1; editText.value = '' }
async function confirmEdit(idx) {
  const newText = editText.value.trim()
  if (!newText) return
  comments.value[idx].content = newText
  if (comments.value[idx].dbId) await db.comments.update(comments.value[idx].dbId, { content: newText })
  cancelEdit()
}

async function sendComment() {
  const text = userInput.value.trim()
  if (!text || replying.value) return
  const dbId = await db.comments.add({
    bookId: props.book.id, chapterId: props.chapter.id,
    role: 'user', content: text, createdAt: Date.now()
  })
  comments.value.push({ role: 'user', content: text, dbId })
  userInput.value = ''
  replying.value = true
  streamingReply.value = ''
  await nextTick()
  scrollBottom()

  try {
    const settings = await getSetting('appSettings')
    const persona = await getActivePersona()
    characterName.value = getPersonaDisplayName(persona)
    if (persona?.userName) userName.value = persona.userName
    const messages = buildMessages(settings, persona)
    const config = {
      baseURL: settings.baseURL, apiKey: settings.apiKey,
      model: settings.model, temperature: 0.7, maxTokens: 2048,
      streamSpeed: settings.streamSpeed || 'normal'
    }
    await streamChat(config, messages, chunk => { streamingReply.value += chunk; scrollBottom() })
    const reply = streamingReply.value
    const replyDbId = await db.comments.add({
      bookId: props.book.id, chapterId: props.chapter.id,
      role: 'assistant', content: reply, createdAt: Date.now(),
      personaId: persona.id,
      personaName: getPersonaDisplayName(persona)
    })
    comments.value.push({
      role: 'assistant',
      content: reply,
      personaId: persona.id,
      personaName: getPersonaDisplayName(persona),
      dbId: replyDbId
    })
  } catch (e) {
    if (e.name !== 'AbortError') comments.value.push({ role: 'assistant', content: `[错误] ${e.message}` })
  } finally { replying.value = false; streamingReply.value = '' }
}

function buildMessages(settings, persona) {
  const messages = []
  if (persona?.worldBook) {
    const enabled = persona.worldBook.filter(e => e.enabled && e.content.trim())
    if (enabled.length) messages.push({ role: 'system', content: enabled.map(e => e.content).join('\n\n') })
  }
  let sys = ''
  if (persona?.persona) sys += persona.persona + '\n\n'
  if (persona?.userMask) sys += `[关于用户] ${persona.userMask}\n\n`
  sys += `你刚读完《${props.book.title}》的章节「${props.chapter.title}」。`
  sys += `用户想在评论区和你聊聊这章的感想。请以角色身份自然地交流。不需要动作描写。\n\n`
  if (settings?.annotationsInComment && props.annotations?.length) {
    const annText = props.annotations.map(a => `¶${a.paragraphIndex + 1}: ${a.content}`).join('\n')
    sys += `[你在这章写的批注]\n${annText}\n\n`
  }
  if (settings?.discussionInComment && props.annotations?.length) {
    const discussions = props.annotations
      .filter(a => a.discussion && a.discussion.length > 0)
      .map(a => {
        const chat = a.discussion.map(m => `${m.role === 'user' ? userName.value : (m.personaName || characterName.value)}: ${m.content}`).join('\n')
        return `[¶${a.paragraphIndex + 1} 的讨论]\n${chat}`
      })
    if (discussions.length) sys += discussions.join('\n\n') + '\n\n'
  }
  messages.push({ role: 'system', content: sys })
  for (const msg of comments.value) {
    messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content })
  }
  return messages
}

function scrollBottom() {
  setTimeout(() => { if (commentList.value) commentList.value.scrollTop = commentList.value.scrollHeight }, 0)
}
</script>

<style scoped>
.comment-section { margin-top: 32px; }
.comment-title {
  font-size: 14px; font-weight: normal;
  letter-spacing: 0.3em; text-align: center;
  margin: 16px 0; color: var(--ink-soft);
}
.comment-list {
  max-height: 400px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 10px; padding: 8px 0;
}
.comment-item { max-width: 90%; }
.comment-item.user { align-self: flex-end; text-align: right; }
.comment-item.assistant { align-self: flex-start; }
.comment-meta { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.comment-item.user .comment-meta { flex-direction: row-reverse; }
.comment-role { font-size: 10px; color: var(--ink-soft); letter-spacing: 0.1em; }
.comment-actions { display: flex; gap: 2px; }
.act-btn { font-size: 11px; color: var(--ink-soft); padding: 1px 4px; opacity: 0.4; transition: opacity 0.2s; }
.act-btn:hover { opacity: 1; color: var(--accent); }
.comment-text {
  font-size: 14px; line-height: 1.8; margin-top: 2px;
  padding: 8px 12px; border: 1px solid var(--line);
}
.comment-item.user .comment-text { background: var(--paper-deep); }
.comment-item.assistant .comment-text { border-color: var(--accent); }
.comment-loading { color: var(--ink-soft); font-style: italic; }
.edit-box { margin-top: 4px; }
.edit-input {
  width: 100%; font-family: inherit; font-size: 13px; line-height: 1.7;
  padding: 6px 10px; border: 1px solid var(--accent);
  background: var(--paper); color: var(--ink); resize: vertical;
}
.edit-input:focus { outline: none; }
.edit-actions { display: flex; gap: 8px; margin-top: 6px; justify-content: flex-end; }
.action-btn { font-size: 12px; padding: 4px 12px; border: 1px solid var(--line-strong); letter-spacing: 0.05em; }
.action-btn:hover { background: var(--paper-deep); }
.action-btn.primary { background: var(--line-strong); color: var(--paper); }
.action-btn.primary:hover { background: var(--ink); }
.cursor-blink { animation: blink 0.8s step-end infinite; color: var(--accent); }
@keyframes blink { 50% { opacity: 0; } }
.comment-input-row {
  display: flex; gap: 8px; margin-top: 12px;
  padding-top: 12px; border-top: 1px solid var(--line);
}
.comment-input {
  flex: 1; font-family: inherit; font-size: 13px;
  padding: 8px 12px; border: 1px solid var(--line);
  background: var(--paper); color: var(--ink);
}
.comment-input:focus { outline: none; border-color: var(--accent); }
.send-btn { font-size: 13px; padding: 6px 14px; border: 1px solid var(--accent); color: var(--accent); }
.send-btn:hover:not(:disabled) { background: var(--accent); color: var(--paper); }
.send-btn:disabled { opacity: 0.4; }
</style>
