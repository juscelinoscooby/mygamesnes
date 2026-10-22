# Super Game Boy SNES Pocket — Console Portátil Moderno (PWA & Mobile)

Emulador portátil de Super Nintendo com carcaça moderna em modo paisagem (landscape) com botões e empunhaduras ergonômicas em preto fosco e acentos em laranja vibrante, controles virtuais multi-touch, carregador local de ROMs com nomes amigáveis e núcleo SNES WASM 100% offline (sem dependência de CDN externa).

---

## 🚀 Como Executar Localmente

### Opção 1: Servidor HTTP Nativo (Recomendado — Zero Dependências)
```bash
# Na pasta do projeto:
node server.js
```
Acesse no navegador:
- **Computador:** `http://localhost:5173`
- **Celular / Dispositivo Móvel:** `http://<IP-DO-SEU-PC>:5173` (conectado na mesma rede Wi-Fi)

> 💡 **Por que usar servidor HTTP?**  
> Os navegadores modernos bloqueiam o carregamento de WebAssembly (`.data`/`.wasm`) e requisições assíncronas do Service Worker quando abertos diretamente pelo protocolo `file:///`. O `server.js` fornece os cabeçalhos de segurança corretos (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`, PWA headers).

---

## 📱 Instalação como Aplicativo (PWA Mobile)

1. Abra `http://<IP-DO-SEU-PC>:5173` no **Chrome** (Android) ou **Safari** (iOS).
2. **Android:** Toque em `⋮` (menu) ➔ **"Instalar aplicativo"** ou **"Adicionar à tela inicial"**.
3. **iOS (iPhone/iPad):** Toque no botão de compartilhamento ➔ **"Adicionar à Tela de Início"**.
4. O app abre em tela cheia, sem barra de endereços do navegador, e salva todo o núcleo SNES para rodar **100% offline**.

---

## 📦 Empacotamento Nativo com Capacitor (Android / iOS)

O projeto já inclui o arquivo `capacitor.config.json` configurado:

```bash
# 1. Instalar dependências do Capacitor (quando desejar compilar o APK nativo)
npm install @capacitor/core @capacitor/cli @capacitor/android

# 2. Criar o projeto Android nativo
npx cap add android

# 3. Copiar os arquivos web para o app Android
npx cap sync

# 4. Abrir no Android Studio para gerar o APK
npx cap open android
```

---

## 🎮 Recursos Implementados

1. **Visor LCD Game Boy com Pastas Alfabéticas A-Z:**
   - A biblioteca de 290 jogos é exibida no visor verde organizada em pastas alfabéticas (`Pasta A`, `Pasta B`, ... `Pasta X`).
   - Navegue pelas pastas usando o **D-Pad (▲ / ▼)**.
   - Pressione o **Botão A** para abrir a pasta selecionada e ver os jogos contidos nela.
   - Pressione o **Botão B** para voltar da pasta para a lista de letras A-Z.
   - Inicie qualquer jogo com o **Botão A**.
   - Alterne abas (Jogos / Opções / Ajuda) com o **D-Pad (◀ / ▶)** ou **L / R**.

2. **Menu Pause no Jogo:**
   - Durante o jogo, pressione **SELECT + START** juntos ou clique no botão **MENU** para pausar e abrir o menu sobreposto sem perder o progresso.
   - Pressione **B** para retomar o jogo.

3. **Núcleo WASM Local:**
   - Localizado em `emulator/cores/snes9x-wasm.data`.
   - Loader e CSS 100% locais em `emulator/`.
   - Carregamento instantâneo sem depender de servidores CDN externos.

4. **Multi-Touch & Mobile Safe Areas:**
   - Suporte completo a múltiplos toques simultâneos (correr e pular ao mesmo tempo).
   - `touch-action: none` e desativação de gestos de zoom do navegador.
   - Compatível com entalhes de câmera (Notch / Dynamic Island) via `viewport-fit=cover`.

5. **Aba Ajuda — Desenvolvedor & Apoio ao Projeto:**
   - Criado pelo **técnico Juscelino**, criador do projeto SNES Boy Pocket.
   - Código no GitHub: [`github.com/juscelinoscooby/mygamesnes`](https://github.com/juscelinoscooby/mygamesnes).
   - **Ajude o projeto:** doe via **PIX** escaneando o QR Code exibido na aba **Ajuda** do visor (arquivo `pix-qr.jpeg`).

---

## 🙏 Apoie o Projeto

Se curtiu o SNES Boy Pocket, considere apoiar o trabalho do técnico Juscelino:

- Repositório: [`github.com/juscelinoscooby/mygamesnes`](https://github.com/juscelinoscooby/mygamesnes)
- **PIX — QR Code:** abra o app na aba **Ajuda** e escaneie o QR Code no visor, ou use o arquivo [`pix-qr.jpeg`](./pix-qr.jpeg) do projeto.
