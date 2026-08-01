/**
 * Alternance Hunter — Dashboard Frontend Logic
 */

const API_BASE = '';
let allJobs = [];
let selectedJobId = null;
let filterDebounceTimer = null;

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  // Close detail panel initially
  document.getElementById('main-content').classList.add('detail-closed');
});

// ===== DATA LOADING =====
async function loadData() {
  try {
    await Promise.all([loadStats(), loadJobs()]);
  } catch (error) {
    showToast('Erreur de chargement : ' + error.message, 'error');
  }
}

async function loadStats() {
  const res = await fetch(`${API_BASE}/api/stats`);
  const data = await res.json();

  if (!data.success) return;
  const s = data.stats;

  animateValue('stat-total', s.total);
  animateValue('stat-today', s.todayCount);
  animateValue('stat-highMatch', s.highMatch);
  animateValue('stat-avgScore', s.avgScore + '%');
  animateValue('stat-applied', s.byStatus?.applied || 0);
}

async function loadJobs() {
  const params = new URLSearchParams();
  const search = document.getElementById('filter-search').value;
  const source = document.getElementById('filter-source').value;
  const status = document.getElementById('filter-status').value;
  const minScore = document.getElementById('filter-score').value;
  const sortBy = document.getElementById('filter-sort').value;

  if (search) params.set('search', search);
  if (source) params.set('source', source);
  if (status) params.set('status', status);
  if (minScore) params.set('minScore', minScore);
  if (sortBy) params.set('sortBy', sortBy);
  params.set('sortOrder', 'DESC');
  params.set('limit', '200');

  const res = await fetch(`${API_BASE}/api/jobs?${params}`);
  const data = await res.json();

  if (!data.success) return;

  allJobs = data.jobs;
  renderJobs(allJobs);
  renderKanban(allJobs);
}

// ===== VIEW TOGGLE =====
function switchView(viewName) {
  // Update tabs
  document.getElementById('tab-list').classList.remove('active');
  document.getElementById('tab-kanban').classList.remove('active');
  document.getElementById(`tab-${viewName}`).classList.add('active');

  // Update views
  document.getElementById('list-view').classList.remove('active-view');
  document.getElementById('kanban-view').classList.remove('active-view');
  document.getElementById('list-view').classList.add('hidden-view');
  document.getElementById('kanban-view').classList.add('hidden-view');

  document.getElementById(`${viewName}-view`).classList.remove('hidden-view');
  document.getElementById(`${viewName}-view`).classList.add('active-view');
}

