<template>
  <div class="app-shell">
    <nav class="sidebar">
      <div class="sidebar-brand" title="共读">共<br />读</div>
      <hr class="rule-thin" />
      <button class="side-btn" @click="activeModal = 'bookshelf'">书<br />架</button>
      <button class="side-btn" @click="activeModal = 'persona'">角<br />色</button>
      <button class="side-btn" @click="activeModal = 'memory'">记<br />忆</button>
      <button class="side-btn" @click="activeModal = 'theme'">主<br />题</button>
      <button class="side-btn" @click="activeModal = 'settings'">设<br />置</button>
    </nav>

    <div class="main-area">
      <header class="top-bar">
        <span class="book-title">{{ currentBook ? currentBook.title : '尚未打开书籍' }}</span>
        <span class="chapter-title" v-if="currentChapterTitle">{{ currentChapterTitle }}</span>
      </header>

      <ReaderView
        v-if="currentBook"
        ref="readerRef"
        :book="currentBook"
        @chapterChange="ch => currentChapterTitle = ch?.title || ''"
      />

      <div class="empty-zone" v-else>
        <div class="empty-state">
          <div class="mobius-container" @click="generateQuote">
            <svg class="mobius-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
              <ellipse cx="60" cy="60" rx="38" ry="22" fill="none" stroke="currentColor" stroke-width="1.2" class="ring ring-a" />
              <ellipse cx="60" cy="60" rx="38" ry="22" fill="none" stroke="currentColor" stroke-width="1.2" class="ring ring-b" transform="rotate(60 60 60)" />
              <ellipse cx="60" cy="60" rx="38" ry="22" fill="none" stroke="currentColor" stroke-width="1.2" class="ring ring-c" transform="rotate(120 60 60)" />
              <circle cx="60" cy="60" r="3" fill="currentColor" opacity="0.3" class="center-dot" />
            </svg>
          </div>
          <div class="quote-area">
            <p v-if="quoteGenerating" class="quote-text generating">{{ quoteText }}<span v-if="quoteText" class="cursor-blink">|</span><span v-else class="quote-loading">……</span></p>
            <p v-else-if="quoteText" class="quote-text" @click="generateQuote">{{ quoteText }}</p>
            <p v-else class="empty-text">打开「书架」导入一本 EPUB，开始共读</p>
          </div>
          <p v-if="!quoteText && !quoteGenerating" class="empty-hint">点击图案，让TA说句话</p>
        </div>
      </div>
    </div>

    <BaseModal v-if="activeModal === 'bookshelf'" title="书 架" @close="activeModal = null">
      <Bookshelf @bookOpened="handleBookOpen" @bookDeleted="handleBookDeleted" @close="activeModal = null" />
    </BaseModal>
    <BaseModal v-if="activeModal === 'persona'" title="角 色" @close="activeModal = null">
      <PersonaEditor @saved="activeModal = null" />
    </BaseModal>
    <BaseModal v-if="activeModal === 'memory'" title="记 忆" @close="activeModal = null">
      <MemoryPanel :book="currentBook" />
    </BaseModal>
    <BaseModal v-if="activeModal === 'theme'" title="主 题" @close="activeModal = null">
      <ThemePanel @saved="activeModal = null" />
    </BaseModal>
    <BaseModal v-if="activeModal === 'settings'" title="设 置" @close="activeModal = null">
      <SettingsPanel @saved="activeModal = null" />
    </BaseModal>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import BaseModal from './components/BaseModal.vue'
import Bookshelf from './components/Bookshelf.vue'
import ReaderView from './components/ReaderView.vue'
import PersonaEditor from './components/PersonaEditor.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import MemoryPanel from './components/MemoryPanel.vue'
import ThemePanel from './components/ThemePanel.vue'
import { getSetting, db } from './db/database.js'
import { applyTheme } from './services/themeService.js'
import { streamChat } from './services/llmApi.js'

const activeModal = ref(null)
const currentBook = ref(null)
const currentChapterTitle = ref('')
const readerRef = ref(null)

// 首页一句话
const quoteText = ref('')
const quoteGenerating = ref(false)
let quoteAbort = null

function handleBookOpen(book) {
  currentBook.value = book
  currentChapterTitle.value = ''
  // 停止首页生成
  if (quoteAbort) { quoteAbort.abort(); quoteAbort = null }
}

function handleBookDeleted(bookId) {
  if (currentBook.value?.id !== bookId) return
  currentBook.value = null
  currentChapterTitle.value = ''
}

// 弹窗关闭后通知 ReaderView 刷新主题/字号
watch(activeModal, (val) => {
  if (val === null && readerRef.value?.syncTheme) {
    readerRef.value.syncTheme()
  }
})

