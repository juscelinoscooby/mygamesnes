# APK Offline — Super Game Boy SNES Pocket

## O que já está pronto (neste commit)
- `dist/` leve para APK: `index.html` + `emulator/` (WASM local) + `games/games.json` (índice, sem as ROMs) + `sw.js`, `manifest.*`, `icon-*`. ROMs ficam em `games/A-Z/*.smc` — não entram no APK para não gerar 500 MB; o app lista via `games.json` e, offline, o usuário adiciona ROM via **Opções → Adicionar ROM** (IndexedDB) ou você pode empacotar ROMs escolhidas em `dist/games/<LETRA>/`.
- `capacitor.config.json` (`com.snesboy.pocket`, `webDir: dist`, landscape).
- `android/` criado via `npx cap add android` e sincronizado (assets copiados para `android/app/src/main/assets/public`).
- Scripts:
  - `npm run build` + `npm run prepare:cap` (equivale a `vite build` + copiar `emulator/`, `games/games.json`, etc. para `dist/`).
  - `npm run cap:sync` / `npm run cap:open` / `npm run apk` (`vite build + prepare + cap sync`).

## Por que não gerei o .apk aqui
Esta máquina (sandbox Linux do Claude Desktop) não tem **Android SDK / Gradle**. O `android/gradlew` exige SDK que não está instalado aqui. O projeto está 100% preparado; o APK precisa ser compilado na sua máquina (Windows) com Android Studio.

## Gerar o APK no seu PC (Windows)

### Pré-requisitos (uma vez)
1. Instalar **Android Studio** (https://developer.android.com/studio) com **Android SDK** e **SDK Platform Tools**.
2. Definir `ANDROID_HOME` (ex: `C:\Users\SeuUsuario\AppData\Local\Android\Sdk`) — o instalador já faz.
3. Instalar Java 17+ (Android Studio já traz).

### Build APK debug (instala direto no celular, sem Play Store)
```bat
cd D:\dev\nimble-turing\nimble-turing
npm install
npm run build
npm run prepare:cap
npx cap sync
npx cap open android
```
No Android Studio que abrir:
- Menu **Build → Build APK(s)** (ou `Build → Build Bundle(s)/APK(s) → Build APK(s)`).
- APK sai em `android\app\build\outputs\apk\debug\app-debug.apk` — copie para o celular e instale.

Ou direto por linha de comando (sem abrir IDE):
```bat
cd android
.\gradlew assembleDebug
```
APK em `android\app\build\outputs\apk\debug\app-debug.apk`.

### APK release assinado (para distribuir)
1. Gerar keystore: `keytool -genkey -v -keystore snesboy.jks -keyalg RSA -keysize 2048 -validity 10000 -alias snesboy`
2. Criar `android/key.properties` com `storeFile`, `storePassword`, `keyAlias`, `keyPassword`.
3. Configurar `android/app/build.gradle` para `signingConfigs` e `.\gradlew assembleRelease`.

### Incluir ROMs no APK (opcional)
Por padrão só vai `games/games.json` (lista). Para jogar 100% offline com ROMs no APK:
```bat
xcopy /E /I games dist\games
npx cap sync
```
Atenção: cada letra A-Z com ROMs .smc pesa ~500 MB; o APK ficará grande. Para distribuição, prefira deixar ROMs externas e usar IndexedDB.

## Estrutura
```
dist/
  index.html
  emulator/           # WASM local (funciona offline)
  games/games.json    # índice (offline)
  sw.js, manifest.*, icon-*.png, pix-qr.jpeg
android/
  app/src/main/assets/public/  # cópia de dist/ no APK
```

## Offline
Com `dist` + `android` assim, o APK roda sem internet (motor local + games.json local). Falhas de CDN não afetam. ROMs carregadas via `file://`/`capacitor://` são lidas de `dist/games/` ou do IndexedDB.
