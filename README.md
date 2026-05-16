# Final Year Project Fast(NUCES) Karachi

Contributors:
22k-4478 Usman Tanveer
22k-4473 Jaswant lal
22k-4641 Muhammad Huzaifa

# VerifiKar

VerifiKar is a location-aware civic incident verification system with a FastAPI backend, background worker, model server, and a React Native (Expo) mobile app.

## Repositories

- Backend: VerifiKar-BE
- Frontend: VerifiKarFE

## Requirements

- Node.js 18+ (for the frontend)
- Python 3.10+ (for the backend)
- Expo Go (for running the app on a device)

## Quick Start (VS Code Tasks)

Use the preconfigured tasks in this workspace:

1) Run `VerifiKar: Start All 4` to start:
   - API (FastAPI)
   - Worker (ARQ)
   - Model server
   - Frontend (Expo)

2) Optional: Run `VerifiKar: Close All Terminals` to stop everything.

## Frontend Setup

1) Install dependencies:
   - `npm install`

2) Update the API URL:
   - Edit `VerifiKarFE/config.js` and set `API_BASE_URL` to your machine IP (e.g., `http://192.168.x.x:8000`).

3) Start the frontend:
   - Use the `VerifiKar: Frontend` task, or run `npm start` from `VerifiKarFE`.

## Backend Setup

1) Create and activate a virtual environment, then install dependencies:
   - `python -m venv .venv`
   - `.
.venv\Scripts\Activate.ps1`
   - `pip install -r VerifiKar-BE\requirements.txt`

2) Start services (or use tasks):
   - API: `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`
   - Worker: `arq app.worker.WorkerSettings`
   - Model server: `uvicorn app.services.model_server:app --host 0.0.0.0 --port 8001`

## API Endpoints

- API health: `http://localhost:8000/health`
- Model health: `http://localhost:8001/health`

## Troubleshooting

- If the app cannot reach the API, verify `API_BASE_URL` in `VerifiKarFE/config.js`.
- For device testing, ensure your phone and PC are on the same WiFi network.
- If Expo cache causes issues, run `npx expo start --clear`.

## Project Structure

- VerifiKar-BE/ (FastAPI backend, worker, model server)
- VerifiKarFE/ (React Native app)
- scripts in the repo root for cluster maintenance
