# Rumo ao Milhão — web app

Personal investment tracker that runs in the browser and can be installed on the iPhone Home Screen.

* **Your data never leaves your phone.** It is stored in the app's own storage on the device, encrypted with your 6-digit PIN (AES-GCM 256, key derived with PBKDF2).
* This folder contains **only the app code** — no personal data. It is safe for it to be public.
* Internet is used only to fetch prices: CoinGecko (BTC, ETH, XRP, SOL in US$) and Frankfurter / ECB rates (GBP/BRL, USD/BRL), with open.er-api.com as a fallback. Only coin/currency names are sent.
* Share prices (optional, Ativos tab): brapi (B3 shares), Finnhub (US), Alpha Vantage (London/Europe) and a Google Sheet called "Rumo – Preços B3" (FIIs, via GOOGLEFINANCE). Only ticker symbols are sent. API keys and the sheet link are stored inside the encrypted data, never in this repository.
* Works offline (last saved prices are used).
* Backups: Ajustes → Exportar backup creates a password-encrypted `.json` file. Save it to iCloud Drive or OneDrive. On a new phone: install the app → create a PIN → Importar backup.

Files: `index.html`, `app.css`, `app.js` (all logic), `sw.js` (offline cache), `manifest.webmanifest`, `chart.umd.js` (Chart.js 4.4.1, MIT licence).

To publish an update: replace the files in the GitHub repository. The phone picks up the new version the next time the app opens with internet (sometimes it needs to be closed and opened twice).
