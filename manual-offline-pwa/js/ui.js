/**
 * ui.js — Renderização de Cards, Snippets Destacados, Leitor PDF e Modais
 * Focado em usabilidade mobile-first de alta velocidade para consulta em campo.
 */

import { normalizeTerm } from './search-engine.js';

/**
 * Escapa caracteres HTML especiais para prevenir XSS.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formata bytes em formato legível (KB, MB).
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Destaca termos pesquisados dentro de um texto preservando acentuação e caixa originais.
 * Funciona mesmo quando o usuário pesquisa sem acento (ex: "tensao" destaca "Tensão").
 *
 * @param {string} rawText
 * @param {Array<string>} terms
 * @returns {string} HTML seguro com tags <mark class="search-highlight">
 */
export function highlightTextHtml(rawText, terms = []) {
  if (!rawText) return '';
  const cleanTerms = (terms || [])
    .map(normalizeTerm)
    .filter((t) => t.length >= 2 || /\d/.test(t));

  if (cleanTerms.length === 0) {
    return escapeHtml(rawText);
  }

  // Constrói versão normalizada caractere a caractere mantendo mapeamento de índice 1:1
  const chars = Array.from(rawText);
  const normChars = chars.map((ch) =>
    ch
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  );
  const normFull = normChars.join('');

  const intervals = [];
  for (const term of cleanTerms) {
    if (!term) continue;
    let startIndex = 0;
    while (startIndex < normFull.length) {
      const idx = normFull.indexOf(term, startIndex);
      if (idx === -1) break;
      intervals.push([idx, idx + term.length]);
      startIndex = idx + Math.max(1, term.length);
    }
  }

  if (intervals.length === 0) {
    return escapeHtml(rawText);
  }

  // Ordena e mescla intervalos sobrepostos
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = intervals[i];
    if (curr[0] <= prev[1]) {
      prev[1] = Math.max(prev[1], curr[1]);
    } else {
      merged.push(curr);
    }
  }

  let html = '';
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      html += escapeHtml(chars.slice(cursor, start).join(''));
    }
    html += `<mark class="search-highlight">${escapeHtml(chars.slice(start, end).join(''))}</mark>`;
    cursor = end;
  }
  if (cursor < chars.length) {
    html += escapeHtml(chars.slice(cursor).join(''));
  }

  return html;
}

/**
 * Gera um snippet contextualizado em torno da primeira ocorrência relevante dos termos buscados.
 *
 * @param {string} content Texto integral da página
 * @param {Array<string>} terms Termos de destaque
 * @param {number} [maxLen=230] Tamanho máximo do snippet
 * @returns {string} HTML com o trecho e <mark>
 */
export function buildHighlightedSnippet(content, terms = [], maxLen = 230) {
  if (!content || !content.trim()) {
    return '<span class="text-muted">Página sem texto extraível (somente imagem ou diagrama).</span>';
  }

  const singleLine = content.replace(/\s+/g, ' ').trim();
  const normContent = normalizeTerm(singleLine);
  const cleanTerms = (terms || [])
    .map(normalizeTerm)
    .filter((t) => t.length >= 2 || /\d/.test(t));

  let matchIndex = -1;
  for (const term of cleanTerms) {
    const idx = normContent.indexOf(term);
    if (idx !== -1 && (matchIndex === -1 || idx < matchIndex)) {
      matchIndex = idx;
    }
  }

  if (matchIndex === -1) {
    const slice = singleLine.slice(0, maxLen);
    return escapeHtml(slice) + (singleLine.length > maxLen ? '…' : '');
  }

  const lead = Math.floor(maxLen * 0.32);
  let start = Math.max(0, matchIndex - lead);
  let end = Math.min(singleLine.length, start + maxLen);

  if (start > 0) {
    const spaceIdx = singleLine.indexOf(' ', start);
    if (spaceIdx !== -1 && spaceIdx - start < 20) {
      start = spaceIdx + 1;
    }
  }

  if (end < singleLine.length) {
    const lastSpace = singleLine.lastIndexOf(' ', end);
    if (lastSpace > start + 60) {
      end = lastSpace;
    }
  }

  const rawSlice = singleLine.slice(start, end);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < singleLine.length ? '…' : '';

  return `${prefix}${highlightTextHtml(rawSlice, cleanTerms)}${suffix}`;
}

/**
 * Renderiza os cards de resultados da busca Full-Text.
 *
 * @param {HTMLElement} container
 * @param {Array<Object>} results
 * @param {Array<string>} highlightTerms
 * @param {string} query
 */