// ===== RENDERING =====
function renderJobs(jobs) {
  const container = document.getElementById('jobs-container');
  const countBadge = document.getElementById('job-count');
  countBadge.textContent = jobs.length;

  if (jobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>Aucune offre trouvée. Lancez un scrape pour commencer !</p>
      </div>
    `;
    return;
  }

  container.innerHTML = jobs.map(job => {
    const scoreClass = job.matching_score >= 70 ? 'score-high' : job.matching_score >= 40 ? 'score-mid' : 'score-low';
    const statusLabel = getStatusLabel(job.status);
    const sourceClass = `source-${job.source}`;
    const statusClass = `status-${job.status}`;
    const isActive = job.id === selectedJobId ? 'active' : '';
    const timeAgo = formatTimeAgo(job.scraped_at);

    return `
      <div class="job-card ${isActive}" onclick="selectJob('${job.id}')" data-id="${job.id}">
        <div class="job-score ${scoreClass}">${job.matching_score}%</div>
        <div class="job-info">
          <div class="job-title" title="${escapeHtml(job.title)}">${escapeHtml(job.title)}</div>
          <div class="job-meta">
            <span>🏢 ${escapeHtml(job.company)}</span>
            <span>📍 ${escapeHtml(job.location || 'Non précisé')}</span>
            <span>🕐 ${timeAgo}</span>
          </div>
        </div>
        <div class="job-actions">
          <span class="source-tag ${sourceClass}">${job.source}</span>
          <span class="status-tag ${statusClass}">${statusLabel}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ===== JOB DETAIL =====
function selectJob(id) {
  selectedJobId = id;
  const job = allJobs.find(j => j.id === id);
  if (!job) return;

  // Mark active card
  document.querySelectorAll('.job-card').forEach(c => c.classList.remove('active'));
  document.querySelector(`.job-card[data-id="${id}"]`)?.classList.add('active');

  // Show detail panel
  const panel = document.getElementById('job-detail');
  panel.classList.remove('hidden');
  document.getElementById('main-content').classList.remove('detail-closed');

  const scoreEl = document.getElementById('detail-score');
  scoreEl.textContent = job.matching_score + '%';

  let matchedSkills = [];
  try { matchedSkills = JSON.parse(job.matched_skills || '[]'); } catch {}

  const content = document.getElementById('detail-content');
  content.innerHTML = `
    <h3 class="detail-title">${escapeHtml(job.title)}</h3>
    <div class="detail-company">🏢 ${escapeHtml(job.company)}</div>

    <div class="detail-meta">
      <div class="detail-meta-item">📍 ${escapeHtml(job.location || 'Non précisé')}</div>
      <div class="detail-meta-item">📋 ${escapeHtml(job.contract_type || 'Alternance')}</div>
      ${job.salary ? `<div class="detail-meta-item">💰 ${escapeHtml(job.salary)}</div>` : ''}
      <div class="detail-meta-item">🕐 Scraped ${formatTimeAgo(job.scraped_at)}</div>
      <div class="detail-meta-item">📄 CV recommandé : <strong>${job.cv_used || 'devops'}</strong></div>
    </div>

    ${matchedSkills.length > 0 ? `
      <div class="detail-section">
        <h4>Compétences matchées</h4>
        <div class="detail-skills">
          ${matchedSkills.map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join('')}
        </div>
      </div>
    ` : ''}

    <div class="detail-section">
      <h4>Description</h4>
      <div class="detail-description">${escapeHtml(job.description || job.full_description || 'Pas de description disponible').replace(/\n/g, '<br>')}</div>
    </div>

    <div class="detail-actions">
      <h4>Changer le statut :</h4>
      <select id="update-status" onchange="updateJobStatus('${job.id}', this.value)">
        <option value="new" ${job.status === 'new' ? 'selected' : ''}>Nouveau</option>
        <option value="lm_generated" ${job.status === 'lm_generated' ? 'selected' : ''}>LM Générée</option>
        <option value="applied" ${job.status === 'applied' ? 'selected' : ''}>Postulé</option>
        <option value="interview" ${job.status === 'interview' ? 'selected' : ''}>Entretien</option>
        <option value="rejected" ${job.status === 'rejected' ? 'selected' : ''}>Refusé</option>
      </select>
    </div>

    <div class="detail-actions" style="margin-top: 15px; display: flex; flex-direction: column; gap: 10px;">
      ${generateApplyButtons(job)}
      
      <button class="btn btn-primary" onclick="viewCoverLetter('${job.id}')" style="margin-top: 10px;">
        <span class="btn-icon">✍️</span> ${job.cover_letter ? 'Voir la LM' : 'Générer la LM'}
      </button>
    </div>

    <div class="detail-section detail-notes">
      <h4>Notes</h4>
      <textarea id="detail-notes" placeholder="Ajouter des notes..." onblur="saveNotes('${job.id}')">${escapeHtml(job.notes || '')}</textarea>
    </div>
  `;
}

function generateApplyButtons(job) {
  let alternateUrls = [];
  try { alternateUrls = JSON.parse(job.alternate_urls || '[]'); } catch {}
  let alternateSources = [];
  try { alternateSources = JSON.parse(job.alternate_sources || '[]'); } catch {}

  const allLinks = [];
  allLinks.push({ url: job.url, source: job.source });
  for (let i = 0; i < alternateUrls.length; i++) {
    allLinks.push({ url: alternateUrls[i], source: alternateSources[i] });
  }

  return allLinks.map(l => 
    `<a href="${escapeHtml(l.url)}" target="_blank" class="btn btn-secondary source-${l.source}" style="text-align: center; display: block;">
       Postuler via ${l.source}
     </a>`
  ).join('');
}

// ===== KANBAN =====
function renderKanban(jobs) {
  const columns = ['new', 'lm_generated', 'applied', 'interview', 'rejected'];
  
  columns.forEach(status => {
    const colJobs = jobs.filter(j => j.status === status);
    const container = document.getElementById(`k-col-${status}`);
    const countEl = document.querySelector(`.k-column[data-status="${status}"] .k-count`);
    
    if (countEl) countEl.textContent = colJobs.length;
    if (container) {
      container.innerHTML = colJobs.map(job => {
        
        let alternateSources = [];
        try { alternateSources = JSON.parse(job.alternate_sources || '[]'); } catch {}
        const sourcesHTML = [job.source, ...alternateSources].map(s => 
          `<span class="source-tag source-${s}" style="padding: 2px 6px; font-size: 0.65rem;">${s}</span>`
        ).join('');

        return `
          <div class="k-card" onclick="selectJobFromKanban('${job.id}')">
            <div class="k-card-title" title="${escapeHtml(job.title)}">${escapeHtml(job.title).substring(0, 40)}${job.title.length > 40 ? '...' : ''}</div>
            <div class="k-card-company">🏢 ${escapeHtml(job.company)}</div>
            <div class="k-card-meta">
              <span class="job-score ${job.matching_score >= 70 ? 'score-high' : job.matching_score >= 40 ? 'score-mid' : 'score-low'}">${job.matching_score}%</span>
              <span>${formatTimeAgo(job.scraped_at)}</span>
            </div>
            <div class="source-badges">${sourcesHTML}</div>
          </div>
        `;
      }).join('');
    }
  });
}

function selectJobFromKanban(id) {
  switchView('list');
  selectJob(id);
}

function closeDetail() {
  document.getElementById('job-detail').classList.add('hidden');
  document.getElementById('main-content').classList.add('detail-closed');
  document.querySelectorAll('.job-card').forEach(c => c.classList.remove('active'));
  selectedJobId = null;
}

// ===== COVER LETTER =====
async function viewCoverLetter(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (!job) return;

  const modal = document.getElementById('modal-overlay');
  const textarea = document.getElementById('modal-cover-letter');
  const title = document.getElementById('modal-title');

  title.textContent = `LM — ${job.title} @ ${job.company}`;
  modal.classList.remove('hidden');

  if (job.cover_letter) {
    textarea.value = job.cover_letter;
  } else {
    textarea.value = 'Génération en cours...';
    textarea.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/api/jobs/${jobId}/generate-cover-letter`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        textarea.value = data.coverLetter;
        job.cover_letter = data.coverLetter;
        showToast('✅ Lettre de motivation générée !', 'success');
      } else {
        textarea.value = `Erreur : ${data.error}\n\nConfigurez une clé API dans config/.env ou installez Ollama.`;
        showToast('❌ Erreur de génération', 'error');
      }
    } catch (error) {
      textarea.value = `Erreur réseau : ${error.message}`;
    }

    textarea.disabled = false;
  }
}

async function saveCoverLetter() {
  const textarea = document.getElementById('modal-cover-letter');
  const coverLetter = textarea.value;

  if (!selectedJobId) return;

  try {
    await fetch(`${API_BASE}/api/jobs/${selectedJobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coverLetter: coverLetter, status: 'lm_generated' }),
    });

    const job = allJobs.find(j => j.id === selectedJobId);
    if (job) job.cover_letter = coverLetter;

    showToast('💾 Lettre de motivation sauvegardée', 'success');
    closeModal();
    loadData();
  } catch (error) {
    showToast('Erreur de sauvegarde : ' + error.message, 'error');
  }
}

