# 🎓 HelpMeLearn - AI Document Test Generator & Study Platform

**HelpMeLearn** is a full-stack study platform designed for **100% free hosting on Azure Cloud Free Tier** (Azure App Service F1 or Azure Static Web Apps + Functions). It accepts **PDF** or **Word (.docx)** documents, parses content, and automatically generates randomized, multiple-choice practice exams with detailed explanations and verbatim document quotes for every question.

---

## ✨ Features

- 📄 **Document Input**: Drag-and-drop support for PDF (`.pdf`), Word (`.docx`), and Text (`.txt`) files up to 25MB.
- ⚡ **Automated Question Bank Generation**: Generates extensive pools of multiple-choice questions (MCQs) with 4 choices (A, B, C, D), difficulty ratings, and detailed explanations.
- 📖 **Document Citation Quotes**: Shows verbatim supporting quotes extracted directly from the uploaded document explaining why the correct answer is right and incorrect choices are wrong.
- 🔀 **Randomized Practice Exams**: Processed documents and question banks are stored permanently. Take tests as many times as you like. Each test run randomly samples questions (choose 5, 10, 20, or All) and shuffles options.
- 🗑️ **Document & Test Management**: Full capability to manage, view, review, and delete documents, question banks, and historical test attempts.
- 📊 **Performance Analytics**: Tracks test scores, completion time, pass/fail ratios, and historical attempt analytics.
- ☁️ **Azure Cloud Free Compatibility**: Works out of the box with zero external database cost using SQLite and a built-in **Smart Offline Question Generator** (with optional support for Azure OpenAI, OpenAI, and Google Gemini API keys).

---

## 🚀 Quick Start (Local Run)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
# or for auto-reload during development
npm run dev
```

### 3. Open in Browser
Open your browser and navigate to:
```
http://localhost:3000
```

---

## ☁️ Deploying to Azure Cloud (100% Free Tier)

HelpMeLearn is optimized for **Azure App Service (Free F1 Tier)**.

### Method A: One-Click Azure CLI Script
Make sure you have the [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed, then run:

```bash
chmod +x deploy-azure.sh
./deploy-azure.sh
```

### Method B: Manual Azure CLI Commands
```bash
# 1. Create Resource Group
az group create --name rg-helpmelearn --location eastus

# 2. Create Free Tier App Service Plan (F1 SKU)
az appservice plan create --name plan-helpmelearn-free --resource-group rg-helpmelearn --sku F1 --is-linux

# 3. Create Web App
az webapp create --name my-helpmelearn-app --resource-group rg-helpmelearn --plan plan-helpmelearn-free --runtime "NODE:20-lts"

# 4. Deploy code
az webapp up --resource-group rg-helpmelearn --name my-helpmelearn-app
```

Your app will be live at: `https://<your-app-name>.azurewebsites.net`.

---

## 🧪 Sample Documents Included for Testing

A sample study guide is included in `./samples/`:
- `samples/sample_cloud_computing.txt`: Cloud Computing & Azure Architecture overview.

You can also drag and drop any of your own PDF or `.docx` files directly into the UI!

---

## 🛠️ Tech Stack & Architecture

- **Backend**: Node.js, Express, Multer
- **Parsers**: `pdf-parse` (PDF extraction), `mammoth` (DOCX extraction)
- **Database**: SQLite3 (`./data/helpmelearn.db` - persistent zero-cost storage)
- **AI Engine**: Flexible provider router (Smart Offline Text Analysis + Azure OpenAI / OpenAI GPT-4o / Google Gemini API support)
- **Frontend**: Vanilla CSS Glassmorphism SPA (No heavy framework required, instant load speed)
- **Hosting**: Azure App Service (F1 Free Tier)
