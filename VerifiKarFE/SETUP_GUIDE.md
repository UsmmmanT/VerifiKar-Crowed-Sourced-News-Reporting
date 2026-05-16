# VerifiKar Frontend - Complete Setup Guide

This guide will help you set up and run the VerifiKar mobile app on a new device from scratch.

---

## Prerequisites Checklist

### 1. Install Node.js (v18 or higher recommended)
- [ ] Download from: https://nodejs.org/
- [ ] Verify installation:
  ```powershell
  node --version   # Should show v18.x.x or higher
  npm --version    # Should show 9.x.x or higher
  ```

### 2. Install Git
- [ ] Download from: https://git-scm.com/
- [ ] Verify installation:
  ```powershell
  git --version
  ```

### 3. Install Expo Go on Your Phone
- [ ] **Android**: Download "Expo Go" from Google Play Store
- [ ] **iOS**: Download "Expo Go" from App Store

### 4. (Optional) Android Studio for Emulator
- [ ] Download from: https://developer.android.com/studio
- [ ] During setup, ensure "Android Virtual Device" is selected
- [ ] Create an emulator (Pixel 6 with API 33+ recommended)

---

## Project Setup

### Step 1: Clone the Repository
```powershell
git clone https://github.com/huzaifaashoaib/VerifiKarFE.git
cd VerifiKarFE
```

### Step 2: Install Dependencies
```powershell
npm install
```

If you encounter peer dependency issues, use:
```powershell
npm install --legacy-peer-deps
```

### Step 3: Configure API Endpoint
Edit `config.js` in the root folder and update the IP address to your computer's LAN address when testing on a physical device:

```javascript
// config.js
export const API_BASE_URL = 'http://YOUR_COMPUTER_IP:8000';
```

**To find your computer's IP:**
```powershell
ipconfig
# Look for "IPv4 Address" under your active network adapter (e.g., 192.168.x.x)
```

---

## Running the App

### Option A: Run on Physical Device (Recommended)

1. **Ensure your phone and computer are on the same WiFi network**

2. **Start the development server:**
   ```powershell
   npx expo start
   ```

3. **Scan the QR code:**
   - **Android**: Open Expo Go app → Scan QR code
   - **iOS**: Open Camera app → Scan QR code → Tap the notification

### Option B: Run on Android Emulator

1. **Start Android emulator** (via Android Studio or command line)

2. **Start Expo and press 'a':**
   ```powershell
   npx expo start
   # Press 'a' when Metro Bundler is ready
   ```

### Option C: Run on Web Browser
```powershell
npx expo start --web
# Or press 'w' after starting
```

---

## Troubleshooting

### "Network request failed" or API errors
- [ ] Verify backend server is running on port 8000
- [ ] Check that `config.js` has your computer's LAN IP address for physical-device testing
- [ ] Ensure phone and computer are on the same WiFi network
- [ ] Try disabling Windows Firewall temporarily

### "Unable to resolve module" errors
```powershell
# Clear cache and reinstall
rm -r node_modules
rm package-lock.json
npm install --legacy-peer-deps
npx expo start --clear
```

### Expo Go app crashes or white screen
```powershell
# Clear Expo cache
npx expo start --clear
```

### Port already in use
```powershell
# Use a different port
npx expo start --port 8082
```

### Authentication Issues (401 errors on upvote/downvote)
- [ ] Log out and log back in to get a fresh token
- [ ] Ensure backend server is running
- [ ] Check backend terminal for `[AUTH DEBUG]` logs

---

## Backend Setup (Required)

The frontend needs the backend server running. See the backend repository for setup:

### Quick Backend Start (if already set up):
```powershell
cd VerifiKar-BE

# Terminal 1: Start main API server
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2: Start background worker
.\.venv\Scripts\Activate.ps1
arq app.worker.WorkerSettings
```

---

## Project Structure

```
Verifikar_FE/
├── App.js              # Main app entry, navigation, filter modal
├── config.js           # API configuration (update IP here!)
├── package.json        # Dependencies
├── screens/
│   ├── HomeScreen.js   # Main feed with posts, voting, media
│   ├── LoginScreen.js  # User login
│   ├── SignupScreen.js # User registration
│   ├── ReportScreen.js # Submit new reports
│   ├── DiscoverScreen.js
│   ├── ProfileScreen.js
│   └── SettingsScreen.js
├── context/
│   ├── AuthContext.js  # Authentication state management
│   └── FilterContext.js # Filter state for feed
├── components/
│   ├── TopButtons.js
│   └── SettingsDrawer.js
└── styles/
    ├── commonStyles.js
    └── ThemeContext.js # Dark/Light theme
```

---

## Key Features

- 📰 **News Feed**: View posts with images/videos, credibility scores
- 👍👎 **Voting**: Upvote/downvote posts (Reddit-style)
- 🚩 **Flagging**: Report inappropriate content
- 📍 **Location-based**: Filter posts by distance
- 🎬 **Video Playback**: Watch video content with expo-video
- 🌙 **Dark Mode**: Toggle between light/dark themes
- 🔍 **Filters**: Filter by credibility, age, category

---

## Common Commands Reference

| Command | Description |
|---------|-------------|
| `npx expo start` | Start development server |
| `npx expo start --clear` | Start with cache cleared |
| `npx expo start --web` | Start for web browser |
| `npm install` | Install dependencies |
| `npm install --legacy-peer-deps` | Install with legacy peer deps |

---

## Need Help?

1. Check Expo documentation: https://docs.expo.dev/
2. Check React Navigation docs: https://reactnavigation.org/
3. Ensure backend is running and accessible

---

*Last updated: December 2024*
