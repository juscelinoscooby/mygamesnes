/**
 * pdf-service.js — Extração de Texto Página a Página e Renderização Canvas com PDF.js
 * Inclui suporte a highlight de termos diretamente sobre o Canvas do PDF e gerador de manual demo.
 */

import * as pdfjsLib from './vendor/pdf.min.mjs';
import { normalizeTerm } from './search-engine.js';

// Configura o Web Worker local do PDF.js para execução 100% offline
const workerUrl = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Cache do documento aberto atualmente no leitor para navegação instantânea entre páginas
let cachedReaderDoc = null;
let cachedReaderManualId = null;
let activeRenderTask = null;

/**
 * Extrai o texto de todas as páginas de um arquivo PDF em background,
 * reportando o progresso página a página sem bloquear a thread principal.
 *
 * @param {ArrayBuffer} arrayBuffer Bytes do arquivo PDF
 * @param {(progress: {currentPage: number, totalPages: number, percent: number}) => void} [onProgress]
 * @returns {Promise<{ totalPages: number, pages: Array<{pageNumber: number, content: string}> }>}
 */
export async function extractPdfPages(arrayBuffer, onProgress) {
  // Fazemos uma cópia pois o worker do PDF.js transfere (detaches) o ArrayBuffer enviado
  const dataCopy = new Uint8Array(arrayBuffer.slice(0));

  const loadingTask = pdfjsLib.getDocument({
    data: dataCopy,
    useSystemFonts: true,
    isEvalSupported: false
  });

  const pdfDoc = await loadingTask.promise;
  const totalPages = pdfDoc.numPages;
  const extractedPages = [];

  try {
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const page = await pdfDoc.getPage(pageNumber);
      const textContent = await page.getTextContent();

      const pageText = reconstructPageText(textContent.items);
      extractedPages.push({
        pageNumber,
        content: pageText
      });

      if (typeof onProgress === 'function') {
        const percent = Math.round((pageNumber / totalPages) * 100);
        onProgress({ currentPage: pageNumber, totalPages, percent });
      }

      // Libera recursos da página e cede brevemente ao event loop para atualizar a UI
      page.cleanup();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await pdfDoc.destroy();
  }

  return {
    totalPages,
    pages: extractedPages
  };
}

/**
 * Reconstrói o texto de uma página preservando quebras de linha lógicas baseadas na coordenada Y.
 * @param {Array<Object>} items
 * @returns {string}
 */
function reconstructPageText(items = []) {
  if (!items || items.length === 0) return '';

  const chunks = [];
  let lastY = null;

  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const str = item.str;
    const currentY = Array.isArray(item.transform) ? item.transform[5] : null;

    if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 4) {
      chunks.push('\n');
    } else if (chunks.length > 0 && !chunks[chunks.length - 1].endsWith('\n') && !chunks[chunks.length - 1].endsWith(' ')) {
      chunks.push(' ');
    }

    chunks.push(str);
    if (item.hasEOL) {
      chunks.push('\n');
    }
    if (currentY !== null) {
      lastY = currentY;
    }
  }

  return chunks
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Obtém (ou abre e coloca em cache) o PDFDocumentProxy para o leitor.
 * @param {number} manualId
 * @param {Uint8Array|ArrayBuffer} pdfData
 * @returns {Promise<Object>}
 */
async function getOrOpenReaderDocument(manualId, pdfData) {
  if (cachedReaderDoc && cachedReaderManualId === Number(manualId)) {
    return cachedReaderDoc;
  }

  if (cachedReaderDoc) {
    try {
      await cachedReaderDoc.destroy();
    } catch {
      // ignora erro ao fechar doc anterior
    }
    cachedReaderDoc = null;
    cachedReaderManualId = null;
  }

  const rawBytes =
    pdfData instanceof Uint8Array
      ? new Uint8Array(pdfData.buffer.slice(pdfData.byteOffset, pdfData.byteOffset + pdfData.byteLength))
      : new Uint8Array(pdfData.slice(0));

  const loadingTask = pdfjsLib.getDocument({
    data: rawBytes,
    useSystemFonts: true,
    isEvalSupported: false
  });

  cachedReaderDoc = await loadingTask.promise;
  cachedReaderManualId = Number(manualId);
  return cachedReaderDoc;
}

/**
 * Fecha o documento PDF ativo na memória do leitor.
 */
export async function closeReaderDocument() {
  if (activeRenderTask) {
    try {
      activeRenderTask.cancel();
    } catch {
      // ignora
    }
    activeRenderTask = null;
  }
  if (cachedReaderDoc) {
    try {
      await cachedReaderDoc.destroy();
    } catch {
      // ignora
    }
    cachedReaderDoc = null;
    cachedReaderManualId = null;
  }
}