export function renderSearchResults(container, results, highlightTerms, query) {
  if (!container) return;

  if (! results || results.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
          </svg>
        </div>
        <h3 class="empty-title">Nenhuma ocorrência encontrada</h3>
        <p class="empty-desc">
          Não encontramos resultados para <strong>"${escapeHtml(query)}"</strong>.
          Tente termos mais curtos, códigos parciais (ex: <code>F0021</code>, <code>torque</code>, <code>380V</code>) ou verifique o filtro de manual.
        </p>
      </div>
    `;
    return;
  }

  const cardsHtml = results
    .map((item) => {
      const snippetHtml = buildHighlightedSnippet(item.content, highlightTerms, 240);
      const titleHtml = highlightTextHtml(item.manualTitle || 'Manual Técnico', highlightTerms);
      const matchedTermsBadges = (item.terms || [])
        .slice(0, 4)
        .map((t) => `<span class="term-chip">${escapeHtml(t)}</span>`)
        .join('');

      return `
        <article class="result-card" data-action="open-reader" data-manual-id="${item.manualId}" data-page="${item.pageNumber}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(item.manualTitle)} na página ${item.pageNumber}">
          <div class="result-card-header">
            <div class="result-manual-badge">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              <span class="result-manual-title">${titleHtml}</span>
            </div>
            <span class="page-badge">Pág. ${item.pageNumber}</span>
          </div>

          <p class="result-snippet">${snippetHtml}</p>

          <div class="result-card-footer">
            <div class="result-terms-list">
              ${matchedTermsBadges}
            </div>
            <span class="open-page-cta">
              Abrir página
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </span>
          </div>
        </article>
      `;
    })
    .join('');

  container.innerHTML = cardsHtml;
}

/**
 * Renderiza a grade de cards dos manuais PDF armazenados no dispositivo.
 *
 * @param {HTMLElement} container
 * @param {Array<Object>} manuals
 * @param {string|number} activeFilterId
 */
export function renderManualsLibrary(container, manuals, activeFilterId = 'all') {
  if (!container) return;

  if (!manuals || manuals.length === 0) {
    container.innerHTML = `
      <div class="empty-state library-empty">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="12" y1="18" x2="12" y2="12"></line>
            <line x1="9" y1="15" x2="15" y2="15"></line>
          </svg>
        </div>
        <h3 class="empty-title">Nenhum manual indexado ainda</h3>
        <p class="empty-desc">
          Envie um arquivo PDF do seu dispositivo ou carregue o <strong>Manual Técnico Demo</strong> para testar a busca instantânea e o leitor com destaque offline.
        </p>
        <div class="empty-actions">
          <button type="button" class="btn btn-primary" data-action="trigger-upload">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Fazer Upload de PDF
          </button>
          <button type="button" class="btn btn-accent-outline" data-action="load-demo-manual">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            Carregar Manual Técnico Demo
          </button>
        </div>
      </div>
    `;
    return;
  }

  const cardsHtml = manuals
    .map((m) => {
      const dateStr = new Date(m.createdAt || Date.now()).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
      const isFiltered = String(activeFilterId) === String(m.id);

      return `
        <article class="manual-card ${isFiltered ? 'manual-card-filtered' : ''}">
          <div class="manual-card-top">
            <div class="manual-icon-box" aria-hidden="true">
              <span class="pdf-tag">PDF</span>
            </div>
            <div class="manual-meta">
              <h3 class="manual-title" title="${escapeHtml(m.title)}">${escapeHtml(m.title)}</h3>
              <div class="manual-submeta">
                <span><strong>${m.totalPages}</strong> ${m.totalPages === 1 ? 'página' : 'páginas'}</span>
                <span class="meta-dot">•</span>
                <span>${formatBytes(m.fileSize)}</span>
                <span class="meta-dot">•</span>
                <span>${dateStr}</span>
              </div>
            </div>
          </div>

          <div class="manual-card-actions">
            <button type="button" class="btn btn-sm btn-primary" data-action="open-reader" data-manual-id="${m.id}" data-page="1">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
              </svg>
              Abrir Leitor
            </button>
            <button type="button" class="btn btn-sm ${isFiltered ? 'btn-filter-active' : 'btn-secondary'}" data-action="filter-manual" data-manual-id="${m.id}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
              </svg>
              ${isFiltered ? 'Filtro Ativo' : 'Filtrar Busca'}
            </button>
            <button type="button" class="btn btn-sm btn-danger-ghost" data-action="delete-manual" data-manual-id="${m.id}" title="Remover manual do dispositivo" aria-label="Remover ${escapeHtml(m.title)}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  container.innerHTML = cardsHtml;
}

/**
 * Renderiza pílulas de sugestão de autocompletar abaixo da barra de pesquisa.
 * @param {HTMLElement} container
 * @param {Array<string>} suggestions
 */
export function renderSuggestionsBar(container, suggestions = []) {
  if (!container) return;
  if (!suggestions || suggestions.length === 0) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  container.hidden = false;
  container.innerHTML = `
    <span class="suggestions-label">Sugestões:</span>
    ${suggestions
      .map(
        (s) =>
          `<button type="button" class="suggestion-pill" data-action="apply-suggestion" data-query="${escapeHtml(s)}">${escapeHtml(s)}</button>`
      )
      .join('')}
  `;
}

/**
 * Atualiza o seletor <select> de filtro por manual.
 * @param {HTMLSelectElement} selectEl
 * @param {Array<Object>} manuals
 * @param {string|number} currentVal
 */
export function updateManualSelectOptions(selectEl, manuals = [], currentVal = 'all') {
  if (!selectEl) return;
  const optionsHtml = [
    `<option value="all">Todos os Manuais (${manuals.length})</option>`,
    ...manuals.map(
      (m) =>
        `<option value="${m.id}" ${String(currentVal) === String(m.id) ? 'selected' : ''}>${escapeHtml(m.title)} (${m.totalPages}p)</option>`
    )
  ].join('');
  selectEl.innerHTML = optionsHtml;
}

/**
 * Controla o banner/card de progresso de extração e indexação em background.
 * @param {Object} state
 * @param {boolean} state.active
 * @param {string} [state.fileName]
 * @param {number} [state.currentPage]
 * @param {number} [state.totalPages]
 * @param {number} [state.percent]
 * @param {string} [state.stageText]
 */
export function updateProgressBanner({
  active,
  fileName = '',
  currentPage = 0,
  totalPages = 0,
  percent = 0,
  stageText = ''
}) {
  const banner = document.getElementById('indexing-progress-banner');
  if (!banner) return;

  if (!active) {
    banner.hidden = true;
    return;
  }

  banner.hidden = false;
  const titleEl = document.getElementById('progress-file-name');
  const statusEl = document.getElementById('progress-page-status');
  const fillEl = document.getElementById('progress-bar-fill');

  if (titleEl) titleEl.textContent = fileName || 'Processando PDF...';
  if (statusEl) {
    statusEl.textContent =
      stageText || `Extraindo página ${currentPage} de ${totalPages} (${percent}%)`;
  }
  if (fillEl) {
    fillEl.style.width = `${Math.max(4, Math.min(100, percent))}%`;
  }
}

/**
 * Atualiza os controles e painel de destaques do modal do Leitor de PDF.
 * @param {Object} params
 */
export function updateReaderModalUI({
  manualTitle,
  currentPage,
  totalPages,
  zoomScale,
  matchingPages = [],
  highlightTerms = [],
  pageText = '',
  matchCountOnCanvas = 0,
  activeQuery = ''
}) {
  const titleEl = document.getElementById('reader-manual-title');
  const pageInput = document.getElementById('reader-page-input');
  const totalPagesEl = document.getElementById('reader-total-pages');
  const prevBtn = document.getElementById('reader-prev-page');
  const nextBtn = document.getElementById('reader-next-page');
  const zoomLabel = document.getElementById('reader-zoom-label');
  const matchesBar = document.getElementById('reader-matches-bar');
  const matchesPills = document.getElementById('reader-matches-pills');
  const textContentEl = document.getElementById('reader-extracted-text');
  const highlightCountBadge = document.getElementById('reader-highlight-count');

  if (titleEl) titleEl.textContent = manualTitle || 'Leitor de Manual';
  if (pageInput) {
    pageInput.value = String(currentPage);
    pageInput.max = String(totalPages);
  }
  if (totalPagesEl) totalPagesEl.textContent = `de ${totalPages}`;
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  if (zoomLabel) zoomLabel.textContent = `${Math.round(zoomScale * 100)}%`;

  if (highlightCountBadge) {
    if (highlightTerms.length > 0) {
      highlightCountBadge.hidden = false;
      highlightCountBadge.textContent =
        matchCountOnCanvas > 0
          ? `${matchCountOnCanvas} ${matchCountOnCanvas === 1 ? 'destaque' : 'destaques'} na pág.`
          : 'Termo na pág.';
    } else {
      highlightCountBadge.hidden = true;
    }
  }

  // Barra de navegação rápida entre páginas que contêm o termo pesquisado
  if (matchesBar && matchesPills) {
    if (matchingPages.length > 0 && activeQuery) {
      matchesBar.hidden = false;
      matchesPills.innerHTML = matchingPages
        .map((pNum) => {
          const isCurrent = Number(pNum) === Number(currentPage);
          return `<button type="button" class="match-page-pill ${isCurrent ? 'active' : ''}" data-action="reader-goto-page" data-page="${pNum}">Pág. ${pNum}</button>`;
        })
        .join('');
    } else {
      matchesBar.hidden = true;
      matchesPills.innerHTML = '';
    }
  }

  // Painel de texto extraído da página com <mark> para leitura confortável em telas pequenas
  if (textContentEl) {
    if (pageText && pageText.trim()) {
      textContentEl.innerHTML = highlightTextHtml(pageText, highlightTerms).replace(/\n/g, '<br>');
    } else {
      textContentEl.innerHTML =
        '<span class="text-muted">Nenhum texto extraível nesta página.</span>';
    }
  }
}

/**
 * Exibe uma notificação Toast flutuante.
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} [type='info']
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 280);
  }, 3400);
}
