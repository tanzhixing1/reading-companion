<template>
  <div class="bookshelf">
    <!-- 顶部操作栏 -->
    <div class="shelf-toolbar">
      <label class="upload-label">
        <input type="file" accept=".epub" @change="handleImportEpub" hidden />
        <span class="upload-btn">+ 导入 EPUB</span>
      </label>
      <label class="upload-label">
        <input type="file" accept=".json" @change="handleImportJson" hidden />
        <span class="upload-btn">↓ 导入备份</span>
      </label>
      <button class="upload-btn" @click="handleExportAll">↑ 全量导出</button>
    </div>
    <!-- 书架 -->
    <div class="shelf-scroll">
      <div
        class="book-card"
        v-for="book in books"
        :key="book.id"
        @click="openBook(book)"
      >
        <div class="book-cover">
          <img v-if="book.cover" :src="book.cover" alt="封面" />
          <div v-else class="cover-placeholder">
            <span>{{ book.title?.charAt(0) }}</span>
          </div>
        </div>
        <p class="book-title">{{ book.title }}</p>
        <p class="book-meta">{{ book.chapterCount }} 章</p>
        <div class="book-actions">
          <button class="card-btn" @click.stop="handleExportBook(book)" title="导出">↑</button>
          <button class="card-btn del" @click.stop="deleteBook(book)" title="删除">✕</button>
        </div>
      </div>
      <div v-if="!books.length" class="shelf-empty">
        暂无书籍
      </div>
    </div>
    <!-- 章节整理弹窗 -->
    <div v-if="showOrganize" class="organize-overlay">
      <div class="organize-frame">
        <header class="organize-header">
          <h3 class="organize-title">整理章节 · {{ pendingTitle }}</h3>
          <button class="popup-close" @click="cancelOrganize">✕</button>
        </header>
        <div class="organize-body">
          <p class="organize-hint">
            共解析出 {{ pendingChapters.length }} 个章节。可重命名或删除不需要的条目（如版权页、目录页）。
          </p>
          <div class="organize-list">
            <div
              class="organize-item"
              v-for="(ch, idx) in pendingChapters"
              :key="idx"
            >
              <span class="organize-idx">{{ idx + 1 }}</span>
              <input class="organize-input" v-model="ch.title" />
              <span class="organize-count">{{ ch.paragraphs.length }} 段</span>
              <button class="chapter-del" @click="pendingChapters.splice(idx, 1)">✕</button>
            </div>
          </div>
        </div>
        <footer class="organize-footer">
          <button class="action-btn" @click="cancelOrganize">取消</button>
          <button class="action-btn primary" @click="confirmImport">确认导入</button>
        </footer>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, onMounted, toRaw } from 'vue'
