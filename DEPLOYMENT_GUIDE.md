# 🚀 Complete Deployment Guide: Vercel + Render (Automated CI/CD)

This guide shows how to deploy your **Journal Proof & Anti-Plagiarism Capture Tool** to **Render** (Backend API) and **Vercel** (Frontend App).

Once completed, whenever you make changes to the code, all you have to do is push to GitHub (`git push origin main`). **Vercel and Render will automatically rebuild and deploy your changes in ~1–2 minutes.** You will never need to manually copy code or setup batch files on users' PCs again.

---

## 📌 Architecture Overview

| Component | Platform | Role |
| :--- | :--- | :--- |
| **Frontend** | **Vercel** | Fast, globally-distributed React/Vite web application with valid public HTTPS. |
| **Backend** | **Render** | Node.js Express API service managing ISBN processing, metadata, and AWS S3 syncing. |
| **Storage** | **AWS S3** | Permanent cloud storage for photos (`innoscanmussgp1-s3`) across all workstations. |

---

## 🛠️ Step 1: Deploy Backend to Render

1. Go to [Render.com](https://render.com) and Sign In (using your GitHub account).
2. On your dashboard, click **New +** $\rightarrow$ **Web Service**.
3. Select **Build and deploy from a Git repository** and connect your repository: `manwaaa/JournalInventory`.
4. Configure the service settings:
   - **Name**: `journal-inventory-backend` (or your preferred name)
   - **Region**: `Singapore (Southeast Asia)`
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: `Free` (or Starter)

5. Under **Environment Variables**, click **Add Environment Variable** and add the following:

   | Key | Value | Note |
   | :--- | :--- | :--- |
   | `NODE_ENV` | `production` | Production mode |
   | `AWS_REGION` | `ap-southeast-1` | AWS S3 Region |
   | `AWS_S3_BUCKET` | `innoscanmussgp1-s3` | Your S3 Bucket |
   | `AWS_ACCESS_KEY_ID` | `(your AWS Access Key ID)` | S3 access key |
   | `AWS_SECRET_ACCESS_KEY` | `(your AWS Secret Key)` | S3 secret key |
   | `AWS_PREFIX` | `innoscanmussgp1/JournalVerificationImages/` | S3 folder prefix |

6. Click **Create Web Service**.
7. Wait ~2 minutes for the build to finish. Once deployed, Render will display your backend URL (for example: `https://journal-inventory-backend.onrender.com`).
   - You can test it by opening `https://your-backend.onrender.com/api/health` in your browser. It should display `{"status":"ok"}`.

---

## 🎨 Step 2: Connect Frontend `vercel.json` to your Backend URL

1. Open `frontend/vercel.json` in your project.
2. Replace `https://journal-inventory-backend.onrender.com` with your actual Render backend URL if your service name was different:
   ```json
   {
     "rewrites": [
       {
         "source": "/api/:path*",
         "destination": "https://YOUR-BACKEND-NAME.onrender.com/api/:path*"
       },
       {
         "source": "/proofs/:path*",
         "destination": "https://YOUR-BACKEND-NAME.onrender.com/proofs/:path*"
       },
       {
         "source": "/((?!api/|proofs/).*)",
         "destination": "/index.html"
       }
     ]
   }
   ```
3. Commit and push this change to GitHub:
   ```bash
   git add frontend/vercel.json
   git commit -m "Update Render backend URL in vercel.json"
   git push origin main
   ```

---

## ⚡ Step 3: Deploy Frontend to Vercel

1. Go to [Vercel.com](https://vercel.com) and Sign In (using your GitHub account).
2. Click **Add New...** $\rightarrow$ **Project**.
3. Import your GitHub repository: `JournalInventory`.
4. Configure the Project:
   - **Framework Preset**: `Vite`
   - **Root Directory**: Click *Edit* and select `frontend` (Click **Continue**).
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
5. Click **Deploy**.
6. In ~1 minute, Vercel will give you a live production URL (for example: `https://journal-inventory.vercel.app`).

---

## 🔄 Daily Workflow: How to Update the System Automatically

Now, whenever you fix a bug, add a feature, or change the UI:

1. Make your code changes on your computer.
2. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "Add new feature or bug fix"
   git push origin main
   ```
3. **That's it!**
   - Vercel will automatically detect the push and deploy the updated frontend.
   - Render will automatically detect the push and deploy the updated backend.
   - **Every operator/user visiting the web link will instantly see the latest update upon refreshing their browser.**
   - No source code distribution, no `.bat` files, no manual configuration needed!

---

## 📱 Mobile Smartphone Capture on Cloud

When operators use the system on Vercel:
1. Click **Smartphone Lens** (Mobile Pairing).
2. The QR Code will automatically generate the cloud HTTPS link.
3. Operators can scan the QR code with any smartphone camera—it will instantly open the mobile capture interface over secure HTTPS with no certificate warnings and zero setup!

