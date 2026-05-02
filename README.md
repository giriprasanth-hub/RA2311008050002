# Campus Notification & Vehicle Scheduling System

A robust Node.js microservices architecture built to handle optimal logistics planning and priority-based notification management. Developed as a solution for evaluating algorithmic problem-solving and system design capabilities.

## 🚀 Overview

This project consists of two independent, yet seamlessly integrated Node.js Express microservices:
1. **Vehicle Maintenance Scheduler (Port 8000)**: Solves the 0/1 Knapsack Problem to generate an optimal daily maintenance schedule maximizing operational impact within limited mechanic-hour budgets across multiple depots.
2. **Campus Notification Priority Inbox (Port 8001)**: Implements an efficient Min-Heap to ingest, score, and rank notifications based on type importance and recency decay.

Both services securely integrate with external evaluation APIs using robust auth-token caching, auto-retry logic, and custom-built centralized logging.

## 📁 Project Structure

```text
.
├── vehicle_scheduling/          # Service 1: Vehicle Maintenance Scheduler
│   ├── index.js                 # Express server & routing
│   ├── scheduler.js             # 0/1 Knapsack implementation
│   └── auth.js                  # Service-specific auth config
├── notification_app_be/         # Service 2: Priority Inbox
│   ├── index.js                 # Express server & routing
│   ├── priorityInbox.js         # Min-Heap & scoring implementation
│   └── auth.js                  # Service-specific auth config
├── logging_middleware/          # Shared custom logging utility
│   └── logger.js                # Formats and POSTs logs to external API
├── tokenManager.js              # Shared token caching & 401 auto-retry
├── testEndpoints.js             # Automated smoke testing script
├── package.json                 # Node.js dependencies and scripts
└── .env                         # Credentials (ignored in Git)
```

## 🛠️ Prerequisites & Setup

1. **Install Node.js** (v18+ recommended)
2. **Clone the repository** and navigate to the project root.
3. **Install Dependencies**:
   ```bash
   npm install
   ```
4. **Configure Environment Variables**:
   Create a `.env` file in the root directory and add your credentials:
   ```env
   EMAIL=your_email@example.com
   NAME="Your Name"
   ROLL_NO=YourRollNo
   ACCESS_CODE=YourAccessCode
   CLIENT_ID=YourClientID
   CLIENT_SECRET=YourClientSecret
   BASE_URL=http://20.207.122.201/evaluation-service
   ```

## 🏃 Running the Services

The repository acts as a monorepo containing both services. They must be run in separate terminals.

**Terminal 1:** Start the Vehicle Scheduler
```bash
npm run start:vehicle
```

**Terminal 2:** Start the Notification Inbox
```bash
npm run start:notification
```

**Terminal 3:** Run the automated smoke tests (Optional)
```bash
npm run test:endpoints
```

## 🌐 API Endpoints

### Vehicle Maintenance Scheduler (Port 8000)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Service health check |
| GET | `/evaluation-service/depots` | Fetch raw depots list (proxy) |
| GET | `/evaluation-service/vehicles` | Fetch raw vehicles list (proxy) |
| GET | `/api/schedule` | Optimal schedule for ALL depots |
| GET | `/api/schedule/:depotId` | Optimal schedule for a specific depot |

### Campus Notification Priority Inbox (Port 8001)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Service health check |
| GET | `/evaluation-service/notifications` | Fetch all raw notifications (proxy) |
| GET | `/evaluation-service/notifications/priority?n=10`| Ranked Priority Inbox (Top N) |

## ⚠️ Important Notes
- **No Databases**: The application adheres to constraints by running completely stateless and in-memory.
- **No External Algorithmic Libraries**: Both the 0/1 Knapsack DP and the Min-Heap are implemented entirely from scratch in raw JavaScript.
- **Production Ready**: The endpoints bind to `0.0.0.0` allowing seamless deployment to live servers, with environment-variable-driven external URLs.