import { db } from '../db/database.js'
import { parseEpub } from '../services/epubParser.js'
import {
  exportBook, importBook, exportAll, importAll,
  downloadJson, readJsonFile
} from '../services/dataExport.js'
const emit = defineEmits(['bookOpened', 'bookDeleted', 'close'])
const books = ref([])
const showOrganize = ref(false)
const pendingTitle = ref('')
const pendingCover = ref(null)
const pendingChapters = ref([])
onMounted(loadBooks)
async function loadBooks() {
  const allBooks = await db.books.toArray()
  for (const b of allBooks) {
    b.chapterCount = await db.chapters.where('bookId').equals(b.id).count()
  }
  books.value = allBooks
}
async function handleImportEpub(e) {
  const file = e.target.files[0]
  if (!file) return
  e.target.value = ''
  try {
    const result = await parseEpub(file)
    pendingTitle.value = result.title
    pendingCover.value = result.cover
    pendingChapters.value = result.chapters.map(ch => ({ ...ch }))
    showOrganize.value = true
  } catch (err) {
    alert('EPUB 解析失败: ' + err.message)
  }
}
function cancelOrganize() {
  showOrganize.value = false
  pendingChapters.value = []
}
async function confirmImport() {
  if (pendingChapters.value.length === 0) {
    alert('至少保留一个章节')
    return
  }
  try {
    const bookId = await db.books.add({
      title: pendingTitle.value,
      cover: pendingCover.value,
      currentChapter: 0,
      createdAt: Date.now()
    })
    const rawChapters = JSON.parse(JSON.stringify(toRaw(pendingChapters.value)))
    const chapters = rawChapters.map((ch, idx) => ({
      bookId,
      title: ch.title,
      order: idx,
      paragraphs: ch.paragraphs
    }))
    await db.chapters.bulkAdd(chapters)
    showOrganize.value = false
    pendingChapters.value = []
    await loadBooks()
  } catch (err) {
    console.error('导入失败:', err)
    alert('导入失败: ' + err.message)
  }
}
function openBook(book) {
  emit('bookOpened', book)
  emit('close')
}
async function deleteBook(book) {
  const confirmed = confirm(`确定要删除《${book.title}》吗？

这会同时删除该书的章节、批注、评论、摘要和相关记忆。
此操作不可撤销。建议删除前先导出备份。`)
  if (!confirmed) return

  try {
    await db.transaction('rw', db.books, db.chapters, db.annotations, db.comments, db.memories, async () => {
      await db.annotations.where('bookId').equals(book.id).delete()
      await db.comments.where('bookId').equals(book.id).delete()
      await db.memories.where('bookId').equals(book.id).delete()
      await db.chapters.where('bookId').equals(book.id).delete()
      await db.books.delete(book.id)
    })
    await loadBooks()
    emit('bookDeleted', book.id)
    alert(`《${book.title}》已删除`)
  } catch (err) {
    console.error('删除失败:', err)
    alert('删除失败: ' + err.message)
  }
}
async function handleExportBook(book) {
  try {
    const data = await exportBook(book.id)
    const safeName = book.title.replace(/[<>:"/\\|?*]/g, '_')
    downloadJson(data, `共读-${safeName}.json`)
  } catch (e) {
    alert('导出失败: ' + e.message)
  }
}
async function handleExportAll() {
  try {
    const data = await exportAll()
    const date = new Date().toISOString().slice(0, 10)
    downloadJson(data, `共读-全量备份-${date}.json`)
  } catch (e) {
    alert('导出失败: ' + e.message)
  }
}
async function handleImportJson(e) {
  const file = e.target.files[0]
  if (!file) return
  e.target.value = ''
  try {
    const data = await readJsonFile(file)
    if (data.type === 'full-backup') {
      if (!confirm(`即将导入全量备份，包含 ${data.books?.length || 0} 本书、${data.fonts?.length || 0} 个字体。\n已有数据不会被覆盖，但设置会被替换。继续？`)) return
      const result = await importAll(data)
      alert(`导入完成：${result.books} 本书，${result.settings} 项设置，${result.fonts} 个字体`)
    } else if (data.type === 'single-book') {
      if (!confirm(`即将导入《${data.book?.title}》，包含 ${data.chapters?.length || 0} 章。继续？`)) return
      await importBook(data)
      alert(`《${data.book.title}》导入成功`)
    } else {
      alert('无法识别的备份文件格式')
      return
    }
    await loadBooks()
  } catch (e) {
    alert('导入失败: ' + e.message)
  }
}
</script>
<style scoped>
.bookshelf {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.shelf-toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.upload-label { cursor: pointer; }
.upload-btn {
  display: inline-block;
  font-size: 13px;
  padding: 6px 14px;
  border: 1px dashed var(--line-strong);
  letter-spacing: 0.05em;
  cursor: pointer;
}
.upload-btn:hover {
  border-style: solid;
  border-color: var(--accent);
  color: var(--accent);
}
.shelf-scroll {
  display: flex;
  gap: 18px;
  overflow-x: auto;
  padding: 10px 0 16px;
}
.book-card {
  flex-shrink: 0;
  width: 130px;
  cursor: pointer;
  text-align: center;
  position: relative;
}
.book-card:hover .book-actions { opacity: 1; }
.book-cover {
  width: 130px;
  height: 180px;
  border: 1px solid var(--line);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--paper-deep);
}
.book-cover img { width: 100%; height: 100%; object-fit: cover; }
.cover-placeholder {
  font-size: 36px;
  color: var(--ink-soft);
  letter-spacing: 0.1em;
}
.book-title {
  font-size: 13px;
  margin-top: 6px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.book-meta {
  font-size: 11px;
  color: var(--ink-soft);
}
.book-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.2s;
}
.card-btn {
  font-size: 12px;
  padding: 2px 5px;
  background: var(--paper);
  border: 1px solid var(--line);
  opacity: 0.7;
}
.card-btn:hover { opacity: 1; border-color: var(--accent); }
.card-btn.del:hover { border-color: var(--close-hover); color: var(--close-hover); }
.shelf-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-soft);
  font-size: 13px;
  padding: 40px 0;
}
/* 整理弹窗 */
.organize-overlay {
  position: fixed;
  inset: 0;
  background: rgba(47, 42, 34, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.organize-frame {
  background: var(--paper);
  width: min(680px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line-strong);
  outline: 3px double var(--line-strong);
  outline-offset: 3px;
}
.organize-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 3px double var(--line-strong);
  background: var(--paper-deep);
}
.organize-title { font-size: 15px; font-weight: normal; letter-spacing: 0.2em; }
.popup-close { font-size: 16px; color: var(--ink-soft); transition: color 0.2s; }
.popup-close:hover { color: var(--close-hover); }
.organize-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.organize-hint { font-size: 12px; color: var(--ink-soft); margin-bottom: 12px; line-height: 1.6; }
.organize-list { display: flex; flex-direction: column; gap: 6px; }
.organize-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border: 1px solid var(--line);
}
.organize-idx { font-size: 11px; color: var(--ink-soft); width: 24px; text-align: right; flex-shrink: 0; }
.organize-input {
  flex: 1; font-family: inherit; font-size: 13px;
  border: none; border-bottom: 1px solid var(--line);
  background: transparent; color: var(--ink); padding: 2px 4px;
}
.organize-input:focus { outline: none; border-color: var(--accent); }
.organize-count { font-size: 11px; color: var(--ink-soft); white-space: nowrap; }
.chapter-del { font-size: 13px; color: var(--ink-soft); padding: 2px 6px; transition: color 0.2s; }
.chapter-del:hover { color: var(--close-hover); }
.organize-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 12px 20px; border-top: 1px solid var(--line);
}
.action-btn {
  font-size: 13px; padding: 6px 18px;
  border: 1px solid var(--line-strong); letter-spacing: 0.1em;
}
.action-btn:hover { background: var(--paper-deep); }
.action-btn.primary { background: var(--line-strong); color: var(--paper); }
.action-btn.primary:hover { background: var(--ink); }
</style>
