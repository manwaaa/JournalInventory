# Journal Proof & Anti-Plagiarism Capture Tool (`VerificationImages`)

A standalone, local-first inventory proof capture and anti-plagiarism verification system engineered for high-throughput journal processing, dual-camera setups, multi-PC pipeline workflows, and automatic cloud synchronization.

---

## 🚀 Key Features

- **Multi-Role Workstation Pipeline**: Seamlessly split work across dedicated stations (Box capture on PC 1, Book capture on PC 2, Full standalone capture, or fast Box + Spine mode).
- **Multi-Camera & Dual-Lens Auto-Switching**: Configure independent cameras for Box-level and Book-level captures with automatic switching, rotation (0°/90°/180°/270°), and horizontal/vertical flipping.
- **Manifest Integration (Excel & CSV)**: Import manifest files (`.xlsx`, `.csv`) with auto-lookup for Title, Volume, Year, Publisher, and Box ID, accompanied by live batch progress bars and completion badges.
- **Multi-PC LAN Peer Synchronization**: Built-in LAN discovery and synchronization allows PC 1 and PC 2 to share captured box proofs, manifest states, and photos in real time.
- **AWS S3 Cloud Backup**: Automated or manual sync to cloud storage with built-in connection testing and real-time upload progress tracking.
- **Mobile Pairing & Remote Wireless Shutter**: Connect a smartphone over LAN via QR code / HTTPS (`https://<IP>:3443`) to use as a mobile camera or remote capture trigger.
- **Rapid Keyboard Shortcuts**: High-speed operator controls for instant photo capture, retakes, and 1-press advancement to the next journal.
- **Export & Verification Utilities**: 1-click **Open in Windows Explorer**, 1-click **Download ZIP**, folder path copying, and `metadata.json` audit logging.

---

## 🔄 Workstation Roles & Pipeline Modes

Easily switch station roles directly from the top navigation bar:

| Role | Shots Captured | Description |
| :--- | :--- | :--- |
| **📦 PC 1 (Box: 1-2)** | Shots 1 & 2 | Captures exterior box angles (`1_box_angle_a.jpg`, `2_box_angle_b.jpg`) and advances to the next box. Syncs proofs to PC 2 over LAN. |
| **📖 PC 2 (Book: 3-7)** | Shots 3 to 7 | Inherits Shots 1 & 2 from PC 1. Captures individual book photos (Front Cover, Spine, Title Page, Edition Notice, Back Cover). |
| **📚 Full (1-7)** | Shots 1 to 7 | Full all-in-one workstation capturing all 7 shots sequentially per journal. Run multiple full PCs in parallel for 2x speed. |
| **📦 Box + Spine (1, 2, 4)** | Shots 1, 2, & 4 | Streamlined express mode capturing only Box Angles A & B and the Book Spine. Automatically skips shots 3, 5, 6, and 7. |

---

## 📸 Standard 7-Shot Capture Specification

Photos are automatically saved in `C:\Journal_Proofs\<ISBN>\` (or your configured custom directory):

| Shot # | Filename | Perspective / Content | Verification Target |
| :---: | :--- | :--- | :--- |
| **1** | `1_box_angle_a.jpg` | **Box Angle A** | Front & Side perspective view of the journal storage box. |
| **2** | `2_box_angle_b.jpg` | **Box Angle B** | Top & Opposite Side view showing box labels and condition. |
| **3** | `3_front_cover.jpg` | **Front Cover** | Direct overhead / flat view of the journal's front cover. |
| **4** | `4_spine.jpg` | **Spine / Binding** | Tilted side angle capturing spine thickness, lettering, and binding. |
| **5** | `5_title_page.jpg` | **Title & Author Page** | Clear view of the publication title, authors, and contributors. |
| **6** | `6_edition_notice.jpg` | **Edition & Copyright** | Imprint page displaying copyright year, publisher, and edition info. |
| **7** | `7_back_cover.jpg` | **Back Cover & Barcode** | Back cover displaying barcode, price, summary, and identifiers. |

---

## ⌨️ Keyboard Shortcuts Reference

| Key | Action | Description |
| :--- | :--- | :--- |
| <kbd>Space</kbd> | **Capture Photo** | Triggers camera shutter for current active shot. |
| <kbd>Enter</kbd> | **Proceed to Next** | Finalizes review and instantly resets workflow for the next journal/box. |
| <kbd>R</kbd> | **Retake Current Shot** | Discards the current shot and reactivates the live viewfinder. |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> | **Undo Last Capture** | Steps back to the previous shot in the sequence. |

---

## 🚀 Quick Start (Production Workstations)

### Easiest Method (Windows)
Double-click `start_system.bat` in the project root directory.

This script will automatically:
1. Compile the latest frontend bundle.
2. Launch the web interface at `http://localhost:3001` in your default browser.
3. Start the Node.js backend server (HTTP: `3001`, Mobile HTTPS: `3443`).

---

### 🌐 2-PC LAN Pipeline Setup

To split capture duties between two PCs:
1. **On PC 1**: Run `start_system.bat`. Note down PC 1's local IP address (e.g. `192.168.1.50`).
2. **On PC 2**: Open a web browser and navigate to:
   ```
   http://<PC1-IP-ADDRESS>:3001
   ```
3. In the top navigation bar:
   - Select **`📦 PC 1 (Box: 1-2)`** on PC 1.
   - Select **`📖 PC 2 (Book: 3-7)`** on PC 2.
4. Both workstations will immediately share the same storage folder, manifest data, and live photos in real time!

---

## ☁️ Cloud S3 Backup Configuration

The system is pre-configured with AWS S3 cloud synchronization:

- **S3 Bucket Name**: `innoscanmussgp1-s3`
- **AWS Region**: `ap-southeast-1`
- **Folder Prefix (Path)**: `innoscanmussgp1/JournalVerificationImages/`

To configure or test credentials:
1. Click the **⚙️ Settings** icon in the top navigation bar.
2. Scroll to the **AWS S3 Cloud Backup** card.
3. Enter your **Access Key ID** and **Secret Access Key**.
4. Click **Test S3 Connection** to verify bucket connectivity.
5. Click **Save Settings**.

---

## 💻 Manual Setup & Development

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- Modern web browser (Chrome, Edge, Firefox) with WebRTC camera permissions

### Manual Installation & Start
```bash
# 1. Install backend dependencies
cd backend
npm install

# 2. Install frontend dependencies and build
cd ../frontend
npm install
npm run build

# 3. Start the production backend server
cd ../backend
node server.js
```
The server will start on port `3001` (and port `3443` for mobile HTTPS pairing).

### Development Mode (with Vite HMR)
```bash
# Terminal 1: Backend
cd backend
node server.js

# Terminal 2: Frontend with Hot Module Replacement
cd frontend
npm run dev
```

---

## 📁 Directory Structure

```
JournalInventory/
├── backend/
│   ├── manifest.json         # Current active manifest store
│   ├── system_config.json    # Persistent system settings & S3 credentials
│   ├── server.js             # Express API, LAN sync, S3 integration, HTTPS server
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/       # UI Components (Navbar, CameraViewfinder, StepProgressBar, etc.)
│   │   ├── hooks/            # Custom hooks (useCamera, useAudio, useSessionSync)
│   │   ├── types/            # TypeScript interfaces & types
│   │   ├── App.tsx           # Main application root
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── start_system.bat          # 1-Click launcher script for Windows workstations
└── README.md
```
