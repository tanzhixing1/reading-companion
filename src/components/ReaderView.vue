<template>
  <div class="reader-dual">
    <div class="scroll-container" ref="scrollContainer">
      <!-- 工具栏 -->
      <div class="reader-toolbar">
        <select class="chapter-select" v-model="chapterIndex" @change="onJump">
          <option v-for="(ch, idx) in chapters" :key="idx" :value="idx">
            {{ idx + 1 }}. {{ ch.title }}
          </option>
        </select>
        <div class="fragment-indicator" v-if="totalFragments > 1">
          <div class="fragment-bar">
            <div class="fragment-fill" :style="{ width: ((fragmentIndex + 1) / totalFragments * 100) + '%' }"></div>
          </div>
          <span class="fragment-text">{{ fragmentIndex + 1 }} / {{ totalFragments }}</span>
        </div>
        <div class="font-size-ctrl">
          <button class="size-btn" @click="decreaseFontSize" title="缩小字号">A-</button>
          <span class="size-display">{{ currentFontSize }}</span>
          <button class="size-btn" @click="increaseFontSize" title="增大字号">A+</button>
        </div>
        <button
          class="generate-btn"
          @click="generating ? stopGenerate() : startGenerate()"
          :disabled="!hasApiConfig"
        >
          {{ generating ? '⏹ 停止' : '✎ 请TA批注' }}
        </button>
        <button v-if="annotations.length" class="clear-btn" @click="clearAnnotations">清除批注</button>
      </div>

      <!-- 章节标题 -->
      <div class="chapter-heading">
        <p class="fleuron">❦</p>
        <h2 class="ch-title">{{ currentChapter?.title }}</h2>
        <p class="ch-meta">第 {{ chapterIndex + 1 }} / {{ totalChapters }} 章</p>
        <hr class="rule-double" />
      </div>

      <div v-if="generating && !annotations.length" class="generating-hint">正在阅读中…</div>

      <!-- 双栏 -->
      <div class="dual-columns" ref="dualColumnsEl">
        <div class="text-column" ref="textColumnEl">
          <p
            v-for="(para, idx) in visibleParagraphs"
            :key="idx"
            class="paragraph"
            :data-para-index="fragmentOffset + idx"
            :class="{ 'has-annotation': getAnnotation(fragmentOffset + idx) }"
          >
            <span class="para-num">{{ fragmentOffset + idx + 1 }}</span>
            {{ para }}
          </p>
        </div>
        <div class="column-divider"></div>
        <div class="margin-column" ref="marginColumnEl">
          <div class="margin-inner" :style="{ minHeight: textColumnHeight + 'px' }">
            <div
              v-for="(ann, idx) in annotations"
              :key="ann.dbId || idx"
              class="annotation-block"
              :style="{ top: annPositions[ann.paragraphIndex] + 'px' }"
            >
              <div class="ann-header-row">
                <span class="ann-anchor">¶{{ ann.paragraphIndex + 1 }}</span>
                <div class="ann-actions">
                  <button class="act-btn" @click="startEditAnnotation(ann)" title="编辑">✎</button>
                  <button class="act-btn" @click="deleteAnnotation(ann)" title="删除">✕</button>
                  <button class="act-btn discuss" @click="openDiscussion(ann)" title="讨论">💬
                    <span v-if="ann.discussion?.length" class="discuss-count">{{ ann.discussion.length }}</span>
                  </button>
                </div>
              </div>
              <div v-if="editingAnnId === ann.dbId" class="ann-edit-box">
                <textarea class="ann-edit-input" v-model="editAnnText" rows="3"></textarea>
                <div class="ann-edit-actions">
                  <button class="action-btn" @click="cancelEditAnnotation">取消</button>
                  <button class="action-btn primary" @click="confirmEditAnnotation(ann)">保存</button>
                </div>
              </div>
              <p v-else class="ann-text">
                {{ ann.content }}
                <span v-if="generating && idx === annotations.length - 1 && ann.content" class="cursor-blink">|</span>
              </p>
              <span class="ann-author">— {{ characterName }}</span>
            </div>
            <div v-if="!generating && !annotations.length" class="margin-placeholder">
              — 点击「请TA批注」—
            </div>
          </div>
        </div>
      </div>

      <!-- 片段底部字数信息 -->
      <div v-if="totalFragments > 1" class="fragment-footer">
        <span class="fragment-char-count">本段约 {{ currentFragmentCharCount }} 字</span>
      </div>

      <!-- 章末摘要区（最后片段时显示） -->
      <div v-if="currentChapter && isLastFragment" class="summary-section">
        <hr class="rule-thin" />
        <div class="summary-header">
          <h3 class="summary-title">本章摘要</h3>
          <div class="summary-actions" v-if="!generatingSummary">
            <button class="summary-btn" @click="generateSummary('neutral')" :disabled="!hasApiConfig">
              AI 中性摘要
            </button>
            <button class="summary-btn" @click="generateSummary('character')" :disabled="!hasApiConfig">
              {{ characterName }}的总结
            </button>
          </div>
          <span v-else class="summary-generating">生成中…</span>
        </div>
        <div v-if="chapterMemory" class="summary-content">
          <div v-if="editingMemory" class="memory-edit">
            <textarea class="memory-textarea" v-model="editMemoryText" rows="5"></textarea>
            <div class="memory-edit-actions">
              <button class="action-btn" @click="editingMemory = false">取消</button>
              <button class="action-btn primary" @click="saveMemoryEdit">保存</button>
            </div>
          </div>
          <div v-else class="memory-display" @dblclick="startEditMemory">
            <p class="memory-text">{{ chapterMemory.content }}</p>
            <div class="memory-meta">
              <span class="memory-type">{{ chapterMemory.type === 'character' ? characterName + '的总结' : 'AI 摘要' }}</span>
              <button class="act-btn" @click="startEditMemory">✎</button>
              <button class="act-btn del" @click="deleteMemory">✕</button>
            </div>
          </div>
        </div>
        <p v-else-if="!generatingSummary" class="summary-empty">暂无摘要，点击上方按钮生成。</p>
      </div>

      <!-- 评论区 -->
      <CommentSection
        v-if="currentChapter && isLastFragment"
        :book="props.book"
        :chapter="currentChapter"
        :annotations="annotationsWithDiscussion"
      />

      <nav class="chapter-nav">
        <button class="nav-btn" :disabled="!canPrev" @click="goPrev">
          {{ fragmentIndex > 0 ? '← 上一段' : '← 上一章' }}
        </button>
        <button class="nav-btn" :disabled="!canNext" @click="goNext">
          {{ fragmentIndex < totalFragments - 1 ? '下一段 →' : '下一章 →' }}
        </button>
      </nav>
    </div>

    <AnnotationPopup
      v-if="activeAnnotation"
      :annotation="activeAnnotation"
      :paragraphText="getParagraphText(activeAnnotation.paragraphIndex)"
      :book="props.book"
      :chapter="currentChapter"
      :allParagraphs="allParagraphs"
      @close="activeAnnotation = null"
      @updated="loadAnnotations"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { db, getSetting, setSetting } from '../db/database.js'
