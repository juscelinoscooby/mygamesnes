/**
 * app.js — Ponto de Entrada, Orquestração e Listeners da UI
 * Conecta o armazenamento IndexedDB (Dexie), extração/renderização PDF.js,
 * motor de busca Full-Text (MiniSearch) e Service Worker Offline.
 */

import {
  saveManualWithPages,
  getAllManuals,
  getManualById,
  getAllPages,
  getPageContent,
  deleteManual,
  clearAllData,
  computeBufferHash,
  findManualByHash
} from './db.js';

import {
  extractPdfPages,
  renderPdfPage,
  closeReaderDocument,
  generateDemoTechnicalManualPdf
} from './pdf-service.js';

import {
  initSearchEngine,
  addPagesToIndex,
  removePagesFromIndex,
  searchManuals,
  getManualMatchingPages,
  getSearchSuggestions,
  getIndexedCount,
   tokenizeTechnicalText,
  normalizeTerm
} from './search-engine.js';

import {
  renderSearchResults,
  renderManualsLibrary,
  renderSuggestionsBar,
  updateManualSelectOptions,
  updateProgressBanner,
  updateReaderModalUI,
  showToast
} from './ui.js';

const state = {
  manuals: [],
  activeQuery: '',
  manualFilter: 'all',
  fuzzyEnabled: true,
  isUploading: false,
  deferredInstallPrompt: null,
  reader: {
    isOpen: false,
    manualId: null,
    manualTitle: '',
    pdfData: null,
    currentPage: 1,
    totalPages: 1,
    zoomScale: 1.0,
    highlightTerms: [],
    matchingPages: [],
    showTextDrawer: false
  }
};

let searchDebounceTimer = null;

/**
 * Inicialização principal da aplicação.
 */
async function initApp() {
  initTheme();
  registerServiceWorker();
  setupNetworkStatusListeners();
  setupEventListeners();

  try {
    const [manuals, allPages] = await Promise.all([getAllManuals(), getAllPages()]);
    state.manuals = manuals;

    const { totalIndexed, elapsedMs } = initSearchEngine(allPages);
    refreshStatsUI(elapsedMs);
    updateManualSelectOptions(
      document.getElementById('manual-filter-select'),
      state.manuals,
      state.manualFilter
    );
    renderManualsLibrary(
      document.getElementById('manuals-grid'),
      state.manuals,
      state.manualFilter
    );

    if (totalIndexed > 0) {
      updateSearchStatusText(
        `Índice pronto (${totalIndexed} ${totalIndexed === 1 ? 'página' : 'páginas'} carregadas em ${elapsedMs} ms)`
      );
    } else {
      updateSearchStatusText('Envie um PDF ou carregue o Manual Demo para pesquisar offline.');
    }
  } catch (err) {
    console.error('Erro ao inicializar banco de dados local:', err);
    showToast('Erro ao acessar banco de dados local IndexedDB.', 'error');
  }
}

/**
 * Registra o Service Worker com estratégia Cache-First para funcionamento 100% offline.
 */
async function registerServiceWorker() {
  const swBadge = document.getElementById('offline-status-badge');
  if (!('serviceWorker' in navigator)) {
    if (swBadge) swBadge.textContent = 'Modo Local';
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    if (registration.installing || registration.waiting || registration.active) {
      updateConnectivityBadge();
    }
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            updateConnectivityBadge();
          }
        });
      }
    });
  } catch (err) {
    console.warn('Service Worker não pôde ser registrado neste contexto:', err);
  }
}

/**
 * Monitora eventos online/offline e prompt de instalação PWA.
 */
function setupNetworkStatusListeners() {
  window.addEventListener('online', updateConnectivityBadge);
  window.addEventListener('offline', () => {
    updateConnectivityBadge();
    showToast('Sem conexão — operando 100% offline via IndexedDB.', 'info');
  });
  updateConnectivityBadge();

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    const installBtn = document.getElementById('install-pwa-btn');
    if (installBtn) installBtn.hidden = false;
  });
}

