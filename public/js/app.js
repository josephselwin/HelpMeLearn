// Application State
const state = {
  documents: [],
  history: [],
  whitelist: [],
  selectedFile: null,
  activeDoc: null,
  testSession: null,
  timerInterval: null,
  pendingDeleteDocId: null,
  activeDrawerQuote: null,
  currentUser: null
};

// DOM Initialization
document.addEventListener('DOMContentLoaded', () => {
  initDragAndDrop();
  checkAuthSession();
});

/**
 * Check Authentication Session
 */
async function checkAuthSession() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    if (data.authenticated && data.user) {
      state.currentUser = data.user;
      renderUserProfile(data.user);
      document.getElementById('auth-overlay').classList.add('hidden');

      // Unhide Whitelist Admin tab if user is admin
      if (data.user.role === 'admin') {
        document.getElementById('nav-users-btn').classList.remove('hidden');
      } else {
        document.getElementById('nav-users-btn').classList.add('hidden');
      }

      fetchDocuments();
      fetchHistory();
      fetchSettings();
    } else {
      state.currentUser = null;
      document.getElementById('auth-overlay').classList.remove('hidden');
      document.getElementById('user-profile-bar').classList.add('hidden');
      initGoogleLogin();
    }
  } catch (err) {
    console.error('[Auth Check Error]', err);
    document.getElementById('auth-overlay').classList.remove('hidden');
    initGoogleLogin();
  }
}

/**
 * Initialize Google Identity SDK Sign-In Button
 */
function initGoogleLogin() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
    setTimeout(initGoogleLogin, 500);
    return;
  }

  google.accounts.id.initialize({
    client_id: "1054173871402-sampleclientid.apps.googleusercontent.com", // Generic client_id for JWT verification
    callback: handleGoogleCredentialResponse,
    auto_select: false
  });

  google.accounts.id.renderButton(
    document.getElementById("google-signin-btn"),
    { theme: "outline", size: "large", shape: "pill", logo_alignment: "left" }
  );
}

/**
 * Google Sign-In Credential Callback Handler
 */
async function handleGoogleCredentialResponse(response) {
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });

    const data = await res.json();

    if (!res.ok) {
      document.getElementById('auth-error-banner').classList.remove('hidden');
      document.getElementById('auth-error-text').textContent = data.message || data.error;
      return;
    }

    document.getElementById('auth-error-banner').classList.add('hidden');
    showToast(`Welcome back, ${data.user.name}!`);
    checkAuthSession();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderUserProfile(user) {
  const profileBar = document.getElementById('user-profile-bar');
  profileBar.classList.remove('hidden');

  document.getElementById('user-display-name').textContent = user.name;
  document.getElementById('user-role-badge').textContent = user.role;

  const avatarImg = document.getElementById('user-avatar');
  if (user.picture) {
    avatarImg.src = user.picture;
    avatarImg.style.display = 'block';
  } else {
    avatarImg.style.display = 'none';
  }
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    showToast('Signed out successfully.');
    checkAuthSession();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Navigation Tab Switcher
 */
function switchTab(tabId) {
  const tabs = ['docs', 'quiz-config', 'quiz-engine', 'quiz-results', 'history', 'users'];
  tabs.forEach(t => {
    const pane = document.getElementById(`tab-${t}`);
    const navBtn = document.getElementById(`nav-${t}-btn`);
    if (pane) {
      if (t === tabId) {
        pane.classList.remove('hidden');
        pane.classList.add('active');
      } else {
        pane.classList.add('hidden');
        pane.classList.remove('active');
      }
    }
    if (navBtn) {
      if (t === tabId || (t === 'quiz-config' && tabId === 'quiz-config')) {
        navBtn.classList.add('active');
      } else {
        navBtn.classList.remove('active');
      }
    }
  });

  if (tabId === 'quiz-config') {
    populateDocSelect();
  } else if (tabId === 'history') {
    fetchHistory();
  } else if (tabId === 'users') {
    fetchWhitelist();
  }
}

/**
 * Toast Notifications
 */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check text-emerald' : 'fa-circle-exclamation text-rose'}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

// ----------------------------------------------------
// Document Upload & Drag-and-Drop
// ----------------------------------------------------
function initDragAndDrop() {
  const dropZone = document.getElementById('drop-zone');
  
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      document.getElementById('document-input').files = files;
      handleFileSelect({ target: { files } });
    }
  });
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  state.selectedFile = file;

  // Show File Preview
  document.getElementById('drop-zone-content').classList.add('hidden');
  document.getElementById('file-preview').classList.remove('hidden');
  document.getElementById('preview-filename').textContent = file.name;
  document.getElementById('preview-filesize').textContent = formatBytes(file.size);

  // Auto-fill title if empty
  const titleInput = document.getElementById('doc-title-input');
  if (!titleInput.value) {
    const defaultTitle = file.name.replace(/\.[^/.]+$/, "");
    titleInput.value = defaultTitle;
  }
}