import { streamChat } from '../services/llmApi.js'
import { parseAnnotations } from '../services/annotationParser.js'
import { getPreviousMemories } from '../services/memoryService.js'
import { applyTheme } from '../services/themeService.js'
import AnnotationPopup from './AnnotationPopup.vue'
import CommentSection from './CommentSection.vue'

const props = defineProps({ book: Object })
const emit = defineEmits(['chapterChange'])

const chapters = ref([])
const chapterIndex = ref(0)
const fragmentIndex = ref(0)
const fragmentSize = ref(0)
const scrollContainer = ref(null)
const textColumnEl = ref(null)
const marginColumnEl = ref(null)
const annotations = ref([])
const generating = ref(false)
const hasApiConfig = ref(false)
const activeAnnotation = ref(null)
const characterName = ref('角色')
let abortController = null

const annPositions = ref({})
const textColumnHeight = ref(0)
const editingAnnId = ref(null)
const editAnnText = ref('')
const currentFontSize = ref(15)

// 摘要相关
const chapterMemory = ref(null)
const generatingSummary = ref(false)
const editingMemory = ref(false)
const editMemoryText = ref('')

// ===== 暴露给父组件的同步方法 =====
async function syncTheme() {
  const themeSettings = await getSetting('themeSettings')
  if (themeSettings) {
    applyTheme(themeSettings)
    if (themeSettings.fontSize) currentFontSize.value = themeSettings.fontSize
  }
  // 重新读取 fragmentSize
  const appSettings = await getSetting('appSettings')
  fragmentSize.value = appSettings?.fragmentSize || 0
  // 重算位置
  await nextTick()
  recalcPositions()
  await refinePositions()
}