function copyCoverLetter() {
  const textarea = document.getElementById('modal-cover-letter');
  navigator.clipboard.writeText(textarea.value);
  showToast('📋 Copié dans le presse-papier !', 'info');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ===== JOB ACTIONS =====
async function updateJobStatus(jobId, status) {
  try {
    const updates = { status };
    if (status === 'applied') {
      updates.appliedAt = new Date().toISOString();
    }

    await fetch(`${API_BASE}/api/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    const job = allJobs.find(j => j.id === jobId);
    if (job) job.status = status;

    showToast(`Statut mis à jour : ${getStatusLabel(status)}`, 'success');
    loadStats();
  } catch (error) {
    showToast('Erreur : ' + error.message, 'error');
  }
}

async function saveNotes(jobId) {
  const notes = document.getElementById('detail-notes').value;
  try {
    await fetch(`${API_BASE}/api/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
  } catch (error) {
    // Silent fail for notes
  }
}

// ===== FILTERS =====
function applyFilters() {
  loadJobs();
}

function debounceFilter() {
  clearTimeout(filterDebounceTimer);
  filterDebounceTimer = setTimeout(() => applyFilters(), 300);
}

// ===== SCRAPE =====
async function triggerScrape() {
  const btn = document.getElementById('btn-scrape');
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:5px;display:inline-block;"></span> Scraping en cours...';
  btn.disabled = true;
  showToast('🕷️ Lancement du scraping en arrière-plan...', 'info');

  try {
    const res = await fetch(`${API_BASE}/api/scrape`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      if (!isPollingStatus) pollScrapingStatus();
    } else {
      showToast('❌ Erreur : ' + data.error, 'error');
      resetScrapeBtn();
    }
  } catch (error) {
    showToast('❌ Erreur réseau : ' + error.message, 'error');
    resetScrapeBtn();
  }
}

let isPollingStatus = false;
async function pollScrapingStatus() {
  if (isPollingStatus) return;
  isPollingStatus = true;
  
  const btn = document.getElementById('btn-scrape');
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:5px;display:inline-block;"></span> Scraping en cours...';
  btn.disabled = true;

  const check = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      const data = await res.json();
      if (data.isScraping) {
        setTimeout(check, 3000); // Check again in 3s
      } else {
        // Scrape finished!
        isPollingStatus = false;
        resetScrapeBtn();
        showToast('✅ Scraping terminé ! Nouvelles offres disponibles.', 'success');
        loadData(); // Auto reload
      }
    } catch(e) {
      setTimeout(check, 5000);
    }
  };
  
  setTimeout(check, 3000);
}