function clearFileSelection(e) {
  if (e) e.stopPropagation();
  state.selectedFile = null;
  document.getElementById('document-input').value = '';
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('drop-zone-content').classList.remove('hidden');
  document.getElementById('doc-title-input').value = '';
}

async function handleUploadSubmit(event) {
  event.preventDefault();
  if (!state.selectedFile) {
    showToast('Please select a PDF or Word file first.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('document', state.selectedFile);
  formData.append('title', document.getElementById('doc-title-input').value || state.selectedFile.name);

  // Show loading spinner
  const submitBtn = document.getElementById('upload-submit-btn');
  const loadingOverlay = document.getElementById('upload-loading');
  submitBtn.disabled = true;
  loadingOverlay.classList.remove('hidden');

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to process document.');
    }

    showToast(`Successfully created test bank with ${data.questionCount} questions!`);
    clearFileSelection();
    await fetchDocuments();

    // Auto prompt to take test for newly uploaded document
    promptTakeTest(data.document.id);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    loadingOverlay.classList.add('hidden');
  }
}

// ----------------------------------------------------
// Documents Library & Stats
// ----------------------------------------------------
async function fetchDocuments() {
  try {
    const res = await fetch('/api/documents');
    const docs = await res.json();
    state.documents = docs;
    renderDocumentsList(docs);
    updateStats(docs);
  } catch (err) {
    console.error('Failed to fetch documents:', err);
  }
}