async function generateQuote() {
  const settings = await getSetting('appSettings')
  const persona = await getSetting('personaSettings')
  if (!settings?.apiKey) {
    quoteText.value = '（请先在「设置」中配置 API）'
    return
  }
  if (!persona?.persona) {
    quoteText.value = '（请先在「角色」中设定角色）'
    return
  }

  // 中断上次
  if (quoteAbort) quoteAbort.abort()
  quoteAbort = new AbortController()
  quoteGenerating.value = true
  quoteText.value = ''

  try {
    // 获取书架信息
    const allBooks = await db.books.toArray()
    let shelfInfo = '用户的书架上还没有书。'
    if (allBooks.length) {
      const lines = []
      for (const b of allBooks) {
        const chapterCount = await db.chapters.where('bookId').equals(b.id).count()
        const progress = b.currentChapter || 0
        lines.push(`《${b.title}》- 已读到第${progress + 1}/${chapterCount}章`)
      }
      shelfInfo = '用户的书架上有这些书：\n' + lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
    }

    const messages = [
      {
        role: 'system',
        content: `${persona.persona}\n\n${shelfInfo}\n\n请以角色身份说一句话（可以是推荐其他的书/催促读书/调侃/感想），简短有趣，一两句即可。不要加引号，不要加角色名前缀，直接说话。`
      },
      { role: 'user', content: '说点什么吧。' }
    ]

    const config = {
      baseURL: settings.baseURL, apiKey: settings.apiKey,
      model: settings.model, temperature: 0.9, maxTokens: 150,
      streamSpeed: settings.streamSpeed || 'normal'
    }

    await streamChat(config, messages, chunk => {
      quoteText.value += chunk
    }, quoteAbort.signal)
  } catch (e) {
    if (e.name !== 'AbortError') {
      quoteText.value = `（生成失败：${e.message}）`
    }
  } finally {
    quoteGenerating.value = false
  }
}

onMounted(async () => {
  // 注册字体
  const allFonts = await db.fonts.toArray()
  for (const f of allFonts) {
    const existing = document.querySelector(`style[data-font-id="${f.id}"]`)
    if (existing) continue
    const style = document.createElement('style')
    style.dataset.fontId = f.id
    style.textContent = `
      @font-face {
        font-family: '${f.familyName}';
        src: url(${f.dataUrl}) format('${f.format}');
        font-display: swap;
      }
    `
    document.head.appendChild(style)
  }

  // 应用主题
  const saved = await getSetting('themeSettings')
  if (saved) applyTheme(saved)
})
</script>

<style scoped>
.app-shell { height: 100%; display: flex; }

.sidebar {
  width: 52px; border-right: 2px solid var(--line-strong);
  display: flex; flex-direction: column; align-items: center;
  padding: 18px 0; gap: 14px; background: var(--paper-deep);
}
.sidebar-brand { font-size: 15px; letter-spacing: 0.1em; line-height: 1.6; color: var(--accent); user-select: none; }
.sidebar .rule-thin { width: 60%; }
.side-btn {
  font-size: 14px; line-height: 1.7; color: var(--ink-soft);
  padding: 6px 4px; border: 1px solid transparent;
  transition: color 0.2s, border-color 0.2s;
}
.side-btn:hover { color: var(--ink); border-color: var(--line); }

.main-area { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.top-bar {
  display: flex; align-items: baseline; gap: 16px;
  padding: 14px 28px; border-bottom: 3px double var(--line-strong);
}
.book-title { font-size: 16px; letter-spacing: 0.15em; }
.chapter-title { font-size: 13px; color: var(--ink-soft); }

.empty-zone { flex: 1; display: flex; align-items: center; justify-content: center; }
.empty-state { text-align: center; color: var(--ink-soft); max-width: 400px; }
.empty-text { font-size: 13px; letter-spacing: 0.15em; margin-top: 20px; }
.empty-hint { font-size: 11px; margin-top: 8px; opacity: 0.6; }

/* 莫比乌斯环 */
.mobius-container {
  display: flex; justify-content: center; align-items: center;
  cursor: pointer; padding: 20px;
  transition: transform 0.3s;
}
.mobius-container:hover { transform: scale(1.05); }
.mobius-container:active { transform: scale(0.97); }

.mobius-svg {
  width: 140px; height: 140px; color: var(--ink-soft);
}

.ring {
  stroke-dasharray: 200;
  animation: orbit 12s linear infinite;
}
.ring-b { animation-delay: -4s; opacity: 0.7; }
.ring-c { animation-delay: -8s; opacity: 0.4; }

.center-dot {
  animation: pulse-dot 3s ease-in-out infinite;
}

@keyframes orbit {
  from { stroke-dashoffset: 0; }
  to { stroke-dashoffset: 200; }
}
@keyframes pulse-dot {
  0%, 100% { opacity: 0.3; r: 3; }
  50% { opacity: 0.7; r: 4; }
}

/* 首页一句话 */
.quote-area {
  margin-top: 20px; min-height: 48px;
  display: flex; align-items: center; justify-content: center;
}
.quote-text {
  font-size: 14px; line-height: 1.8; color: var(--ink);
  letter-spacing: 0.05em; cursor: pointer;
  max-width: 360px; text-align: center;
  transition: opacity 0.3s;
}
.quote-text:hover { opacity: 0.7; }
.quote-text.generating { cursor: default; }
.quote-text.generating:hover { opacity: 1; }
.quote-loading { color: var(--ink-soft); }
.cursor-blink { animation: blink 0.8s step-end infinite; color: var(--accent); }
@keyframes blink { 50% { opacity: 0; } }
</style>
