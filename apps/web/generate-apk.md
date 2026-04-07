# Generate Android APK from DigiLog PWA

## Prerequisites
- Node.js 18+
- Java JDK 21 (installed at C:\Users\hello\ on dev machine)
- Android SDK (installed at C:\Users\hello\ on dev machine)
- Capacitor project at apps/android/

## Option 1: Capacitor (Current Setup)

The project uses Capacitor for Android builds. The Capacitor project is at `apps/android/`.

### Build Steps
```bash
# 1. Build the web app
cd apps/web && npx vite build

# 2. Copy web assets to Capacitor
npx cap copy android

# 3. Open in Android Studio (or build from CLI)
npx cap open android

# 4. Build APK from Android Studio: Build > Build Bundle(s) / APK(s) > Build APK(s)
```

### CLI Build (without Android Studio)
```bash
cd apps/android
./gradlew assembleDebug
# APK at: apps/android/app/build/outputs/apk/debug/app-debug.apk
```

### Install on Tablet
```bash
adb install apps/android/app/build/outputs/apk/debug/app-debug.apk
```

**Important:** The Android app uses HTTP (not HTTPS) for tablet deployment on local networks.

## Option 2: PWABuilder (Easiest — No Setup)

1. Deploy the app to a public URL (e.g., http://34.232.224.0)
2. Go to https://www.pwabuilder.com/
3. Enter your app URL
4. Click "Package for stores" > Android
5. Download the generated APK
6. Install on tablet: `adb install digilog.apk`

## Option 3: Bubblewrap CLI (Local — Full Control)

### Install Bubblewrap
```bash
npm install -g @nicolo-ribaudo/bubblewrap
```

### Initialize TWA Project
```bash
mkdir digilog-twa && cd digilog-twa
bubblewrap init --manifest=http://YOUR_SERVER_IP/manifest.webmanifest
```

### Build APK
```bash
bubblewrap build
```

This generates `app-release-signed.apk` in the current directory.

### Install on Tablet
```bash
adb install app-release-signed.apk
```

## Option 4: Install PWA Directly (Simplest — No APK)

On the Android tablet:
1. Open Chrome browser
2. Navigate to `http://YOUR_SERVER_IP:5175` (dev) or `http://YOUR_SERVER_IP` (production)
3. Chrome shows "Add to Home screen" banner
4. Tap "Install"
5. The app appears as a standalone app with its own icon

This is functionally identical to an APK — full screen, no browser chrome, offline support.

## Real-Time Sync

The app uses SWR polling (30-second intervals) to keep data in sync between web and tablet.
When an operator advances a filter stage on the tablet:
1. Tablet sends POST /api/filters/:id/advance
2. API updates the database
3. Web browser's SWR poll picks up the change within 30 seconds
4. Both views show the same state

For instant sync, the app also supports WebSocket connections that push updates immediately.

## Network Configuration

The tablet must be on the same network as the server.
- Development: `http://YOUR_PC_IP:5175` (Vite dev server)
- Production: `http://YOUR_SERVER_IP` (Nginx)

## Testing on Tablet

1. Find your PC's IP: `ipconfig` (Windows) > look for IPv4 address
2. On tablet Chrome: navigate to `http://192.168.x.x:5175`
3. Login with your credentials
4. Navigate to Filter Operations
5. The PWA prompt will appear after a few seconds

## Phase 2 Mobile Use Cases

The tablet/mobile interface is primary for:
- Filter Operations: scan QR code, advance stages, submit checklists
- Checklist submission: standalone form at `/checklist/:entityId`
- PM schedule execution: record maintenance activities
- Filter traceability: scan and view filter history

---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
