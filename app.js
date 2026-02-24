const PROFILE_KEY = 'daily-language-profile-id';
const PREFS_KEY = 'daily-language-preferences-v2';

const fallbackCategories = [
  { id: 'vocabulary', label: '📖 Kata' },
  { id: 'sentences', label: '💬 Kalimat' },
  { id: 'conversation', label: '🗣 Percakapan' },
  { id: 'grammar', label: '🧠 Grammar dasar' }
];
const fallbackLanguages = ['Indonesia', 'English', 'Japanese', 'Korean'];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getProfileId() {
  let profileId = localStorage.getItem(PROFILE_KEY);
  if (!profileId) {
    profileId = `profile-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(PROFILE_KEY, profileId);
  }
  return profileId;
}

function loadPrefs() {
  const raw = localStorage.getItem(PREFS_KEY);
  if (!raw) {
    return {
      nativeLanguage: 'Indonesia',
      targetLanguage: 'English',
      category: 'all',
      showUndoneOnly: false
    };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { nativeLanguage: 'Indonesia', targetLanguage: 'English', category: 'all', showUndoneOnly: false };
  }
}

function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

async function apiGet(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

async function apiPost(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

function setThemeFromStorage() {
  const theme = localStorage.getItem('daily-language-theme') || 'light';
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function setupThemeToggle() {
  const button = document.getElementById('themeToggle');
  if (!button) return;
  button.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('daily-language-theme', isDark ? 'dark' : 'light');
  });
}

function populateSelect(select, options, selectedValue, isString = false) {
  if (!select) return;
  select.innerHTML = '';
  options.forEach(option => {
    const element = document.createElement('option');
    const value = isString ? option : option.id;
    const label = isString ? option : option.label;
    element.value = value;
    element.textContent = label;
    if (value === selectedValue) element.selected = true;
    select.appendChild(element);
  });
}

function setStatus(message, mode = 'info') {
  const statusEl = document.getElementById('statusMessage');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = 'mb-4 text-sm rounded-xl px-3 py-2';
  if (mode === 'success') {
    statusEl.classList.add('bg-emerald-50', 'text-emerald-700', 'dark:bg-emerald-900/30', 'dark:text-emerald-200');
  } else if (mode === 'error') {
    statusEl.classList.add('bg-red-50', 'text-red-700', 'dark:bg-red-900/30', 'dark:text-red-200');
  } else {
    statusEl.classList.add('bg-brand-50', 'text-brand-700', 'dark:bg-brand-500/20', 'dark:text-brand-100');
  }
}

function setBusy(isBusy) {
  ['flipButton', 'learnedButton', 'difficultButton', 'resetButton'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = isBusy;
  });
}

async function initLearnPage() {
  const flashcard = document.getElementById('flashcard');
  if (!flashcard) return;

  const profileId = getProfileId();
  const profileBadge = document.getElementById('profileBadge');
  if (profileBadge) profileBadge.textContent = `ID Belajar: ${profileId}`;

  const date = todayKey();
  const prefs = loadPrefs();

  let languages = fallbackLanguages;
  let categories = fallbackCategories;
  try {
    const meta = await apiGet('/api/meta');
    languages = meta.languages;
    categories = meta.categories;
  } catch {
    setStatus('Backend tidak tersambung. Jalankan server dengan `npm start`.', 'error');
  }

  const nativeLanguageSelect = document.getElementById('nativeLanguage');
  const targetLanguageSelect = document.getElementById('targetLanguage');
  const categoryFilter = document.getElementById('categoryFilter');
  const undoneOnlyCheckbox = document.getElementById('undoneOnly');

  populateSelect(nativeLanguageSelect, languages, prefs.nativeLanguage, true);
  populateSelect(targetLanguageSelect, languages, prefs.targetLanguage, true);
  populateSelect(categoryFilter, [{ id: 'all', label: 'Semua kategori' }, ...categories], prefs.category);
  undoneOnlyCheckbox.checked = prefs.showUndoneOnly;

  const targetText = document.getElementById('targetText');
  const nativeText = document.getElementById('nativeText');
  const exampleText = document.getElementById('exampleText');
  const categoryBadge = document.getElementById('categoryBadge');
  const dailyInfo = document.getElementById('dailyInfo');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');

  let cards = [];
  let totalAllCards = 0;
  let learnedToday = 0;
  let index = 0;

  async function loadCards() {
    setBusy(true);
    setStatus('Memuat kartu harian...', 'info');
    const query = new URLSearchParams({
      profileId,
      date,
      native: nativeLanguageSelect.value,
      target: targetLanguageSelect.value,
      category: categoryFilter.value,
      undoneOnly: String(undoneOnlyCheckbox.checked)
    });

    try {
      const result = await apiGet(`/api/cards?${query.toString()}`);
      cards = result.cards;
      totalAllCards = result.totalAllCards;
      learnedToday = result.learnedToday;
      index = 0;
      renderCard();
      updateProgress();
      setStatus('Kartu siap dipelajari. Klik Balik Kartu untuk melihat terjemahan.', 'success');
    } catch {
      setStatus('Gagal memuat kartu. Cek koneksi backend.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function updateProgress() {
    const percent = totalAllCards ? Math.round((learnedToday / totalAllCards) * 100) : 0;
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${percent}% • ${learnedToday}/${totalAllCards} kartu`;
  }

  function renderCard() {
    if (!cards.length) {
      targetText.textContent = 'Tidak ada kartu untuk filter ini';
      nativeText.textContent = 'Ubah kategori/filter untuk melihat kartu lain.';
      exampleText.textContent = 'Tip: matikan filter "belum dipelajari" untuk melihat semua kartu.';
      categoryBadge.textContent = 'Kosong';
      dailyInfo.textContent = `${date} • 0/0`;
      return;
    }
    index = index % cards.length;
    const card = cards[index];
    const category = categories.find(item => item.id === card.category);
    targetText.textContent = card.target;
    nativeText.textContent = card.native;
    exampleText.textContent = card.example;
    categoryBadge.textContent = category ? category.label : card.category;
    dailyInfo.textContent = `${date} • ${index + 1}/${cards.length}`;
  }

  async function mark(status) {
    if (!cards.length) return;
    const card = cards[index % cards.length];
    setBusy(true);
    try {
      await apiPost('/api/progress/mark', { profileId, date, cardId: card.id, status });
      if (status === 'learned') {
        setStatus('Mantap! Kartu ditandai sudah dipelajari.', 'success');
      } else {
        setStatus('Kartu ditandai belum paham. Kamu bisa ulangi lagi nanti.', 'info');
      }
      flashcard.classList.remove('is-flipped');
      await loadCards();
    } catch {
      setStatus('Gagal menyimpan progress.', 'error');
      setBusy(false);
    }
  }

  document.getElementById('learnedButton').addEventListener('click', () => mark('learned'));
  document.getElementById('difficultButton').addEventListener('click', () => mark('difficult'));
  document.getElementById('flipButton').addEventListener('click', () => flashcard.classList.toggle('is-flipped'));
  document.getElementById('resetButton').addEventListener('click', async () => {
    setBusy(true);
    try {
      await apiPost('/api/progress/reset', { profileId });
      setStatus('Progress berhasil direset.', 'success');
      await loadCards();
    } catch {
      setStatus('Gagal reset progress.', 'error');
      setBusy(false);
    }
  });

  [nativeLanguageSelect, targetLanguageSelect, categoryFilter, undoneOnlyCheckbox].forEach(element => {
    element.addEventListener('change', async () => {
      prefs.nativeLanguage = nativeLanguageSelect.value;
      prefs.targetLanguage = targetLanguageSelect.value;
      prefs.category = categoryFilter.value;
      prefs.showUndoneOnly = undoneOnlyCheckbox.checked;
      savePrefs(prefs);
      await loadCards();
    });
  });

  await loadCards();
}

async function initStatsPage() {
  const totalLearnedEl = document.getElementById('totalLearned');
  if (!totalLearnedEl) return;

  try {
    const profileId = getProfileId();
    const stats = await apiGet(`/api/progress/${profileId}`);

    totalLearnedEl.textContent = String(stats.totalLearned);
    document.getElementById('completionRate').textContent = `${stats.completionRate}%`;
    document.getElementById('streakCount').textContent = `${stats.streak} hari`;
    document.getElementById('difficultCount').textContent = String(stats.difficultToday);

    const todayPercent = stats.totalCards ? Math.round((stats.learnedToday / stats.totalCards) * 100) : 0;
    document.getElementById('statsProgressBar').style.width = `${todayPercent}%`;
    document.getElementById('statsProgressText').textContent = `${todayPercent}% selesai hari ini (${stats.learnedToday}/${stats.totalCards} kartu)`;
  } catch {
    document.getElementById('statsProgressText').textContent = 'Gagal memuat statistik. Pastikan backend berjalan.';
  }
}

function initGlobal() {
  setThemeFromStorage();
  setupThemeToggle();
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
}

document.addEventListener('DOMContentLoaded', async () => {
  initGlobal();
  await initLearnPage();
  await initStatsPage();
});
