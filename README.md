# Journal Proof & Anti-Plagiarism Capture Tool

Standalone, local-first inventory tool designed for anti-plagiarism verification and photo proof capture of Journal books.

## Workflow Overview
1. **Scan ISBN**: Scan the barcode or enter the ISBN manually. The system immediately creates the dedicated folder on the local machine (default: `C:\Journal_Proofs\<ISBN>\`).
2. **Shot 1 (Front Cover & Spine Angle)**: Capture a tilted 30° perspective showing the front cover and book spine/side thickness. Automatically saved as `1_front_spine.jpg`.
3. **Shot 2 (Author & Title Page Angle)**: Flip the page to the title page and capture the author's name clearly. Automatically saved as `2_author_title.jpg`.
4. **Instant Verification & Export**:
   - `metadata.json` generated with timestamps and operator details.
   - 1-click **Open in Windows Explorer**.
   - 1-click **Download ZIP** package.
   - 1-click **Copy Folder Path**.
   - Instant workflow reset for next scan.

## Design
Built with the exact same visual identity, typography (Sora font), ambient gradients, and UI tokens as iBookTrack.

## Quick Start (Inventory PCs)
Simply double-click `start.bat` on your desktop. It will automatically initialize dependencies, build the application, and open `http://localhost:3001` in your browser.

## Manual Start
```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies and build
cd ../frontend
npm install
npm run build

# Start production server
cd ../backend
node server.js
```
The server will start on `http://localhost:3001` and is accessible across the local network (LAN) by any inventory PC.

### 🌐 2-PC Pipeline Setup (Easiest Method)
1. Run `start_system.bat` on **PC 1**.
2. On **PC 2**, open the web browser and navigate to:
   ```
   http://<PC1-IP-ADDRESS>:3001
   ```
3. Set **PC 1** to `📦 PC 1 (Box: 1-2)` and **PC 2** to `📖 PC 2 (Book: 3-7)` in the top navigation bar. Both PCs will immediately share the same storage folder, manifest, and live photos over the local network!

S3 Bucket Name = innoscanmussgp1-s3
AWS Region = ap-southeast-1
Folder Prefix (Path) = innoscanmussgp1/JournalVerificationImages/
