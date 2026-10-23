# APK Offline — Super Game Boy SNES Pocket

## APK sem ROMs (padrão) — baixa sob clique e cacheia
- `dist/` leve: `index.html` + `emulator/` (WASM local) + `games/games.json` (índice) + `sw.js`, `manifest.*`, `icon-*`. ROMs `.smc` NÃO entram no APK.
- Fluxo: usuário abre **Jogos → Pasta → jogo** (ícone `↓ baixa`). Clique baixa ROM via `raw.githubusercontent.com/.../games/<PASTA>/arquivo.smc`, salva blob em **IndexedDB `SNESGameBoyDB/roms`**, persiste sessões. Próximo clique joga offline (ícone `● pronto`). Chip LCD mostra `BAIXANDO 12%` com progresso.
- Offline e não cacheado → erro amigável: "Sem rede e jogo não está em cache."
- `sw.js` não cacheia `.smc/.sfc` (evita duplicar MB); `games.json` é network-first.
- `capacitor.config.json` (`com.snesboy.pocket`, `webDir: dist`, landscape).

## Gerar APK no PC (Windows)
### Pré-requisitos
1. **Android Studio** + **Android SDK** + **SDK Platform Tools**.
2. `ANDROID_HOME` definido. Java 17+.

### Build debug
```bat
cd D:\dev\nimble-turing\nimble-turing
npm install
npm run build
npm run prepare:cap
npx cap sync
npx cap open android
```
No Android Studio: **Build → Build APK(s)** → `android\app\build\outputs\apk\debug\app-debug.apk`

Ou CLI:
```bat
cd android
.\gradlew assembleDebug
```

### APK com ROMs (opcional, pesado ~500MB)
```bat
node scripts/prepare-capacitor-dist.mjs --with-roms
npx cap sync
```
Ou direto: `xcopy /E /I games dist\games` + `npx cap sync`

### Scripts
- `npm run build` + `npm run prepare:cap` (copia `emulator/`, `games/games.json`, etc.)
- `npm run cap:sync` / `npm run cap:open` / `npm run apk`

## Estrutura
```
dist/
  index.html
  emulator/           # WASM local offline
  games/games.json    # índice (↓/● no visor)
  sw.js, manifest.*, icon-*.png, pix-qr.jpeg
android/
  app/src/main/assets/public/  # cópia de dist/
```

## Notas técnicas
- IndexedDB `SNESGameBoyDB` `STORE roms` `keyPath id` persiste app fechado. `getRomById(id)` hit direto antes de baixar.
- Duplo clique bloqueado por `downloadInFlight`. Progresso via `fetch` stream + `Content-Length`.
- SW `snes-boy-v8-cache` precacheia emulator + manifests; ignora `.smc/.sfc`.