defineExpose({ syncTheme })

// ===== 字号控制 =====
function increaseFontSize() {
  if (currentFontSize.value >= 28) return
  currentFontSize.value += 1
  applyFontSize()
}

function decreaseFontSize() {
  if (currentFontSize.value <= 12) return
  currentFontSize.value -= 1
  applyFontSize()
}

async function applyFontSize() {
  const root = document.documentElement
  root.style.setProperty('--font-size-body', currentFontSize.value + 'px')
  root.style.setProperty('--font-size-annotation', (currentFontSize.value - 1) + 'px')
  // 持久化
  const saved = await getSetting('themeSettings') || {}
  saved.fontSize = currentFontSize.value
  saved.annFontSize = currentFontSize.value - 1
  await setSetting('themeSettings', saved)
  // 重算批注位置
  await nextTick()
  recalcPositions()
  await refinePositions()
}

// ===== 位置计算 =====
function recalcPositions() {
  if (!textColumnEl.value) return
  textColumnHeight.value = textColumnEl.value.scrollHeight
  const paraEls = textColumnEl.value.querySelectorAll('.paragraph[data-para-index]')
  const paraTopMap = {}
  paraEls.forEach(el => { paraTopMap[parseInt(el.dataset.paraIndex, 10)] = el.offsetTop })
  const positions = {}
  let lastBottom = 0
  const sorted = [...annotations.value].sort((a, b) => a.paragraphIndex - b.paragraphIndex)
  for (const ann of sorted) {
    const desiredTop = paraTopMap[ann.paragraphIndex] ?? 0
    const actualTop = Math.max(desiredTop, lastBottom + 8)
    positions[ann.paragraphIndex] = actualTop
    const estimatedHeight = Math.max(60, Math.ceil(ann.content.length / 20) * 24 + 48)
    lastBottom = actualTop + estimatedHeight
  }
  annPositions.value = positions
}

async function refinePositions() {
  await nextTick()
  if (!marginColumnEl.value || !textColumnEl.value) return
  const paraEls = textColumnEl.value.querySelectorAll('.paragraph[data-para-index]')
  const paraTopMap = {}
  paraEls.forEach(el => { paraTopMap[parseInt(el.dataset.paraIndex, 10)] = el.offsetTop })
  const annBlocks = marginColumnEl.value.querySelectorAll('.annotation-block')
  const positions = {}
  let lastBottom = 0
  const sorted = [...annotations.value].sort((a, b) => a.paragraphIndex - b.paragraphIndex)
  sorted.forEach((ann, i) => {
    const desiredTop = paraTopMap[ann.paragraphIndex] ?? 0
    const actualTop = Math.max(desiredTop, lastBottom + 8)
    positions[ann.paragraphIndex] = actualTop
    const block = annBlocks[i]
    lastBottom = actualTop + (block ? block.offsetHeight : 60)
  })
  annPositions.value = positions
  textColumnHeight.value = Math.max(textColumnEl.value.scrollHeight, lastBottom + 20)
}

watch(annotations, async () => { recalcPositions(); await refinePositions() }, { deep: true })

let resizeTimer = null
function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { recalcPositions(); refinePositions() }, 200) }
onMounted(() => window.addEventListener('resize', onResize))
onUnmounted(() => window.removeEventListener('resize', onResize))

// ===== 核心数据 =====
const totalChapters = computed(() => chapters.value.length)
const currentChapter = computed(() => chapters.value[chapterIndex.value])
const allParagraphs = computed(() => currentChapter.value?.paragraphs || [])