function renderDocumentsList(docs) {
  const container = document.getElementById('docs-list');

  if (!docs || docs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-folder-open empty-icon"></i>
        <h3>No Documents Processed Yet</h3>
        <p>Upload your first PDF or Word document on the left to generate questions!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = docs.map(doc => {
    const isPdf = doc.mime_type.includes('pdf') || doc.original_name.endsWith('.pdf');
    const fileIcon = isPdf ? 'fa-file-pdf text-pdf' : 'fa-file-word text-word';
    const dateStr = new Date(doc.created_at).toLocaleDateString();

    return `
      <div class="doc-card">
        <div class="doc-info">
          <div class="doc-type-icon">
            <i class="fa-solid ${fileIcon}"></i>
          </div>
          <div class="doc-details">
            <h3>${escapeHtml(doc.title)}</h3>
            <div class="doc-meta">
              <span><i class="fa-solid fa-lightbulb text-emerald"></i> <strong>${doc.question_count}</strong> Questions</span>
              <span><i class="fa-solid fa-file-lines"></i> ${doc.word_count || 0} Words</span>
              <span><i class="fa-regular fa-clock"></i> ${dateStr}</span>
            </div>
          </div>
        </div>

        <div class="doc-actions">
          <button class="btn btn-emerald btn-sm" onclick="startTestForDoc(${doc.id})">
            <i class="fa-solid fa-play"></i> Take Test
          </button>
          <button class="btn btn-secondary btn-sm" onclick="openDocQuestionsModal(${doc.id})" title="View Question Pool">
            <i class="fa-solid fa-eye"></i> Questions
          </button>
          <button class="btn-icon" onclick="openDeleteModal(${doc.id}, '${escapeHtml(doc.title)}')" title="Delete Document & Tests">
            <i class="fa-solid fa-trash-can text-rose"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function filterDocuments() {
  const query = document.getElementById('doc-search-input').value.toLowerCase();
  const filtered = state.documents.filter(d => 
    d.title.toLowerCase().includes(query) || 
    d.original_name.toLowerCase().includes(query)
  );
  renderDocumentsList(filtered);
}

function updateStats(docs) {
  document.getElementById('stat-docs-count').textContent = docs.length;
  const totalQ = docs.reduce((acc, d) => acc + (d.question_count || 0), 0);
  document.getElementById('stat-questions-count').textContent = totalQ;
}

// ----------------------------------------------------
// Quiz Configuration
// ----------------------------------------------------
function populateDocSelect() {
  const select = document.getElementById('config-doc-select');
  select.innerHTML = '<option value="">-- Select a document --</option>';

  state.documents.forEach(doc => {
    const opt = document.createElement('option');
    opt.value = doc.id;
    opt.textContent = `${doc.title} (${doc.question_count} questions)`;
    select.appendChild(opt);
  });

  if (state.activeDoc) {
    select.value = state.activeDoc.id;
    updateConfigPreview();
  }
}

function updateConfigPreview() {
  const select = document.getElementById('config-doc-select');
  const docId = parseInt(select.value, 10);
  const summaryBox = document.getElementById('config-doc-summary');

  const doc = state.documents.find(d => d.id === docId);
  if (doc) {
    state.activeDoc = doc;
    summaryBox.classList.remove('hidden');
    document.getElementById('config-bank-total').textContent = doc.question_count || 0;
    document.getElementById('config-word-count').textContent = doc.word_count || 0;
    document.getElementById('config-tests-taken').textContent = doc.total_tests_taken || 0;
  } else {
    summaryBox.classList.add('hidden');
  }
}

function startTestForDoc(docId) {
  const doc = state.documents.find(d => d.id === docId);
  if (doc) {
    state.activeDoc = doc;
    switchTab('quiz-config');
  }
}

function promptTakeTest(docId) {
  startTestForDoc(docId);
}

// ----------------------------------------------------
// Interactive Quiz Engine
// ----------------------------------------------------
async function startTestSession(event) {
  event.preventDefault();
  const select = document.getElementById('config-doc-select');
  const docId = select.value;

  if (!docId) {
    showToast('Please select a document.', 'error');
    return;
  }

  const countOpt = document.querySelector('input[name="question-count-opt"]:checked').value;
  const instantFeedback = document.getElementById('config-instant-feedback').checked;

  try {
    const res = await fetch('/api/tests/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: docId, count: countOpt })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    state.testSession = {
      documentId: docId,
      documentTitle: data.document.title,
      questions: data.questions,
      currentIndex: 0,
      userAnswers: {}, // questionId -> selectedOption (0..3)
      instantFeedback,
      startTime: Date.now(),
      timeTakenSeconds: 0
    };

    // Reset Timer
    clearInterval(state.timerInterval);
    state.timerInterval = setInterval(updateQuizTimer, 1000);

    // Render Quiz Engine
    switchTab('quiz-engine');
    document.getElementById('quiz-doc-name').textContent = data.document.title;
    document.getElementById('quiz-total-num').textContent = data.questions.length;

    renderQuizQuestion();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updateQuizTimer() {
  if (!state.testSession) return;
  const elapsed = Math.floor((Date.now() - state.testSession.startTime) / 1000);
  state.testSession.timeTakenSeconds = elapsed;
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  document.getElementById('quiz-timer-text').textContent = `${mins}:${secs}`;
}

function renderQuizQuestion() {
  const s = state.testSession;
  if (!s || !s.questions[s.currentIndex]) return;

  const q = s.questions[s.currentIndex];
  const qNum = s.currentIndex + 1;

  document.getElementById('quiz-current-num').textContent = qNum;
  document.getElementById('quiz-q-difficulty').textContent = q.difficulty || 'medium';
  document.getElementById('quiz-question-text').textContent = `${qNum}. ${q.question_text}`;

  // Progress Bar & Stats
  const percent = (qNum / s.questions.length) * 100;
  document.getElementById('quiz-progress-fill').style.width = `${percent}%`;

  const answeredCount = Object.keys(s.userAnswers).length;
  document.getElementById('quiz-answered-count').textContent = `${answeredCount}/${s.questions.length} Answered`;

  // Render Options
  const container = document.getElementById('quiz-options-container');
  const options = [
    { text: q.option_a, index: 0, letter: 'A' },
    { text: q.option_b, index: 1, letter: 'B' },
    { text: q.option_c, index: 2, letter: 'C' },
    { text: q.option_d, index: 3, letter: 'D' }
  ];

  const selectedOpt = s.userAnswers[q.id];

  container.innerHTML = options.map(opt => {
    const isSelected = selectedOpt === opt.index;
    return `
      <div class="option-card ${isSelected ? 'selected' : ''}" onclick="selectOption(${opt.index})">
        <div class="option-letter">${opt.letter}</div>
        <div class="option-label">${escapeHtml(opt.text)}</div>
      </div>
    `;
  }).join('');

  // Manage Prev / Next Buttons
  document.getElementById('quiz-prev-btn').disabled = s.currentIndex === 0;
  
  if (s.currentIndex === s.questions.length - 1) {
    document.getElementById('quiz-next-btn').classList.add('hidden');
    document.getElementById('quiz-submit-btn').classList.remove('hidden');
  } else {
    document.getElementById('quiz-next-btn').classList.remove('hidden');
    document.getElementById('quiz-submit-btn').classList.add('hidden');
  }

  // Instant Feedback Panel
  document.getElementById('quiz-instant-feedback-panel').classList.add('hidden');
}

function selectOption(optIndex) {
  const s = state.testSession;
  if (!s) return;

  const currentQ = s.questions[s.currentIndex];
  s.userAnswers[currentQ.id] = optIndex;

  renderQuizQuestion();
}

function navigateQuizQuestion(step) {
  const s = state.testSession;
  if (!s) return;

  const nextIdx = s.currentIndex + step;
  if (nextIdx >= 0 && nextIdx < s.questions.length) {
    s.currentIndex = nextIdx;
    renderQuizQuestion();
  }
}

// ----------------------------------------------------
// Submit & Grade Test
// ----------------------------------------------------
async function confirmSubmitQuiz() {
  const s = state.testSession;
  if (!s) return;

  const answeredCount = Object.keys(s.userAnswers).length;
  if (answeredCount < s.questions.length) {
    if (!confirm(`You have answered ${answeredCount} of ${s.questions.length} questions. Do you want to submit anyway?`)) {
      return;
    }
  }

  clearInterval(state.timerInterval);

  const payload = {
    documentId: s.documentId,
    timeTakenSeconds: s.timeTakenSeconds,
    userAnswers: s.questions.map(q => ({
      questionId: q.id,
      selectedOption: s.userAnswers[q.id] !== undefined ? s.userAnswers[q.id] : -1
    }))
  };

  try {
    const res = await fetch('/api/tests/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    renderTestResults(data);
    fetchHistory();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// Test Results & Review Accordion
// ----------------------------------------------------
function renderTestResults(data) {
  switchTab('quiz-results');

  document.getElementById('results-percentage').textContent = `${data.percentage}%`;
  document.getElementById('results-correct-count').textContent = data.score;
  document.getElementById('results-incorrect-count').textContent = data.totalQuestions - data.score;
  document.getElementById('results-time-text').textContent = `${data.timeTakenSeconds}s`;

  // Animate Circle Progress
  const circle = document.getElementById('results-circle-progress');
  const circumference = 326.7;
  const offset = circumference - (data.percentage / 100) * circumference;
  circle.style.strokeDashoffset = offset;

  // Title feedback
  if (data.percentage >= 80) {
    document.getElementById('results-title').textContent = '🌟 Excellent Work!';
  } else if (data.percentage >= 60) {
    document.getElementById('results-title').textContent = '👍 Good Effort!';
  } else {
    document.getElementById('results-title').textContent = '📖 Room for Improvement!';
  }

  // Render Detailed Review List
  const reviewContainer = document.getElementById('results-review-list');
  reviewContainer.innerHTML = data.results.map((item, idx) => {
    const letters = ['A', 'B', 'C', 'D'];
    const userSelectedText = item.selectedOption >= 0 ? item.options[item.selectedOption] : 'No Answer Selected';
    const correctText = item.options[item.correct_option];

    return `
      <div class="review-item ${item.isCorrect ? 'correct-border' : 'incorrect-border'}">
        <div class="review-question-header">
          <span>Q${idx + 1}. ${escapeHtml(item.question_text)}</span>
          <span class="badge ${item.isCorrect ? 'text-emerald' : 'text-rose'}">
            <i class="fa-solid ${item.isCorrect ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
            ${item.isCorrect ? 'Correct' : 'Incorrect'}
          </span>
        </div>

        <div class="mt-2 small">
          <div><strong>Your Choice:</strong> <span class="${item.isCorrect ? 'text-emerald' : 'text-rose'}">${item.selectedOption >= 0 ? letters[item.selectedOption] + ') ' : ''}${escapeHtml(userSelectedText)}</span></div>
          ${!item.isCorrect ? `<div><strong>Correct Choice:</strong> <span class="text-emerald">${letters[item.correct_option]}) ${escapeHtml(correctText)}</span></div>` : ''}
        </div>

        <div class="review-explanation-box">
          <strong><i class="fa-solid fa-lightbulb text-emerald"></i> Why this is ${item.isCorrect ? 'Right' : 'Wrong'}:</strong>
          <p class="mt-1">${escapeHtml(item.explanation)}</p>
          
          ${item.quote_reference ? `
            <button class="btn btn-secondary btn-sm mt-3" onclick="openQuoteDrawer('${escapeJsString(item.quote_reference)}', '${escapeJsString(item.explanation)}')">
              <i class="fa-solid fa-quote-left text-emerald"></i> View Supporting Document Quote
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ----------------------------------------------------
// Document Citation Quote Drawer
// ----------------------------------------------------
function openQuoteDrawer(quote, explanation) {
  document.getElementById('drawer-quote-text').textContent = `"${quote}"`;
  document.getElementById('drawer-explanation-text').textContent = explanation;

  document.getElementById('quote-drawer-overlay').classList.remove('hidden');
  document.getElementById('quote-drawer').classList.add('open');
}

function closeQuoteDrawer() {
  document.getElementById('quote-drawer').classList.remove('open');
  document.getElementById('quote-drawer-overlay').classList.add('hidden');
}

function openQuoteDrawerCurrent() {
  const s = state.testSession;
  if (!s) return;
  const currentQ = s.questions[s.currentIndex];
  openQuoteDrawer(currentQ.quote_reference || 'Quote excerpt not available.', currentQ.explanation || '');
}

// ----------------------------------------------------
// Questions Bank Modal
// ----------------------------------------------------
async function openDocQuestionsModal(docId) {
  try {
    const res = await fetch(`/api/documents/${docId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    document.getElementById('modal-doc-title').textContent = `${data.document.title} - Question Bank (${data.questions.length})`;
    const body = document.getElementById('modal-doc-questions-body');

    body.innerHTML = data.questions.map((q, idx) => `
      <div class="glass-panel mb-3">
        <h4>Q${idx + 1}: ${escapeHtml(q.question_text)}</h4>
        <ul class="mt-2" style="list-style: none; padding-left: 0;">
          <li>A) ${escapeHtml(q.option_a)} ${q.correct_option === 0 ? '✔️' : ''}</li>
          <li>B) ${escapeHtml(q.option_b)} ${q.correct_option === 1 ? '✔️' : ''}</li>
          <li>C) ${escapeHtml(q.option_c)} ${q.correct_option === 2 ? '✔️' : ''}</li>
          <li>D) ${escapeHtml(q.option_d)} ${q.correct_option === 3 ? '✔️' : ''}</li>
        </ul>
        <div class="small text-muted mt-2"><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</div>
      </div>
    `).join('');

    document.getElementById('doc-questions-modal').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closeDocQuestionsModal() {
  document.getElementById('doc-questions-modal').classList.add('hidden');
}

// ----------------------------------------------------
// Document & Test Delete Confirmation
// ----------------------------------------------------
function openDeleteModal(docId, docTitle) {
  state.pendingDeleteDocId = docId;
  document.getElementById('delete-doc-name').textContent = docTitle;
  document.getElementById('delete-modal').classList.remove('hidden');

  document.getElementById('confirm-delete-btn').onclick = deleteDocument;
}

function closeDeleteModal() {
  document.getElementById('delete-modal').classList.add('hidden');
  state.pendingDeleteDocId = null;
}

async function deleteDocument() {
  if (!state.pendingDeleteDocId) return;

  try {
    const res = await fetch(`/api/documents/${state.pendingDeleteDocId}`, {
      method: 'DELETE'
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message);
    closeDeleteModal();
    fetchDocuments();
    fetchHistory();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// Test Performance History
// ----------------------------------------------------
async function fetchHistory() {
  try {
    const res = await fetch('/api/tests/history');
    const attempts = await res.json();
    state.history = attempts;
    renderHistory(attempts);

    document.getElementById('stat-tests-count').textContent = attempts.length;
  } catch (err) {
    console.error('Failed to fetch history:', err);
  }
}

function renderHistory(attempts) {
  const container = document.getElementById('history-list');

  if (!attempts || attempts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-clock-rotate-left empty-icon"></i>
        <h3>No Test Attempts Yet</h3>
        <p>Complete your first practice exam to see score analytics here!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = attempts.map(att => {
    const dateStr = new Date(att.created_at).toLocaleString();
    const isPassed = att.percentage >= 70;

    return `
      <div class="glass-panel mb-3 flex-between">
        <div>
          <h3>${escapeHtml(att.document_title)}</h3>
          <div class="text-muted small">
            <span><i class="fa-regular fa-clock"></i> ${dateStr}</span> | 
            <span>Duration: ${att.time_taken_seconds || 0}s</span>
          </div>
        </div>

        <div class="text-right">
          <div class="res-val ${isPassed ? 'text-emerald' : 'text-rose'}">${att.percentage}%</div>
          <div class="small text-muted">${att.score} / ${att.total_questions} Correct</div>
        </div>
      </div>
    `;
  }).join('');
}

// ----------------------------------------------------
// AI Settings & Azure Configuration Modal
// ----------------------------------------------------
function openSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

function toggleProviderSettings() {
  const provider = document.getElementById('setting-provider').value;
  const apiKeyGroup = document.getElementById('api-key-group');
  const azureGroup = document.getElementById('azure-group');

  if (provider === 'offline') {
    apiKeyGroup.classList.add('hidden');
    azureGroup.classList.add('hidden');
  } else if (provider === 'azure') {
    apiKeyGroup.classList.remove('hidden');
    azureGroup.classList.remove('hidden');
  } else {
    apiKeyGroup.classList.remove('hidden');
    azureGroup.classList.add('hidden');
  }
}

async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    document.getElementById('setting-provider').value = settings.provider || 'offline';
    toggleProviderSettings();
  } catch (e) {
    console.error('Settings fetch error:', e);
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const provider = document.getElementById('setting-provider').value;
  const apiKey = document.getElementById('setting-apikey').value;
  const azureEndpoint = document.getElementById('setting-azure-endpoint').value;
  const azureDeployment = document.getElementById('setting-azure-deployment').value;

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey, azureEndpoint, azureDeployment })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('AI Settings updated!');
    closeSettingsModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// Admin Whitelist Management UI
// ----------------------------------------------------
async function fetchWhitelist() {
  try {
    const res = await fetch('/api/auth/whitelist');
    const users = await res.json();
    if (!res.ok) throw new Error(users.error);

    state.whitelist = users;
    renderWhitelist(users);
  } catch (err) {
    console.error('Fetch whitelist error:', err);
  }
}

function renderWhitelist(users) {
  const tbody = document.getElementById('whitelist-tbody');
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No users in whitelist. Click "Grant Access to User" to add emails.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    const dateStr = new Date(u.created_at).toLocaleDateString();
    const isSelf = state.currentUser && state.currentUser.email.toLowerCase() === u.email.toLowerCase();

    return `
      <tr>
        <td><strong>${escapeHtml(u.email)}</strong></td>
        <td>${escapeHtml(u.name || '-')}</td>
        <td><span class="badge ${u.role === 'admin' ? 'text-emerald' : 'text-muted'}">${u.role.toUpperCase()}</span></td>
        <td>${dateStr}</td>
        <td>
          ${!isSelf ? `
            <button class="btn-icon" onclick="revokeAccess(${u.id}, '${escapeJsString(u.email)}')" title="Revoke Access">
              <i class="fa-solid fa-user-minus text-rose"></i>
            </button>
          ` : '<span class="small text-muted">(You)</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

function openAddUserModal() {
  document.getElementById('add-user-modal').classList.remove('hidden');
}

function closeAddUserModal() {
  document.getElementById('add-user-modal').classList.add('hidden');
  document.getElementById('new-user-email').value = '';
  document.getElementById('new-user-name').value = '';
}

async function handleAddUserSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('new-user-email').value;
  const name = document.getElementById('new-user-name').value;
  const role = document.getElementById('new-user-role').value;

  try {
    const res = await fetch('/api/auth/whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message);
    closeAddUserModal();
    fetchWhitelist();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function revokeAccess(userId, email) {
  if (!confirm(`Are you sure you want to revoke access for ${email}?`)) return;

  try {
    const res = await fetch(`/api/auth/whitelist/${userId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message);
    fetchWhitelist();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Helper Utilities
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJsString(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ');
}
