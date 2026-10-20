/**
 * db.js — Instância e Esquemas do IndexedDB via Dexie.js
 * Gerencia armazenamento persistente offline dos binários PDF e páginas extraídas.
 */

import Dexie from './vendor/dexie.mjs';

export const db = new Dexie('TechManualOfflineDB');

db.version(1).stores({
  manuals: '++id, title, fileName, fileSize, totalPages, createdAt, fileHash',
  pages: '++id, manualId, pageNumber, [manualId+pageNumber]'
});

/**
 * Calcula um hash rápido (FNV-1a + tamanho) do ArrayBuffer para identificar duplicatas.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function computeBufferHash(buffer) {
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  const step = Math.max(1, Math.floor(len / 4096));
  let hash = 2166136261;
  for (let i = 0; i < len; i += step) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return `${len}-${(hash >>> 0).toString(16)}`;
}

/**
 * Verifica se já existe um manual com o mesmo hash.
 * @param {string} fileHash
 * @returns {Promise<Object| undefined>}
 */
export async function findManualByHash(fileHash) {
  if (!fileHash) return undefined;
  return db.manuals.where('fileHash').equals(fileHash).first();
}

/**
 * Salva um manual completo (binário PDF + metadados) e todas as suas páginas extraídas
 * em uma única transação atômica no IndexedDB.
 *
 * @param {Object} manualMeta
 * @param {string} manualMeta.title
 * @param {string} manualMeta.fileName
 * @param {number} manualMeta.fileSize
 * @param {number} manualMeta.totalPages
 * @param {ArrayBuffer} manualMeta.pdfData
 * @param {string} [manualMeta.fileHash]
 * @param {Array<{pageNumber: number, content: string}>} extractedPages
 * @returns {Promise<{manual: Object, pages: Array<Object>}>}
 */
export async function saveManualWithPages(manualMeta, extractedPages) {
  const createdAt = Date.now();
  const fileHash = manualMeta.fileHash || computeBufferHash(manualMeta.pdfData);

  // Armazena como Uint8Array para máxima compatibilidade no IndexedDB entre navegadores mobile
  const pdfBytes = new Uint8Array(manualMeta.pdfData);

  return db.transaction('rw', db.manuals, db.pages, async () => {
    const manualId = await db.manuals.add({
      title: manualMeta.title,
      fileName: manualMeta.fileName,
      fileSize: manualMeta.fileSize,
      totalPages: manualMeta.totalPages,
      createdAt,
      fileHash,
      pdfData: pdfBytes
    });

    const pageRecords = extractedPages.map((p) => ({
      manualId,
      manualTitle: manualMeta.title,
      pageNumber: p.pageNumber,
      content: p.content || ''
    }));

    const insertedIds = await db.pages.bulkAdd(pageRecords, { allKeys: true });

    const savedPages = pageRecords.map((rec, idx) => ({
      ...rec,
      id: insertedIds[idx]
    }));

    const manual = {
      id: manualId,
      title: manualMeta.title,
      fileName: manualMeta.fileName,
      fileSize: manualMeta.fileSize,
      totalPages: manualMeta.totalPages,
      createdAt,
      fileHash
    };

    return { manual, pages: savedPages };
  });
}

/**
 * Lista todos os manuais cadastrados (sem carregar o ArrayBuffer pesado na listagem de cards).
 * @returns {Promise<Array<Object>>}
 */
export async function getAllManuals() {
  const all = await db.manuals.orderBy('createdAt').reverse().toArray();
  return all.map(({ pdfData, ...meta }) => meta);
}

/**
 * Obtém o registro completo do manual incluindo os bytes do PDF (`pdfData`) para renderização.
 * @param {number} manualId
 * @returns {Promise<Object|undefined>}
 */
export async function getManualById(manualId) {
  return db.manuals.get(Number(manualId));
}

/**
 * Retorna todas as páginas armazenadas para indexação no MiniSearch.
 * @returns {Promise<Array<Object>>}
 */
export async function getAllPages() {
  return db.pages.toArray();
}

/**
 * Retorna todas as páginas de um manual específico em ordem crescente.
 * @param {number} manualId
 * @returns {Promise<Array<Object>>}
 */
export async function getPagesByManual(manualId) {
  const pages = await db.pages.where('manualId').equals(Number(manualId)).toArray();
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

/**
 * Retorna os dados de texto de uma página específica de um manual.
 * @param {number} manualId
 * @param {number} pageNumber
 * @returns {Promise<Object|undefined>}
 */
export async function getPageContent(manualId, pageNumber) {
  return db.pages
    .where('[manualId+pageNumber]')
    .equals([Number(manualId), Number(pageNumber)])
    .first();
}

/**
 * Remove um manual e todas as suas páginas indexadas do IndexedDB.
 * @param {number} manualId
 * @returns {Promise<Array<number>>} IDs das páginas excluídas
 */
export async function deleteManual(manualId) {
  const id = Number(manualId);
  return db.transaction('rw', db.manuals, db.pages, async () => {
    const pages = await db.pages.where('manualId').equals(id).toArray();
    const pageIds = pages.map((p) => p.id);
    await db.pages.where('manualId').equals(id).delete();
    await db.manuals.delete(id);
    return pageIds;
  });
}

/**
 * Limpa todo o banco de dados local.
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  return db.transaction('rw', db.manuals, db.pages, async () => {
    await db.pages.clear();
    await db.manuals.clear();
  });
}