/**
 * Renderiza uma página do PDF em um elemento <canvas> de alta definição e
 * posiciona caixas de destaque (highlights) sobre os termos pesquisados na página.
 *
 * @param {Object} params
 * @param {number} params.manualId
 * @param {Uint8Array|ArrayBuffer} params.pdfData
 * @param {number} params.pageNumber
 * @param {HTMLCanvasElement} params.canvas
 * @param {HTMLElement} params.highlightLayer
 * @param {Array<string>} [params.highlightTerms=[]]
 * @param {number} [params.zoomScale=1.0]
 * @param {number} [params.containerWidth=360]
 * @returns {Promise<{ matchCountOnCanvas: number, totalPages: number }>}
 */
export async function renderPdfPage({
  manualId,
  pdfData,
  pageNumber,
  canvas,
  highlightLayer,
  highlightTerms = [],
  zoomScale = 1.0,
  containerWidth = 360
}) {
  if (activeRenderTask) {
    try {
      activeRenderTask.cancel();
    } catch {
      // ignora cancelamento
    }
    activeRenderTask = null;
  }

  const pdfDoc = await getOrOpenReaderDocument(manualId, pdfData);
  const clampedPage = Math.max(1, Math.min(Number(pageNumber) || 1, pdfDoc.numPages));
  const page = await pdfDoc.getPage(clampedPage);

  // Calcula escala responsiva ao container mobile/desktop + zoom do usuário
  const unscaledViewport = page.getViewport({ scale: 1 });
  const targetWidth = Math.max(280, Math.min(containerWidth - 24, 920));
  const baseScale = targetWidth / unscaledViewport.width;
  const cssScale = baseScale * zoomScale;

  const viewport = page.getViewport({ scale: cssScale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  if (highlightLayer) {
    highlightLayer.style.width = `${Math.floor(viewport.width)}px`;
    highlightLayer.style.height = `${Math.floor(viewport.height)}px`;
    highlightLayer.innerHTML = '';
  }

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;

  activeRenderTask = page.render({
    canvasContext: ctx,
    transform,
    viewport
  });

  await activeRenderTask.promise;
  activeRenderTask = null;

  // Renderiza os destaques dos termos pesquisados sobre o Canvas
  let matchCountOnCanvas = 0;
  const normalizedTerms = (highlightTerms || [])
    .map(normalizeTerm)
    .filter((t) => t.length >= 2 || /\d/.test(t));

  if (highlightLayer && normalizedTerms.length > 0) {
    const textContent = await page.getTextContent();
    matchCountOnCanvas = renderCanvasHighlights(
      textContent.items,
      viewport,
      highlightLayer,
      normalizedTerms
    );
  }

  return {
    matchCountOnCanvas,
    totalPages: pdfDoc.numPages
  };
}

/**
 * Posiciona caixas de destaque translúcidas sobre os itens de texto do PDF que contêm os termos buscados.
 *
 * @param {Array<Object>} textItems
 * @param {Object} viewport
 * @param {HTMLElement} highlightLayer
 * @param {Array<string>} normalizedTerms
 * @returns {number} Quantidade de elementos destacados
 */
function renderCanvasHighlights(textItems, viewport, highlightLayer, normalizedTerms) {
  let count = 0;
  const fragment = document.createDocumentFragment();

  for (const item of textItems) {
    if (!item.str || !item.str.trim()) continue;
    const rawStr = item.str;
    const normItem = Array.from(rawStr)
      .map((ch) =>
        ch
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
      )
      .join('');

    if (!normItem) continue;

    // Localiza todos os intervalos [start, end] dos termos buscados dentro deste item de texto
    const intervals = [];
    for (const term of normalizedTerms) {
      if (!term) continue;
      let pos = 0;
      while (pos < normItem.length) {
        const idx = normItem.indexOf(term, pos);
        if (idx === -1) break;
        intervals.push([idx, idx + term.length]);
        pos = idx + Math.max(1, term.length);
      }
    }

    if (intervals.length === 0) continue;

    // Mescla intervalos sobrepostos na mesma linha
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

    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const baseX = tx[4];
    const baseY = tx[5];
    const fontHeight = Math.max(10, Math.hypot(tx[2], tx[3]));
    const totalItemWidth = Math.max(14, (item.width || rawStr.length * 5.2) * viewport.scale);
    const totalChars = Math.max(1, normItem.length);

    for (const [startIdx, endIdx] of merged) {
      const startRatio = startIdx / totalChars;
      const spanRatio = (endIdx - startIdx) / totalChars;
      const boxX = baseX + totalItemWidth * startRatio;
      const boxW = Math.max(14, totalItemWidth * spanRatio);

      const markBox = document.createElement('div');
      markBox.className = 'pdf-canvas-highlight';
      markBox.style.left = `${Math.max(0, boxX - 2)}px`;
      markBox.style.top = `${Math.max(0, baseY - fontHeight * 0.88)}px`;
      markBox.style.width = `${boxW + 4}px`;
      markBox.style.height = `${fontHeight * 1.18}px`;
      markBox.title = rawStr.slice(startIdx, endIdx);

      fragment.appendChild(markBox);
      count++;
    }
  }

  highlightLayer.appendChild(fragment);
  return count;
}

/**
 * Constrói em memória um arquivo PDF válido de 5 páginas contendo um Manual Técnico Industrial completo
 * (Inversor de Frequência WEG CFW500 & Bomba Centrífuga KSB) para testes imediatos 100% offline.
 *
 * @returns {ArrayBuffer}
 */
export function generateDemoTechnicalManualPdf() {
  const pagesData = [
    {
      header: 'MANUAL TECNICO DE CAMPO - INVERSOR CFW500 & BOMBA KSB',
      sub: 'Pagina 1 de 5 | Secao 1: Especificacoes Eletricas, Torque e Instalacao',
      lines: [
        '1. ESPECIFICACOES DE ALIMENTACAO ELETRICA E POTENCIA',
        '-----------------------------------------------------------------------',
        'Modelo de Referencia: Inversor de Frequencia WEG CFW500-C (Quadro Mec C)',
        'Tensao Nominal de Entrada: 380V a 440V CA Trifasico (50/60 Hz)',
        'Tolerancia de Tensao Permitida: -15% a +10% (323V min / 484V max)',
        'Corrente Nominal de Saida (HD): 32.0 A | Potencia do Motor: 15 CV (11 kW)',
        '',
        '2. ESPECIFICACOES DE TORQUE DE APERTO E CABEAMENTO',
        '-----------------------------------------------------------------------',
        'Bornes de Potencia (R/L1, S/L2, T/L3 e U, V, W): Torque de 25 Nm',
        'Parafuso de Aterramento de Protecao (PE): Torque de 42 Nm (Cabo min 10 mm2)',
        'Bornes de Controle e Entradas Digitais (DI1 a DI4): Torque de 0.5 Nm',
        '',
        '3. REQUISITOS DE VENTILACAO E FILTRO RFI',
        '-----------------------------------------------------------------------',
        'Espacamento minimo superior e inferior no painel eletrico: 110 mm.',
        'Temperatura ambiente de operacao nominal: -10 C ate +50 C sem derating.',
        'Para ambientes com alta interferencia eletromagnetica, ativar o filtro RFI',
        'interno conectando o grampo de aterramento metalico na chapa Terra.'
      ]
    },
    {
      header: 'MANUAL TECNICO DE CAMPO - INVERSOR CFW500 & BOMBA KSB',
      sub: 'Pagina 2 de 5 | Secao 2: Diagnostico de Falhas e Alarmes (F0021 a A0046)',
      lines: [
        'TABELA DE CODIGOS DE FALHA E SOLUCAO DE PROBLEMAS (TROUBLESHOOTING)',
        '-----------------------------------------------------------------------',
        'CODIGO F0021 — Subtensao no Barramento CC (Link DC Undervoltage):',
        '  Causa: Tensao de alimentacao abaixo do limite minimo (< 323V CA) ou',
        '  falta de fase na entrada trifasica L1/L2/L3.',
        '  Acao Corretiva: Medir tensao nas fases de entrada com multimetro True-RMS;',
        '  reapertar bornes de potencia (25 Nm) e verificar contator principal K1.',
        '',
        'CODIGO F0022 — Sobretensao no Barramento CC (Overvoltage > 810V CC):',
        '  Causa: Inercia elevada da carga durante a frenagem ou rampa muito curta.',
        '  Acao Corretiva: Aumentar o tempo de desaceleracao no parametro P0101',
        '  ou instalar resistor de frenagem reostatica nos bornes BR e +UD.',
        '',
        'CODIGO F0070 — Sobrecorrente ou Curto-Circuito na Saida (U, V, W):',
        '  Causa: Curto entre fases do cabo do motor, isolacao danificada ou',
        '  rotor da bomba hidraulica travado mecanicamente.',
        '  Acao Corretiva: Desconectar o motor, medir resistencia de isolamento',
        '  com megohmetro (500V CC > 100 MOhm) e girar o eixo da bomba manualmente.',
        '',
        'CODIGO A0046 — Alarme de Sobrecarga no Motor / Superaquecimento PTC:',
        '  Causa: Corrente acima de 110% por mais de 60s ou ventilacao obstruida.'
      ]
    },
    {
      header: 'MANUAL TECNICO DE CAMPO - INVERSOR CFW500 & BOMBA KSB',
      sub: 'Pagina 3 de 5 | Secao 3: Parametrizacao e Rede RS-485 Modbus RTU',
      lines: [
        'PARAMETROS ESSENCIAIS DE CONFIGURACAO E COMISSIONAMENTO',
        '-----------------------------------------------------------------------',
        'P0000 = 0005 : Senha de acesso para liberacao de escrita nos parametros',
        'P0100 = 10.0 s : Tempo de aceleracao linear (0 ate 60 Hz)',
        'P0101 = 15.0 s : Tempo de desaceleracao segura (evita falha F0022)',
        'P0133 = 18.0 Hz : Frequencia minima de operacao da bomba centrifuga',
        'P0134 = 60.0 Hz : Frequencia maxima nominal do motor assincrono',
        'P0202 = 5 (VVW) : Modo de controle vetorial de tensao WEG',
        'P0401 = 31.5 A : Corrente nominal do motor gravada na placa de identificacao',
        '',
        'CONFIGURACAO DA INTERFACE SERIAL RS-485 (PROTOCOLO MODBUS RTU)',
        '-----------------------------------------------------------------------',
        'P0308 = 1 a 247 : Endereco do escravo na rede Modbus RTU (Padrao: 1)',
        'P0310 = 2 : Taxa de transmissao (Baud Rate) = 19200 bps',
        'P0311 = 2 : Formato dos bytes = 8 bits de dados, Paridade Par, 1 Stop Bit',
        'P0313 = 2 : Acao para erro de comunicacao F0228 (Causar parada por rampa)',
        'Terminacao RS-485: Ativar chaves DIP S1.1 e S1.2 em ON (resistor 120 Ohms)',
        'somente no primeiro e no ultimo equipamento do barramento diferencial A/B.'
      ]
    },
    {
      header: 'MANUAL TECNICO DE CAMPO - INVERSOR CFW500 & BOMBA KSB',
      sub: 'Pagina 4 de 5 | Secao 4: Manutencao da Bomba Hidraulica e Selo Mecanico',
      lines: [
        'ESPECIFICACOES HIDRAULICAS E MECANICAS — BOMBA CENTRIFUGA KSB MEGANORM',
        '-----------------------------------------------------------------------',
        'Vazao Nominal de Projeto: 120 m3/h | Pressao de Recalque: 6.5 bar (65 mca)',
        ' Pressao Minima de Succao (NPSH disponivel): 4.2 mca (evita cavitacao)',
        'Rolamentos do Mancal: Par de rolamentos de esferas SKF 6309-C3',
        'Lubrificacao: Graxa a base de sabao de litio NLGI 2 a cada 4000 horas.',
        '',
        'PROCEDIMENTO DE SUBSTITUICAO DO SELO MECANICO E ALINHAMENTO',
        '-----------------------------------------------------------------------',
        '1. Fechar as valvulas de bloqueio de succao e recalque e drenar a carcaca.',
        '2. Inspecionar as faces lapidadas do selo mecanico de carbeto de silicio;',
        '   substituir o conjunto caso haja vazamento superior a 3 gotas/minuto.',
        '3. Verificar a folga axial do rotor (0.15 mm a 0.25 mm) com relogio comparador.',
        '4. Executar alinhamento a laser do acoplamento elastico entre motor e bomba:',
        '   Desalinhamento radial maximo admissivel: 0.05 mm',
        '   Desalinhamento angular maximo admissivel: 0.04 mm / 100 mm',
        '',
        'SINTOMA DE CAVITACAO: Ruido de crepitacao metalica na voluta e oscilacao',
        'de corrente eletrica. Limpar filtro Y da linha de succao imediatamente.'
      ]
    },
    {
      header: 'MANUAL TECNICO DE CAMPO - INVERSOR CFW500 & BOMBA KSB',
      sub: 'Pagina 5 de 5 | Secao 5: Seguranca NR-10, LOTO e Descarga de Capacitores',
      lines: [
        'PROCEDIMENTO OBRIGATORIO DE BLOQUEIO E ETIQUETAGEM (NR-10 / LOTO)',
        '-----------------------------------------------------------------------',
        'PERIGO DE CHOQUE ELETRICO MORTAL — TENSAO RESIDUAL NO BARRAMENTO CC!',
        'Mesmo apos desligar o disjuntor geral Q1, o banco de capacitores eletroliticos',
        'mantem tensao elevada acima de 540V CC.',
        '',
        'PASSO A PASSO PARA INTERVENCAO SEGURA:',
        '1. Comandar parada do inversor e abrir a seccionadora sob carga.',
        '2. Aplicar cadeado de bloqueio individual (LOTO) e etiqueta de identificacao.',
        '3. AGUARDAR NO MINIMO 10 MINUTOS para descarga completa dos capacitores.',
        '4. Medir a tensao CC entre os bornes (+UD) e (-UD) com multimetro categoria',
        '   CAT III 1000V. Somente iniciar manutencao quando a leitura for < 24V CC.',
        '',
        'CHECKLIST DE COMISSIONAMENTO POS-MANUTENCAO',
        '-----------------------------------------------------------------------',
        '[OK] Resistencia de aterramento PE inferior a 1.0 Ohm',
        '[OK] Sentido de rotacao horario confirmado via comando JOG (5 Hz)',
        '[OK] Ausencia de vibracao excessiva (< 2.8 mm/s RMS conforme ISO 10816)',
        '[OK] Parametros salvos na memoria flash (P0204 = 9 - Backup concluido)'
      ]
    }
  ];

  return buildMultiPagePdfBinary(pagesData);
}

/**
 * Construtor leve de PDF 1.4 multipágina válido em puro JavaScript.
 * @param {Array<{header: string, sub: string, lines: Array<string>}>} pagesData
 * @returns {ArrayBuffer}
 */
function buildMultiPagePdfBinary(pagesData) {
  const escapePdfText = (str) =>
    String(str)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/—/g, '-');

  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length; // 1-based object ID
  };

  // Obj 1: Catalog (placeholder), Obj 2: Pages (placeholder), Obj 3: Font Helvetica, Obj 4: Font Helvetica-Bold
  addObj(''); // 1
  addObj(''); // 2
  const fontRegularId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBoldId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const pageObjIds = [];

  for (const page of pagesData) {
    const streamLines = [];
    // Faixa superior escura do cabeçalho técnico
    streamLines.push('0.08 0.12 0.22 rg');
    streamLines.push('36 765 523 48 re f');
    // Linha de destaque âmbar
    streamLines.push('0.96 0.62 0.04 rg');
    streamLines.push('36 762 523 3 re f');

    // Título branco no cabeçalho
    streamLines.push('BT');
    streamLines.push('/F2 11 Tf');
    streamLines.push('1 1 1 rg');
    streamLines.push(`48 793 Td (${escapePdfText(page.header)}) Tj`);
    streamLines.push('/F1 9 Tf');
    streamLines.push('0.96 0.78 0.35 rg');
    streamLines.push(`0 -16 Td (${escapePdfText(page.sub)}) Tj`);
    streamLines.push('ET');

    // Corpo do texto da página
    let y = 730;
    for (const line of page.lines) {
      const isHeading =
        line === line.toUpperCase() && line.length > 8 && !line.startsWith('---') && !line.startsWith('[');
      const isDivider = line.startsWith('---');

      if (isDivider) {
        streamLines.push('0.82 0.85 0.90 RG 0.8 w');
        streamLines.push(`44 ${y + 4} m 548 ${y + 4} l S`);
        y -= 14;
        continue;
      }

      if (line.trim().length > 0) {
        streamLines.push('BT');
        if (isHeading) {
          streamLines.push('/F2 10.5 Tf');
          streamLines.push('0.08 0.22 0.45 rg');
        } else {
          streamLines.push('/F1 10 Tf');
          streamLines.push('0.12 0.16 0.23 rg');
        }
        streamLines.push(`44 ${y} Td (${escapePdfText(line)}) Tj`);
        streamLines.push('ET');
      }
      y -= isHeading ? 18 : 16;
    }

    // Rodapé técnico
    streamLines.push('0.50 0.55 0.62 rg');
    streamLines.push('BT /F1 8 Tf 44 32 Td (TechManual Offline PWA - Documento Tecnico Indexado Localmente) Tj ET');

    const streamContent = streamLines.join('\n');
    const contentId = addObj(`<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`);

    const pageId = addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageObjIds.push(pageId);
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`;

  let pdfStr = '%PDF-1.4\n';
  const offsets = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdfStr.length);
    pdfStr += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = pdfStr.length;
  pdfStr += `xref\n0 ${objects.length + 1}\n`;
  pdfStr += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdfStr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  pdfStr += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const encoder = new TextEncoder();
  return encoder.encode(pdfStr).buffer;
}
