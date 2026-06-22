# AuthClaw Local Startup Guide

To run AuthClaw properly from a fresh state, you need to start its core infrastructure, the backend API, the Go gateway proxy, and the Next.js frontend.

Follow these steps in order using separate terminal windows (or tabs) from the root of the project (`c:\Users\WIN10\Desktop\0_AuthClaw`).

## IMPORTANT

Make sure Docker Desktop is running before starting these steps.

## 1. Start Infrastructure (Docker)

AuthClaw relies on several containers for its databases, message brokers, and policy engines.

1. Open a terminal in `0_AuthClaw`.
2. Run the following command to start all services in the background:

```powershell
docker-compose up -d
```

> **NOTE**
>
> This starts PostgreSQL, Redis, ClickHouse, Kafka, OPA (Port 8181), and Presidio (Port 3000).

## 2. Start the Backend API (Python)

The backend manages the orchestration, database interactions, and compliance workflows.

1. Open a new terminal and navigate to the backend folder:

```powershell
cd backend
```

2. Activate the virtual environment:

```powershell
.venv\Scripts\activate
```

3. Start the FastAPI server:

```powershell
python -m uvicorn main:app --port 8000 --reload
```

## 3. Start the Gateway Proxy (Go)

The Go Gateway acts as the reverse proxy for LLM requests, applying HITL and Redaction (Presidio) policies.

1. Open a new terminal and navigate to the gateway folder:

```powershell
cd gateway
```

2. Start the Go server:

```powershell
go run .
```

Alternatively, you can run the Python wrapper script from the project root:

```powershell
python run_gateway.py
```

## 4. Start the Console UI (Next.js)

The console is the web dashboard where you manage tenants, chat with the AI, and view compliance scans.

1. Open a new terminal and navigate to the console folder:

```powershell
cd console
```

2. Start the Next.js development server:

```powershell
npm run dev
```

## Verification

Once everything is running, you should be able to access:

- **AuthClaw UI:** http://localhost:3000  
  > Note: Next.js defaults to port 3000, but if Presidio took port 3000, Next.js might launch on port 3001. Check your terminal output.

- **Backend API Docs:** http://localhost:8000/docs

- **Gateway:** Listens on http://localhost:8080