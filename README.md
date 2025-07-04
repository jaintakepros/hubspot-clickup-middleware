# hubspot-clickup-middleware

This project is a middleware API built with **Node.js** and **Express** to synchronize data between **HubSpot** and **ClickUp**. It listens to webhook events from both platforms and processes them to maintain consistency across tasks and tickets.

---

## 🚀 Features

- Receives and handles **HubSpot** webhook events for:
  - Ticket creation and property changes
  - Task creation and property changes
- Receives and processes **ClickUp** task events
- Uses **PostgreSQL** for persistent storage of synchronized items
- Modular design with clear separation of handlers, services, and utilities
- Scheduled tasks (via `node-cron`) for future automation capabilities

---

## 🗂 Project Structure

```
src/
├── server.js                   # Main Express app entry point
├── db/
│   ├── pool.js                # PostgreSQL connection pool
│   └── syncedItems.js        # DB model for synced records
├── handlers/
│   ├── handleClickupTasks.js # Processes ClickUp task events
│   ├── handleHubSpotTask.js  # Handles HubSpot task-related events
│   └── handleHubSpotTicket.js# Handles HubSpot ticket events
├── services/
│   ├── clickup.js            # ClickUp API integration
│   └── hubspot.js            # HubSpot API integration
└── utils/
    ├── cleanQuillDelta.js    # Cleans up rich-text content
    └── statusMapper.js       # Maps statuses between platforms
```

---

## ⚙️ Installation

1. **Clone the repo**

   ```bash
   git clone <your-repo-url>
   cd final-hubspot-clickup-middleware
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Setup environment variables**

   Create a `.env` file in the root directory with the following (as an example):

   ```
   PORT=3000
   DATABASE_URL=postgres://user:password@localhost:5432/yourdb
   HUBSPOT_API_KEY=your_hubspot_key
   CLICKUP_API_KEY=your_clickup_key
   ```

---

## ▶️ Usage

Start the development server:

```bash
node src/server.js
```

The server will start on the port defined in your `.env` file or default to `3000`.

---

## 📬 Webhook Endpoints

- **HubSpot Events**
  ```
  POST /webhook/hubspot/
  ```
  Handles `ticket.creation`, `ticket.propertyChange`, `object.creation`, and `object.propertyChange`.

- **ClickUp Events**
  ```
  POST /webhook/clickup/tasks
  ```
  Processes ClickUp task change payloads.

---

## 📦 Dependencies

- `express`
- `axios`
- `dotenv`
- `pg`
- `node-cron`
- `body-parser`

---

## 📝 License

This project is licensed under the **ISC License**.