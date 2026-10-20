/**
 * search-engine.js — Motor de Busca Full-Text Offline com MiniSearch
 * Suporta busca por prefixo, fuzzy matching tolerante a erros de digitação,
 * normalização de acentos e filtragem por manual.
 */

import MiniSearch from './vendor/minisearch.mjs';

let miniSearchInstance = null;
let indexedDocCount = 0;

/**
 * Normaliza texto removendo acentos/diacríticos e convertendo para minúsculas.
 * Permite que "conexao" encontre "conexão", "tensao" encontre "Tensão", etc.
 * @param {string} str
 * @returns {string}
 */
export function normalizeTerm(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Tokenizador otimizado para termos técnicos, códigos de falha (ex: F0021, E-04)
 * e especificações industriais (ex: 380V, RS-485).
 * @param {string} text
 * @returns {Array<string>}
 */
export function tokenizeTechnicalText(text) {
  if (!text) return [];
  return String(text)
    .split(/[\s,.;:!?()[\]{}"'«»/\\|<>+=*~`^—–-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Cria uma nova instância configurada do MiniSearch.
 * @returns {MiniSearch}
 */
function createMiniSearch() {
  return new MiniSearch({
    idField: 'id',
    fields: ['content', 'manualTitle'],
    storeFields: ['id', 'manualId', 'manualTitle', 'pageNumber', 'content'],
    tokenize: tokenizeTechnicalText,
    processTerm: (term) => {
      const normalized = normalizeTerm(term);
      return normalized.length >= 1 ? normalized : null;
    },
    searchOptions: {
      boost: { content: 2.5, manualTitle: 1.2 },
      prefix: true,
      fuzzy: (term) => (term.length >= 4 && !/\d/.test(term) ? 0.22 : false),
      combineWith: 'AND'
    }
  });
}

/**
 * Inicializa (ou reinicializa) o índice MiniSearch com todas as páginas do IndexedDB.
 * @param {Array<Object>} pages
 * @returns {{ totalIndexed: number, elapsedMs: number }}
 */
export function initSearchEngine(pages = []) {
  const t0 = performance.now();
  miniSearchInstance = createMiniSearch();
  const validPages = pages.filter((p) => p && p.id != null && typeof p.content === 'string');
  if (validPages.length > 0) {
    miniSearchInstance.addAll(validPages);
  }
  indexedDocCount = validPages.length;
  const elapsedMs = +(performance.now() - t0).toFixed(2);
  return { totalIndexed: indexedDocCount, elapsedMs };
}

/**
 * Adiciona novas páginas extraídas ao índice em memória sem precisar reindexar tudo.
 * @param {Array<Object>} newPages
 */
export function addPagesToIndex(newPages = []) {
  if (!miniSearchInstance) {
    initSearchEngine(newPages);
    return;
  }
  const valid = newPages.filter((p) => p && p.id != null && !miniSearchInstance.has(p.id));
  if (valid.length > 0) {
    miniSearchInstance.addAll(valid);
    indexedDocCount += valid.length;
  }
}

/**
 * Remove páginas do índice a partir dos seus IDs (ou reconstrói se necessário).
 * @param {Array<number>} pageIds
 * @param {Array<Object>} [remainingPages]
 */
export function removePagesFromIndex(pageIds = [], remainingPages = null) {
  if (remainingPages !== null) {
    initSearchEngine(remainingPages);
    return;
  }
  if (!miniSearchInstance) return;
  for (const id of pageIds) {
    if (miniSearchInstance.has(id)) {
      miniSearchInstance.discard(id);
      indexedDocCount = Math.max(0, indexedDocCount - 1);
    }
  }
}

/**
 * Executa uma busca Full-Text ultrarrápida nos manuais indexados.
 *
 * @param {string} query
 * @param {Object} [options]
 * @param {string|number} [options.manualId='all'] Filtra por um manual específico
 * @param {boolean} [options.fuzzy=true] Ativa/desativa correspondência aproximada (fuzzy)
 * @param {number} [options.limit=60] Limite de resultados retornados
 * @returns {{
 *   results: Array<Object>,
 *   totalMatches: number,
 *   elapsedMs: number,
 *   highlightTerms: Array<string>
 * }}
 */
export function searchManuals(query, options = {}) {
  const { manualId = 'all', fuzzy = true, limit = 60 } = options;
  const cleanQuery = (query || '').trim();

  if (!cleanQuery || !miniSearchInstance) {
    return {
      results: [],
      totalMatches: 0,
      elapsedMs: 0,
      highlightTerms: []
    };
  }

  const t0 = performance.now();

  const filterFn =
    manualId !== 'all' && manualId !== '' && manualId !== null
      ? (result) => Number(result.manualId) === Number(manualId)
      : undefined;

  const searchOpts = {
    boost: { content: 2.5, manualTitle: 1.2 },
    prefix: true,
    fuzzy: fuzzy ? (term) => (term.length >= 4 && !/\d/.test(term) ? 0.25 : false) : false,
    combineWith: 'AND',
    filter: filterFn
  };

  let rawResults = miniSearchInstance.search(cleanQuery, searchOpts);

  // Fallback para OR caso o usuário digite múltiplos termos e AND não retorne nada
  if (rawResults.length === 0 && tokenizeTechnicalText(cleanQuery).length > 1) {
    rawResults = miniSearchInstance.search(cleanQuery, {
      ...searchOpts,
      combineWith: 'OR'
    });
  }

  const elapsedMs = +(performance.now() - t0).toFixed(2);

  // Coleta tanto os tokens originais da query quanto os termos que o MiniSearch deu match (fuzzy/prefix)
  const queryTokens = tokenizeTechnicalText(cleanQuery).map(normalizeTerm).filter(Boolean);
  const matchedSet = new Set(queryTokens);

  for (const r of rawResults.slice(0, limit)) {
    if (Array.isArray(r.terms)) {
      for (const t of r.terms) {
        matchedSet.add(normalizeTerm(t));
      }
    }
  }

  const highlightTerms = Array.from(matchedSet).filter((t) => t.length >= 2 || /\d/.test(t));

  return {
    results: rawResults.slice(0, limit),
    totalMatches: rawResults.length,
    elapsedMs,
    highlightTerms
  };
}

/**
 * Retorna todas as páginas de um determinado manual que correspondem à query atual,
 * ordenadas pelo número da página (útil para navegar entre ocorrências dentro do leitor PDF).
 *
 * @param {string} query
 * @param {number} manualId
 * @returns {{ matchingPages: Array<number>, highlightTerms: Array<string> }}
 */
export function getManualMatchingPages(query, manualId) {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery || !miniSearchInstance || !manualId) {
    return { matchingPages: [], highlightTerms: [] };
  }

  const { results, highlightTerms } = searchManuals(cleanQuery, {
    manualId: Number(manualId),
    fuzzy: true,
    limit: 500
  });

  const pageNumbers = Array.from(new Set(results.map((r) => Number(r.pageNumber)))).sort(
    (a, b) => a - b
  );

  return {
    matchingPages: pageNumbers,
    highlightTerms
  };
}

/**
 * Retorna sugestões de autocompletar baseadas no conteúdo indexado dos manuais.
 * @param {string} query
 * @param {number} [maxSuggestions=5]
 * @returns {Array<string>}
 */
export function getSearchSuggestions(query, maxSuggestions = 5) {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery || cleanQuery.length < 2 || !miniSearchInstance) {
    return [];
  }
  try {
    const suggestions = miniSearchInstance.autoSuggest(cleanQuery, {
      prefix: true,
      fuzzy: (term) => (term.length >= 4 ? 0.2 : false)
    });
    return suggestions.slice(0, maxSuggestions).map((s) => s.suggestion);
  } catch {
    return [];
  }
}

/**
 * Retorna o total de páginas atualmente no índice em memória.
 * @returns {number}
 */
export function getIndexedCount() {
  return indexedDocCount;
}