const fragments = computed(() => {
  if (!fragmentSize.value || fragmentSize.value <= 0) return [allParagraphs.value]
  const result = []; let charCount = 0; let batch = []
  for (const p of allParagraphs.value) {
    batch.push(p); charCount += p.length
    if (charCount >= fragmentSize.value) { result.push(batch); batch = []; charCount = 0 }
  }
  if (batch.length) result.push(batch)
  return result
})

const totalFragments = computed(() => fragments.value.length)
const visibleParagraphs = computed(() => fragments.value[fragmentIndex.value] || [])
const isLastFragment = computed(() => fragmentIndex.value === totalFragments.value - 1)
const fragmentOffset = computed(() => {
  let o = 0; for (let i = 0; i < fragmentIndex.value; i++) o += fragments.value[i].length; return o
})
const currentFragmentCharCount = computed(() => {
  return visibleParagraphs.value.reduce((sum, p) => sum + p.length, 0)
})
const canPrev = computed(() => chapterIndex.value > 0 || fragmentIndex.value > 0)
const canNext = computed(() =>
  fragmentIndex.value < totalFragments.value - 1 || chapterIndex.value < totalChapters.value - 1
)
const annotationsWithDiscussion = computed(() => annotations.value)

function getAnnotation(paraIndex) { return annotations.value.find(a => a.paragraphIndex === paraIndex) }
function getParagraphText(paraIndex) { return allParagraphs.value[paraIndex] || '' }
function openDiscussion(ann) { if (!generating.value) activeAnnotation.value = ann }

// 批注编辑
function startEditAnnotation(ann) { editingAnnId.value = ann.dbId; editAnnText.value = ann.content }
function cancelEditAnnotation() { editingAnnId.value = null; editAnnText.value = '' }
async function confirmEditAnnotation(ann) {
  const t = editAnnText.value.trim(); if (!t) return
  ann.content = t; if (ann.dbId) await db.annotations.update(ann.dbId, { content: t })
  cancelEditAnnotation()
}
async function deleteAnnotation(ann) {
  if (!confirm('确定删除这条批注及其讨论记录？')) return
  if (ann.dbId) await db.annotations.delete(ann.dbId)
  await loadAnnotations()
}

// ===== 摘要功能 =====
async function loadMemory() {
  if (!currentChapter.value) { chapterMemory.value = null; return }
  const mem = await db.memories.where('chapterId').equals(currentChapter.value.id).first()
  chapterMemory.value = mem || null
}

async function generateSummary(mode) {
  const settings = await getSetting('appSettings')
  if (!settings?.apiKey) { alert('请先配置 API'); return }
  generatingSummary.value = true
  try {
    const text = allParagraphs.value.join('\n\n')
    const messages = []
    if (mode === 'character') {
      const persona = await getSetting('personaSettings')
      let sys = ''
      if (persona?.persona) sys += persona.persona + '\n\n'
      sys += `你刚读完《${props.book.title}》的章节「${currentChapter.value.title}」。请以你的角色身份写一段读后总结（200-400字），可以带有你个人的感受、评价和风格。`
      messages.push({ role: 'system', content: sys })
    } else {
      messages.push({
        role: 'system',
        content: `你是一个精准的文本摘要助手。请为以下章节内容生成一段中性、客观的内容梗概（200-400字），包含主要情节、出场人物、关键事件。不要加入个人评价，不要使用"本章"等元叙述用语，直接陈述发生了什么。`
      })
    }
    messages.push({ role: 'user', content: `《${props.book.title}》章节「${currentChapter.value.title}」的内容：\n\n${text}` })
    const config = {
      baseURL: settings.baseURL, apiKey: settings.apiKey,
      model: settings.model, temperature: mode === 'character' ? 0.7 : 0.3, maxTokens: 1024,
      streamSpeed: settings.streamSpeed || 'normal'
    }
    let result = ''
    await streamChat(config, messages, chunk => { result += chunk })
    const existing = await db.memories.where('chapterId').equals(currentChapter.value.id).first()
    if (existing) {
      await db.memories.update(existing.id, { content: result, type: mode, createdAt: Date.now() })
    } else {
      await db.memories.add({
        bookId: props.book.id, chapterId: currentChapter.value.id,
        content: result, type: mode, createdAt: Date.now()
      })
    }
    await loadMemory()
  } catch (e) {
    alert('生成失败: ' + e.message)
  } finally {
    generatingSummary.value = false
  }
}