function updateConnectivityBadge() {
  const badge = document.getElementById('offline-status-badge');
  if (!badge) return;
  const isOnline = navigator.onLine;
  badge.className = `status-pill ${isOnline ? 'status-online' : 'status-offline-active'}`;
  badge.innerHTML = `
    <span class="status-dot"></span>
    <span>${isOnline ? 'Offline Ready' : 'Modo Offline Ativo'}</span>
  `;
}

/**
 * Gerencia tema Escuro (padrão industrial) e Claro.
 */
function initTheme() {
  const savedTheme = localStorage.getItem('techmanual-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeButtonIcon(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('techmanual-theme', next);
  updateThemeButtonIcon(next);
}

function updateThemeButtonIcon(theme) {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;
  btn.setAttribute(
    'aria-label',
    theme === 'dark' ? 'Alternar para tema claro' : 'Alternar para tema escuro'
  );
  btn.innerHTML =
    theme === 'dark'
      ? `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`
      : `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
}

/**
 * Configura todos os listeners de interface do usuário.
 */
function setupEventListeners() {
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const manualFilterSelect = document.getElementById('manual-filter-select');
  const fuzzyCheckbox = document.getElementById('fuzzy-toggle-checkbox');
  const pdfFileInput = document.getElementById('pdf-file-input');
  const uploadDropzone = document.getElementById('upload-dropzone');
  const demoBtn = document.getElementById('load-demo-btn');
  const clearDbBtn = document.getElementById('clear-all-btn');
  const themeBtn = document.getElementById('theme-toggle-btn');
  const installBtn = document.getElementById('install-pwa-btn');

  // Busca em tempo real com debounce ultrarrápido
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (clearSearchBtn) clearSearchBtn.hidden = !val;
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        executeSearch(val);
      }, 45);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchDebounceTimer);
        executeSearch(searchInput.value);
      } else if (e.key === 'Escape' && searchInput.value) {
        searchInput.value = '';
        if (clearSearchBtn) clearSearchBtn.hidden = true;
        executeSearch('');
      }
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      clearSearchBtn.hidden = true;
      executeSearch('');
    });
  }

  if (manualFilterSelect) {
    manualFilterSelect.addEventListener('change', (e) => {
      state.manualFilter = e.target.value;
      renderManualsLibrary(
        document.getElementById('manuals-grid'),
        state.manuals,
        state.manualFilter
      );
      if (state.activeQuery) {
        executeSearch(state.activeQuery);
      }
    });
  }

  if (fuzzyCheckbox) {
    fuzzyCheckbox.addEventListener('change', (e) => {
      state.fuzzyEnabled = e.target.checked;
      if (state.activeQuery) {
        executeSearch(state.activeQuery);
      }
    });
  }

  // Upload de arquivo PDF via input
  if (pdfFileInput) {
    pdfFileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        await handleUploadedFiles(files);
        pdfFileInput.value = '';
      }
    });
  }

  // Drag and drop para área de upload
  if (uploadDropzone) {
    uploadDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadDropzone.classList.add('drag-over');
    });
    uploadDropzone.addEventListener('dragleave', () => {
      uploadDropzone.classList.remove('drag-over');
    });
    uploadDropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      uploadDropzone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer?.files || []).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      if (files.length === 0) {
        showToast('Selecione apenas arquivos no formato PDF (.pdf).', 'warning');
        return;
      }
      await handleUploadedFiles(files);
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', handleLoadDemoManual);
  }

  if (clearDbBtn) {
    clearDbBtn.addEventListener('click', handleClearAllManuals);
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', toggleTheme);
  }

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      installBtn.hidden = true;
    });
  }

  // Delegação global de cliques para cards, sugestões, chips rápidos e leitor
  document.addEventListener('click', handleDelegatedClick);

  // Suporte a teclado para cards de resultado e modal de leitura
  document.addEventListener('keydown', handleGlobalKeydown);

  // Controles internos do Modal do Leitor PDF
  setupReaderModalListeners();
}

/**
 * Manipula cliques delegados em elementos dinâmicos (`data-action`).
 * @param {MouseEvent} e
 */
async function handleDelegatedClick(e) {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  switch (action) {
    case 'open-reader': {
      const manualId = Number(actionEl.dataset.manualId);
      const pageNumber = Number(actionEl.dataset.page) || 1;
      await openPdfReader(manualId, pageNumber);
      break;
    }

    case 'filter-manual': {
      const manualId = String(actionEl.dataset.manualId);
      state.manualFilter = state.manualFilter === manualId ? 'all' : manualId;
      const selectEl = document.getElementById('manual-filter-select');
      if (selectEl) selectEl.value = state.manualFilter;
      renderManualsLibrary(
        document.getElementById('manuals-grid'),
        state.manuals,
        state.manualFilter
      );
      if (state.activeQuery) {
        executeSearch(state.activeQuery);
      } else {
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.focus();
      }
      break;
    }

    case 'delete-manual': {
      e.stopPropagation();
      const manualId = Number(actionEl.dataset.manualId);
      await handleDeleteManual(manualId);
      break;
    }

    case 'trigger-upload': {
      const fileInput = document.getElementById('pdf-file-input');
      if (fileInput) fileInput.click();
      break;
    }

    case 'load-demo-manual': {
      await handleLoadDemoManual();
      break;
    }

    case 'apply-suggestion':
    case 'quick-query': {
      const query = actionEl.dataset.query || '';
      const searchInput = document.getElementById('search-input');
      const clearBtn = document.getElementById('clear-search-btn');
      if (searchInput) {
        searchInput.value = query;
      }
      if (clearBtn) {
        clearBtn.hidden = !query;
      }
      executeSearch(query);
      break;
    }

    case 'reader-goto-page': {
      const targetPage = Number(actionEl.dataset.page);
      if (targetPage && state.reader.isOpen) {
        await navigateReaderToPage(targetPage);
      }
      break;
    }

    default:
      break;
  }
}

/**
 * Executa a busca Full-Text no MiniSearch e atualiza os cards de resultado.
 * @param {string} rawQuery
 */
function executeSearch(rawQuery) {
  const query = (rawQuery || '').trim();
  state.activeQuery = query;

  const resultsSection = document.getElementById('search-results-section');
  const resultsContainer = document.getElementById('search-results-list');
  const suggestionsBar = document.getElementById('search-suggestions-bar');

  if (!query) {
    if (resultsSection) resultsSection.hidden = true;
    if (resultsContainer) resultsContainer.innerHTML = '';
    renderSuggestionsBar(suggestionsBar, []);
    updateSearchStatusText(
      getIndexedCount() > 0
        ? `${getIndexedCount()} páginas prontas para consulta instantânea offline.`
        : 'Envie um PDF ou carregue o Manual Demo para pesquisar offline.'
    );
    return;
  }

  const { results, totalMatches, elapsedMs, highlightTerms } = searchManuals(query, {
    manualId: state.manualFilter,
    fuzzy: state.fuzzyEnabled,
    limit: 60
  });

  const suggestions = getSearchSuggestions(query, 5).filter(
    (s) => s.toLowerCase() !== query.toLowerCase()
  );
  renderSuggestionsBar(suggestionsBar, suggestions);

  if (resultsSection) resultsSection.hidden = false;
  renderSearchResults(resultsContainer, results, highlightTerms, query);

  const statSpeedEl = document.getElementById('stat-search-speed');
  if (statSpeedEl) statSpeedEl.textContent = `${elapsedMs} ms`;

  updateSearchStatusText(
    `${totalMatches} ${totalMatches === 1 ? 'página encontrada' : 'páginas encontradas'} em ${elapsedMs} ms`
  );
}

/**
 * Processa um ou mais arquivos PDF selecionados pelo usuário.
 * @param {Array<File>} files
 */
async function handleUploadedFiles(files) {
  if (state.isUploading) {
    showToast('Aguarde a conclusão da extração em andamento.', 'warning');
    return;
  }

  state.isUploading = true;
  let successCount = 0;

  try {
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        showToast(`Arquivo ignorado (${file.name}): formato não é PDF.`, 'warning');
        continue;
      }

      const buffer = await file.arrayBuffer();
      const title = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || file.name;

      const added = await processAndIndexPdfBuffer({
        title,
        fileName: file.name,
        fileSize: file.size,
        arrayBuffer: buffer
      });

      if (added) successCount++;
    }

    if (successCount > 0) {
      showToast(
        successCount === 1
          ? 'Manual extraído e indexado 100% offline!'
          : `${successCount} manuais indexados com sucesso!`,
        'success'
      );
    }
  } catch (err) {
    console.error('Erro ao processar PDF:', err);
    showToast('Falha ao ler o arquivo PDF. Verifique se o arquivo é válido.', 'error');
  } finally {
    state.isUploading = false;
    updateProgressBanner({ active: false });
  }
}

/**
 * Gera e indexa o Manual Técnico de Demonstração (WEG CFW500 & Bomba KSB - 5 páginas).
 */
async function handleLoadDemoManual() {
  if (state.isUploading) return;
  state.isUploading = true;

  try {
    const demoBuffer = generateDemoTechnicalManualPdf();
    const added = await processAndIndexPdfBuffer({
      title: 'Manual Técnico — Inversor WEG CFW500 & Bomba KSB (Rev 4.2)',
      fileName: 'manual-weg-cfw500-bomba-ksb.pdf',
      fileSize: demoBuffer.byteLength,
      arrayBuffer: demoBuffer
    });

    if (added) {
      showToast('Manual Técnico Demo (5 páginas) indexado! Experimente buscar F0021 ou torque.', 'success');
      // Executa uma busca inicial demonstrativa se o campo estiver vazio
      const searchInput = document.getElementById('search-input');
      const clearBtn = document.getElementById('clear-search-btn');
      if (searchInput && !searchInput.value.trim()) {
        searchInput.value = 'F0021';
        if (clearBtn) clearBtn.hidden = false;
        executeSearch('F0021');
      }
    }
  } catch (err) {
    console.error('Erro ao carregar manual demo:', err);
    showToast('Erro ao gerar manual de demonstração.', 'error');
  } finally {
    state.isUploading = false;
    updateProgressBanner({ active: false });
  }
}

/**
 * Pipeline completo: verifica duplicidade, extrai texto página a página via PDF.js Worker,
 * persiste no IndexedDB (Dexie) e adiciona ao índice MiniSearch.
 *
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.fileName
 * @param {number} params.fileSize
 * @param {ArrayBuffer} params.arrayBuffer
 * @returns {Promise<boolean>}
 */
async function processAndIndexPdfBuffer({ title, fileName, fileSize, arrayBuffer }) {
  const fileHash = computeBufferHash(arrayBuffer);
  const existing = await findManualByHash(fileHash);
  if (existing) {
    showToast(`O manual "${existing.title}" já está indexado no dispositivo.`, 'info');
    return false;
  }

  updateProgressBanner({
    active: true,
    fileName: title,
    currentPage: 0,
    totalPages: 1,
    percent: 5,
    stageText: 'Iniciando worker PDF.js...'
  });

  const { totalPages, pages } = await extractPdfPages(
    arrayBuffer,
    ({ currentPage, totalPages: total, percent }) => {
      updateProgressBanner({
        active: true,
        fileName: title,
        currentPage,
        totalPages: total,
        percent
      });
    }
  );

  updateProgressBanner({
    active: true,
    fileName: title,
    currentPage: totalPages,
    totalPages,
    percent: 100,
    stageText: 'Salvando no IndexedDB e indexando no MiniSearch...'
  });

  const { manual, pages: savedPages } = await saveManualWithPages(
    {
      title,
      fileName,
      fileSize,
      totalPages,
      pdfData: arrayBuffer,
      fileHash
    },
    pages
  );

  addPagesToIndex(savedPages);
  state.manuals = await getAllManuals();

  refreshStatsUI();
  updateManualSelectOptions(
    document.getElementById('manual-filter-select'),
    state.manuals,
    state.manualFilter
  );
  renderManualsLibrary(
    document.getElementById('manuals-grid'),
    state.manuals,
    state.manualFilter
  );

  if (state.activeQuery) {
    executeSearch(state.activeQuery);
  } else {
    updateSearchStatusText(
      `${getIndexedCount()} páginas prontas para consulta instantânea offline.`
    );
  }

  return Boolean(manual);
}

/**
 * Exclui um manual do IndexedDB e remove suas páginas do MiniSearch.
 * @param {number} manualId
 */
async function handleDeleteManual(manualId) {
  const target = state.manuals.find((m) => Number(m.id) === Number(manualId));
  if (!target) return;

  try {
    const deletedPageIds = await deleteManual(manualId);
    const remainingPages = await getAllPages();
    removePagesFromIndex(deletedPageIds, remainingPages);

    if (String(state.manualFilter) === String(manualId)) {
      state.manualFilter = 'all';
    }

    state.manuals = await getAllManuals();
    refreshStatsUI();
    updateManualSelectOptions(
      document.getElementById('manual-filter-select'),
      state.manuals,
      state.manualFilter
    );
    renderManualsLibrary(
      document.getElementById('manuals-grid'),
      state.manuals,
      state.manualFilter
    );

    if (state.activeQuery) {
      executeSearch(state.activeQuery);
    } else {
      updateSearchStatusText(
        getIndexedCount() > 0
          ? `${getIndexedCount()} páginas prontas para consulta instantânea offline.`
          : 'Envie um PDF ou carregue o Manual Demo para pesquisar offline.'
      );
    }

    showToast(`Manual "${target.title}" removido.`, 'info');
  } catch (err) {
    console.error('Erro ao excluir manual:', err);
    showToast('Não foi possível excluir o manual.', 'error');
  }
}

/**
 * Limpa todos os manuais armazenados localmente.
 */
async function handleClearAllManuals() {
  if (state.manuals.length === 0) {
    showToast('A biblioteca já está vazia.', 'info');
    return;
  }

  try {
    await closeReaderDocument();
    await clearAllData();
    initSearchEngine([]);
    state.manuals = [];
    state.manualFilter = 'all';
    state.activeQuery = '';

    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search-btn');
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.hidden = true;

    refreshStatsUI(0);
    updateManualSelectOptions(document.getElementById('manual-filter-select'), [], 'all');
    renderManualsLibrary(document.getElementById('manuals-grid'), [], 'all');
    executeSearch('');
    showToast('Todos os manuais foram removidos do dispositivo.', 'info');
  } catch (err) {
    console.error('Erro ao limpar banco:', err);
    showToast('Erro ao limpar biblioteca.', 'error');
  }
}

/**
 * Abre o modal do Leitor de PDF diretamente na página solicitada,
 * destacando os termos pesquisados tanto no Canvas quanto no painel de texto.
 *
 * @param {number} manualId
 * @param {number} pageNumber
 */
async function openPdfReader(manualId, pageNumber = 1) {
  try {
    const manualRecord = await getManualById(manualId);
    if (!manualRecord || !manualRecord.pdfData) {
      showToast('Dados do PDF não encontrados no armazenamento local.', 'error');
      return;
    }

    const { matchingPages, highlightTerms } = state.activeQuery
      ? getManualMatchingPages(state.activeQuery, manualId)
      : { matchingPages: [], highlightTerms: [] };

    // Garante que os tokens da query ativa estejam na lista de destaques
    if (state.activeQuery && highlightTerms.length === 0) {
      const fallbackTokens = tokenizeTechnicalText(state.activeQuery)
        .map(normalizeTerm)
        .filter(Boolean);
      highlightTerms.push(...fallbackTokens);
    }

    state.reader = {
      isOpen: true,
      manualId: Number(manualId),
      manualTitle: manualRecord.title,
      pdfData: manualRecord.pdfData,
      currentPage: Math.max(1, Math.min(Number(pageNumber) || 1, manualRecord.totalPages)),
      totalPages: manualRecord.totalPages,
      zoomScale: 1.0,
      highlightTerms,
      matchingPages,
      showTextDrawer: Boolean(state.activeQuery)
    };

    const modal = document.getElementById('pdf-reader-modal');
    const textPanel = document.getElementById('reader-text-drawer');
    const toggleTextBtn = document.getElementById('reader-toggle-text-btn');

    if (modal) {
      modal.hidden = false;
      document.body.classList.add('modal-open');
    }
    if (textPanel) {
      textPanel.hidden = !state.reader.showTextDrawer;
    }
    if (toggleTextBtn) {
      toggleTextBtn.classList.toggle('active', state.reader.showTextDrawer);
    }

    await renderCurrentReaderPage();
  } catch (err) {
    console.error('Erro ao abrir leitor PDF:', err);
    showToast('Erro ao abrir o leitor de PDF.', 'error');
  }
}

/**
 * Navega para uma página específica no leitor aberto.
 * @param {number} targetPage
 */
async function navigateReaderToPage(targetPage) {
  if (!state.reader.isOpen) return;
  const clamped = Math.max(1, Math.min(Number(targetPage) || 1, state.reader.totalPages));
  if (clamped === state.reader.currentPage) return;
  state.reader.currentPage = clamped;
  await renderCurrentReaderPage();
}

/**
 * Renderiza a página atual do leitor no Canvas e atualiza os destaques.
 */
async function renderCurrentReaderPage() {
  if (!state.reader.isOpen || !state.reader.pdfData) return;

  const canvas = document.getElementById('pdf-reader-canvas');
  const highlightLayer = document.getElementById('pdf-highlight-layer');
  const stageContainer = document.getElementById('pdf-canvas-stage');

  if (!canvas) return;

  const containerWidth = stageContainer ? stageContainer.clientWidth : window.innerWidth;

  const [renderResult, pageRecord] = await Promise.all([
    renderPdfPage({
      manualId: state.reader.manualId,
      pdfData: state.reader.pdfData,
      pageNumber: state.reader.currentPage,
      canvas,
      highlightLayer,
      highlightTerms: state.reader.highlightTerms,
      zoomScale: state.reader.zoomScale,
      containerWidth
    }),
    getPageContent(state.reader.manualId, state.reader.currentPage)
  ]);

  updateReaderModalUI({
    manualTitle: state.reader.manualTitle,
    currentPage: state.reader.currentPage,
    totalPages: renderResult.totalPages || state.reader.totalPages,
    zoomScale: state.reader.zoomScale,
    matchingPages: state.reader.matchingPages,
    highlightTerms: state.reader.highlightTerms,
    pageText: pageRecord?.content || '',
    matchCountOnCanvas: renderResult.matchCountOnCanvas,
    activeQuery: state.activeQuery
  });
}

/**
 * Fecha o modal do leitor de PDF.
 */
async function closePdfReader() {
  state.reader.isOpen = false;
  state.reader.pdfData = null;

  const modal = document.getElementById('pdf-reader-modal');
  if (modal) {
    modal.hidden = true;
  }
  document.body.classList.remove('modal-open');
  await closeReaderDocument();
}

/**
 * Configura os botões de controle do Leitor PDF (paginação, zoom, gaveta de texto, swipe mobile).
 */
function setupReaderModalListeners() {
  const closeBtn = document.getElementById('reader-close-btn');
  const backdrop = document.getElementById('reader-modal-backdrop');
  const prevBtn = document.getElementById('reader-prev-page');
  const nextBtn = document.getElementById('reader-next-page');
  const pageInput = document.getElementById('reader-page-input');
  const zoomInBtn = document.getElementById('reader-zoom-in');
  const zoomOutBtn = document.getElementById('reader-zoom-out');
  const zoomResetBtn = document.getElementById('reader-zoom-reset');
  const toggleTextBtn = document.getElementById('reader-toggle-text-btn');
  const stageEl = document.getElementById('pdf-canvas-stage');

  if (closeBtn) closeBtn.addEventListener('click', closePdfReader);
  if (backdrop) backdrop.addEventListener('click', closePdfReader);

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (state.reader.currentPage > 1) {
        navigateReaderToPage(state.reader.currentPage - 1);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (state.reader.currentPage < state.reader.totalPages) {
        navigateReaderToPage(state.reader.currentPage + 1);
      }
    });
  }

  if (pageInput) {
    pageInput.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!Number.isNaN(val)) {
        navigateReaderToPage(val);
      }
    });
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      state.reader.zoomScale = Math.min(2.5, +(state.reader.zoomScale + 0.25).toFixed(2));
      renderCurrentReaderPage();
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      state.reader.zoomScale = Math.max(0.75, +(state.reader.zoomScale - 0.25).toFixed(2));
      renderCurrentReaderPage();
    });
  }

  if (zoomResetBtn) {
    zoomResetBtn.addEventListener('click', () => {
      state.reader.zoomScale = 1.0;
      renderCurrentReaderPage();
    });
  }

  if (toggleTextBtn) {
    toggleTextBtn.addEventListener('click', () => {
      state.reader.showTextDrawer = !state.reader.showTextDrawer;
      const drawer = document.getElementById('reader-text-drawer');
      if (drawer) drawer.hidden = !state.reader.showTextDrawer;
      toggleTextBtn.classList.toggle('active', state.reader.showTextDrawer);
    });
  }

  // Suporte a gestos de swipe horizontal em dispositivos móveis (quando zoom == 1)
  if (stageEl) {
    let touchStartX = 0;
    let touchStartY = 0;
    stageEl.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      },
      { passive: true }
    );

    stageEl.addEventListener(
      'touchend',
      (e) => {
        if (state.reader.zoomScale > 1.05 || e.changedTouches.length !== 1) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.8) {
          if (dx < 0 && state.reader.currentPage < state.reader.totalPages) {
            navigateReaderToPage(state.reader.currentPage + 1);
          } else if (dx > 0 && state.reader.currentPage > 1) {
            navigateReaderToPage(state.reader.currentPage - 1);
          }
        }
      },
      { passive: true }
    );
  }
}

/**
 * Atalhos de teclado para navegação rápida no leitor e acessibilidade nos cards.
 * @param {KeyboardEvent} e
 */
function handleGlobalKeydown(e) {
  if (state.reader.isOpen) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePdfReader();
    } else if (e.key === 'ArrowRight' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      if (state.reader.currentPage < state.reader.totalPages) {
        navigateReaderToPage(state.reader.currentPage + 1);
      }
    } else if (e.key === 'ArrowLeft' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      if (state.reader.currentPage > 1) {
        navigateReaderToPage(state.reader.currentPage - 1);
      }
    }
    return;
  }

  if (e.key === 'Enter' || e.key === ' ') {
    const activeCard = document.activeElement?.closest('.result-card[data-action="open-reader"]');
    if (activeCard) {
      e.preventDefault();
      const manualId = Number(activeCard.dataset.manualId);
      const pageNumber = Number(activeCard.dataset.page) || 1;
      openPdfReader(manualId, pageNumber);
    }
  }
}

/**
 * Atualiza os contadores superiores de estatísticas (Manuais, Páginas Indexadas, Tempo).
 * @param {number} [lastMs]
 */
function refreshStatsUI(lastMs) {
  const manualsCountEl = document.getElementById('stat-manuals-count');
  const pagesCountEl = document.getElementById('stat-pages-count');
  const speedEl = document.getElementById('stat-search-speed');
  const clearAllBtn = document.getElementById('clear-all-btn');

  if (manualsCountEl) manualsCountEl.textContent = String(state.manuals.length);
  if (pagesCountEl) pagesCountEl.textContent = String(getIndexedCount());
  if (speedEl && typeof lastMs === 'number') {
    speedEl.textContent = `${lastMs} ms`;
  }
  if (clearAllBtn) {
    clearAllBtn.hidden = state.manuals.length === 0;
  }
}

/**
 * Atualiza a linha de status abaixo da caixa de busca.
 * @param {string} text
 */
function updateSearchStatusText(text) {
  const el = document.getElementById('search-status-meta');
  if (el) el.textContent = text;
}

document.addEventListener('DOMContentLoaded', initApp);