function resetScrapeBtn() {
  const btn = document.getElementById('btn-scrape');
  btn.innerHTML = '<span class="btn-icon">🕷️</span> Lancer un scrape';
  btn.disabled = false;
}

// Check status on load
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const data = await res.json();
    if (data.isScraping) {
      pollScrapingStatus();
    }
  } catch(e) {}
});

// ===== UTILITIES =====
function getStatusLabel(status) {
  const labels = {
    new: '🆕 Nouveau',
    lm_generated: '✍️ LM générée',
    reviewed: '👀 Vu',
    applied: '📧 Postulé',
    interview: '🤝 Entretien',
    rejected: '❌ Refusé',
  };
  return labels[status] || status;
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return 'Date inconnue';

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "À l'instant";
  if (diffMins < 60) return `il y a ${diffMins}min`;
  if (diffHours < 24) return `il y a ${diffHours}h`;
  if (diffDays < 7) return `il y a ${diffDays}j`;
  return date.toLocaleDateString('fr-FR');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function animateValue(elementId, value) {
  const el = document.querySelector(`#${elementId} .stat-value`);
  if (!el) return;
  el.textContent = value;
  el.style.transform = 'scale(1.1)';
  setTimeout(() => { el.style.transform = 'scale(1)'; }, 200);
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = type;
  setTimeout(() => { toast.classList.add('hidden'); }, 4000);
}