function startEditMemory() {
  editingMemory.value = true
  editMemoryText.value = chapterMemory.value?.content || ''
}
async function saveMemoryEdit() {
  const t = editMemoryText.value.trim()
  if (!t || !chapterMemory.value) return
  await db.memories.update(chapterMemory.value.id, { content: t })
  chapterMemory.value.content = t
  editingMemory.value = false
}
async function deleteMemory() {
  if (!confirm('确定删除本章摘要？')) return
  if (chapterMemory.value?.id) await db.memories.delete(chapterMemory.value.id)
  chapterMemory.value = null
}

// ===== 导航 =====
function onJump() {
  fragmentIndex.value = 0
  scrollTop(); saveProgress(); loadAnnotations(); loadMemory()
  emit('chapterChange', currentChapter.value)
}
function goNext() {
  if (fragmentIndex.value < totalFragments.value - 1) {
    fragmentIndex.value++
  } else if (chapterIndex.value < totalChapters.value - 1) {
    chapterIndex.value++; fragmentIndex.value = 0
  }
  scrollTop(); saveProgress(); loadAnnotations(); loadMemory()
  emit('chapterChange', currentChapter.value)
}
function goPrev() {
  if (fragmentIndex.value > 0) { fragmentIndex.value-- }
  else if (chapterIndex.value > 0) {
    chapterIndex.value--; fragmentIndex.value = 0
    setTimeout(() => { fragmentIndex.value = totalFragments.value - 1 }, 0)
  }
  scrollTop(); saveProgress(); loadAnnotations(); loadMemory()
  emit('chapterChange', currentChapter.value)
}
function scrollTop() { scrollContainer.value?.scrollTo({ top: 0, behavior: 'smooth' }) }
async function saveProgress() { await db.books.update(props.book.id, { currentChapter: chapterIndex.value }) }

async function loadAnnotations() {
  if (!currentChapter.value) { annotations.value = []; return }
  const saved = await db.annotations.where('chapterId').equals(currentChapter.value.id).toArray()
  annotations.value = saved
    .map(a => ({ paragraphIndex: a.paragraphIndex, content: a.content, discussion: a.discussion || [], dbId: a.id }))
    .sort((a, b) => a.paragraphIndex - b.paragraphIndex)
  await nextTick(); recalcPositions(); await refinePositions()
}

async function clearAnnotations() {
  if (!confirm('确定清除本章所有批注？')) return
  await db.annotations.where('chapterId').equals(currentChapter.value.id).delete()
  annotations.value = []
}

// ===== 批注生成 =====
async function startGenerate() {
  const settings = await getSetting('appSettings')
  if (!settings?.apiKey) { alert('请先在「设置」中配置 API Key'); return }
  const persona = await getSetting('personaSettings')
  generating.value = true; annotations.value = []
  abortController = new AbortController()

  const paras = visibleParagraphs.value
  const numberedText = paras.map((p, i) => `[${fragmentOffset.value + i}] ${p}`).join('\n\n')
  const allowedIndexes = new Set(paras.map((_, i) => fragmentOffset.value + i))
  const messages = []

  if (persona?.worldBook) {
    const enabled = persona.worldBook.filter(e => e.enabled && e.content.trim())
    if (enabled.length) {
      const worldBookText = enabled
        .map(e => e.name?.trim() ? `### ${e.name.trim()}\n${e.content}` : e.content)
        .join('\n\n')
      messages.push({
        role: 'system',
        content: `【世界书】
以下内容用于强化角色视角、关系背景和说话风格。
世界书不是让你脱离当前文本写剧情。
生成批注时，必须优先贴合当前段落；只有当前段落能自然触发时，才轻微使用世界书信息。

${worldBookText}`
      })
    }
  }

  const contextRange = settings.contextRange || 'nearby'
  if (contextRange === 'chapter+memory' && currentChapter.value) {
    const prevMemories = await getPreviousMemories(props.book.id, currentChapter.value.order)
    if (prevMemories) messages.push({ role: 'system', content: prevMemories })
  }

  let sysContent = ''
  if (persona?.personaName) sysContent += `你当前扮演的角色名是：${persona.personaName}\n\n`
  if (persona?.persona) sysContent += `【角色设定】\n${persona.persona}\n\n`
  if (persona?.userMask) sysContent += `【关于用户】\n${persona.userMask}\n\n`
  sysContent += `你正在阅读《${props.book.title}》的章节「${currentChapter.value.title}」。
请以当前角色的身份，为当前可见段落写角色共读批注。

你生成的是角色共读批注，不是 AI 摘要。每条批注都必须像当前角色读到这一处时自然留下的一句话。角色的锋利不是攻击性，而是观察准确；角色的温柔不是热烈，而是留有余地。

批注原则：
1. 批注不是 AI 摘要，不要概括本段讲了什么。
2. 批注不是文学赏析，不要写成作文点评、修辞分析或主题提炼。
3. 批注不是阅读理解，不要回答“这说明了什么”。
4. 批注不是心理学分析报告，不要给人物下诊断。
5. 批注要像当前角色陪用户读书时，在书页边缘留下的一句话。
6. 每条批注必须贴近当前段落中的具体句子、动作、物品、语气、关系变化或情绪缝隙。
7. 可以包含角色自己的感受、判断、联想、偏见、冷幽默，或者对用户的轻声交流。
8. 不要复述原文，不要脱离文本长篇发挥，不要剧透当前片段之后的内容。
9. 不要每条批注都提问。
10. 每条批注建议 30-90 个中文字，重要处最多 120 字。
11. 一次输出 3-6 条批注。
12. 不需要每段都写，只给真正值得停留的段落写。

输出格式必须严格遵守：
1. 仍然使用 @@编号 标记批注属于哪一段，然后另起一行写批注内容。
2. 编号必须完全复制原文段落方括号里的数字。
3. 例如原文是 [0] xxx，就输出 @@0。
4. 原文是 [12] xxx，就输出 @@12。
5. 不要自行换算，不要改成第几段，不要改成 1-based。
6. 只输出若干组 @@编号 + 批注内容。
7. 不要输出标题、前言、解释、总结、项目符号或 Markdown 列表。

输出格式示例：
@@0
这里他没有把话说满，反而更像是真的在意。人有时候越体面，留下的余地越少。

@@3
这句别急着翻过去。她不是没感觉，她只是把感觉换成了一个更安全的说法。`

  messages.push({ role: 'system', content: sysContent })
  messages.push({
    role: 'user',
    content: `以下是当前可见的原文段落。
方括号里的数字是系统定位编号。
你输出批注时，@@ 后面的编号必须完全复制该数字。
请只针对这些段落生成角色共读批注。

${numberedText}`
  })

  try {
    const config = {
      baseURL: settings.baseURL, apiKey: settings.apiKey,
      model: settings.model, temperature: 0.7, maxTokens: 4096,
      streamSpeed: settings.streamSpeed || 'normal'
    }
    let accumulated = ''
    let lastUpdateTime = 0
    const updateInterval = 100
    const parseGeneratedAnnotations = (text) =>
      parseAnnotations(text, allowedIndexes).sort((a, b) => a.paragraphIndex - b.paragraphIndex)

    await streamChat(config, messages, async (chunk) => {
      accumulated += chunk
      const now = Date.now()
      if (now - lastUpdateTime >= updateInterval) {
        lastUpdateTime = now
        annotations.value = parseGeneratedAnnotations(accumulated)
        await nextTick(); recalcPositions()
      }
    }, abortController.signal)

    // 最终刷新
    annotations.value = parseGeneratedAnnotations(accumulated)
    if (accumulated.trim() && !annotations.value.length) {
      alert('批注生成了文本，但未能解析出有效批注。请检查模型是否按 @@编号 格式输出。')
    }
    await saveAnnotationsToDb(); await refinePositions()
  } catch (e) {
    if (e.name !== 'AbortError') { console.error(e); alert('批注生成失败: ' + e.message) }
  } finally { generating.value = false }
}

function stopGenerate() { abortController?.abort(); generating.value = false; saveAnnotationsToDb() }

async function saveAnnotationsToDb() {
  if (!annotations.value.length) return
  await db.annotations.where('chapterId').equals(currentChapter.value.id).delete()
  const records = annotations.value.map(a => ({
    bookId: props.book.id, chapterId: currentChapter.value.id,
    paragraphIndex: a.paragraphIndex, content: a.content, discussion: []
  }))
  await db.annotations.bulkAdd(records)
  await loadAnnotations()
}

async function checkApiConfig() {
  const settings = await getSetting('appSettings')
  hasApiConfig.value = !!(settings?.apiKey)
}

async function loadChapters() {
  const persona = await getSetting('personaSettings')
  if (persona?.personaName) characterName.value = persona.personaName
  const list = await db.chapters.where('bookId').equals(props.book.id).sortBy('order')
  chapters.value = list
  chapterIndex.value = props.book.currentChapter || 0
  fragmentIndex.value = 0
  const appSettings = await getSetting('appSettings')
  fragmentSize.value = appSettings?.fragmentSize || 0
  const themeSettings = await getSetting('themeSettings')
  if (themeSettings?.fontSize) currentFontSize.value = themeSettings.fontSize
  await loadAnnotations(); await loadMemory(); await checkApiConfig()
  emit('chapterChange', chapters.value[chapterIndex.value])
}

watch(() => props.book, () => { if (props.book) loadChapters() }, { immediate: true })
</script>

<style scoped>
.reader-dual { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.scroll-container { flex: 1; overflow-y: auto; padding: 28px 40px; }

.reader-toolbar {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 20px; padding-bottom: 14px;
  border-bottom: 1px solid var(--line); flex-wrap: wrap;
}
.chapter-select {
  flex: 1; min-width: 180px; font-family: inherit; font-size: 13px;
  padding: 5px 8px; border: 1px solid var(--line);
  background: var(--paper); color: var(--ink); cursor: pointer;
}
.chapter-select:focus { outline: none; border-color: var(--accent); }
.fragment-indicator { display: flex; align-items: center; gap: 8px; }
.fragment-bar { width: 60px; height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; }
.fragment-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s; }
.fragment-text { font-size: 11px; color: var(--ink-soft); white-space: nowrap; }

.font-size-ctrl { display: flex; align-items: center; gap: 4px; }
.size-btn { font-size: 12px; padding: 3px 8px; border: 1px solid var(--line); color: var(--ink-soft); }
.size-btn:hover { border-color: var(--accent); color: var(--accent); }
.size-display { font-size: 11px; color: var(--ink-soft); min-width: 20px; text-align: center; }

.generate-btn {
  font-size: 13px; padding: 5px 14px; border: 1px solid var(--accent);
  color: var(--accent); letter-spacing: 0.1em; white-space: nowrap;
}
.generate-btn:hover:not(:disabled) { background: var(--accent); color: var(--paper); }
.generate-btn:disabled { opacity: 0.4; cursor: default; }
.clear-btn { font-size: 12px; padding: 5px 10px; border: 1px solid var(--line); color: var(--ink-soft); white-space: nowrap; }
.clear-btn:hover { border-color: var(--accent); color: var(--accent); }

.chapter-heading { text-align: center; margin-bottom: 32px; }
.ch-title { font-size: 18px; font-weight: normal; letter-spacing: 0.3em; margin: 8px 0; }
.ch-meta { font-size: 12px; color: var(--ink-soft); margin-bottom: 12px; }
.generating-hint { color: var(--ink-soft); font-size: 13px; text-align: center; padding: 12px 0; letter-spacing: 0.2em; }

.dual-columns { display: flex; align-items: flex-start; position: relative; }
.text-column {
  flex: 3; font-family: var(--font-body); font-size: var(--font-size-body);
  line-height: var(--line-height-body); padding-right: 24px;
}
.column-divider { width: 1px; background: var(--line); align-self: stretch; flex-shrink: 0; }
.margin-column { flex: 2; padding-left: 24px; }
.margin-inner { position: relative; }

.paragraph {
  position: relative; margin-bottom: 12px; padding-left: 32px;
  border-left: 2px solid transparent; transition: border-color 0.3s;
}
.paragraph.has-annotation { border-left-color: var(--accent); }
.para-num {
  position: absolute; left: 0; top: 0; font-size: 10px; color: var(--ink-soft);
  user-select: none; width: 24px; text-align: right;
}

.annotation-block {
  position: absolute; left: 0; right: 0;
  padding-bottom: 14px; border-bottom: 1px solid var(--line);
}
.ann-header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.ann-anchor { font-size: 11px; color: var(--accent); letter-spacing: 0.1em; }
.ann-actions { display: flex; gap: 2px; }
.act-btn { font-size: 12px; color: var(--ink-soft); padding: 2px 5px; opacity: 0.4; transition: opacity 0.2s; }
.act-btn:hover { opacity: 1; color: var(--accent); }
.act-btn.discuss { font-size: 13px; }
.discuss-count { font-size: 10px; }

.ann-text {
  font-family: var(--font-annotation); font-size: var(--font-size-annotation);
  line-height: 1.8; color: var(--color-annotation); font-style: italic;
}
.ann-author { display: block; font-size: 11px; color: var(--ink-soft); font-style: italic; margin-top: 4px; }

.ann-edit-box { margin-top: 4px; }
.ann-edit-input {
  width: 100%; font-family: inherit; font-size: 13px; line-height: 1.7;
  padding: 6px 10px; border: 1px solid var(--accent); background: var(--paper); color: var(--ink); resize: vertical;
}
.ann-edit-input:focus { outline: none; }
.ann-edit-actions { display: flex; gap: 8px; margin-top: 6px; justify-content: flex-end; }
.action-btn { font-size: 12px; padding: 4px 12px; border: 1px solid var(--line-strong); letter-spacing: 0.05em; }
.action-btn:hover { background: var(--paper-deep); }
.action-btn.primary { background: var(--line-strong); color: var(--paper); }
.action-btn.primary:hover { background: var(--ink); }

.margin-placeholder { text-align: center; color: var(--ink-soft); font-size: 13px; letter-spacing: 0.2em; padding-top: 40px; }

.cursor-blink { animation: blink 0.8s step-end infinite; color: var(--accent); }
@keyframes blink { 50% { opacity: 0; } }

.fragment-footer { text-align: center; padding: 12px 0; margin-top: 16px; border-top: 1px dashed var(--line); }
.fragment-char-count { font-size: 11px; color: var(--ink-soft); letter-spacing: 0.1em; }

.summary-section { margin-top: 32px; padding: 0 0 16px; }
.summary-header { display: flex; align-items: center; gap: 12px; margin: 12px 0; flex-wrap: wrap; }
.summary-title { font-size: 14px; font-weight: normal; letter-spacing: 0.2em; color: var(--ink-soft); }
.summary-actions { display: flex; gap: 8px; }
.summary-btn { font-size: 12px; padding: 4px 12px; border: 1px solid var(--line); color: var(--ink-soft); letter-spacing: 0.05em; }
.summary-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.summary-btn:disabled { opacity: 0.4; }
.summary-generating { font-size: 12px; color: var(--accent); font-style: italic; }
.summary-empty { font-size: 12px; color: var(--ink-soft); font-style: italic; }
.summary-content { margin-top: 8px; }
.memory-display { position: relative; cursor: pointer; }
.memory-text { font-size: 13px; line-height: 1.8; color: var(--ink); }
.memory-meta { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.memory-type { font-size: 11px; color: var(--ink-soft); font-style: italic; }
.act-btn.del:hover { color: var(--close-hover); }
.memory-edit { margin-top: 4px; }
.memory-textarea {
  width: 100%; font-family: inherit; font-size: 13px; line-height: 1.7;
  padding: 8px 10px; border: 1px solid var(--accent); background: var(--paper); color: var(--ink); resize: vertical;
}
.memory-textarea:focus { outline: none; }
.memory-edit-actions { display: flex; gap: 8px; margin-top: 6px; justify-content: flex-end; }

.chapter-nav { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line); }
.nav-btn { font-size: 13px; padding: 6px 16px; border: 1px solid var(--line); letter-spacing: 0.1em; }
.nav-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.nav-btn:disabled { opacity: 0.35; cursor: default; }
</style>
