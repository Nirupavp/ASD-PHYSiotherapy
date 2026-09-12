# MotionIQ

MotionIQ is a browser-based physiotherapy exercise tracker using MediaPipe pose detection. Its Node.js backend serves the application and persists shared exercise, profile, pose-configuration, and session-report data.

## Run locally

Requires Node.js 18 or newer.

```bash
npm start
```

Open `http://localhost:3000`. The server creates `data/motioniq.json` on first run. That directory is intentionally ignored by Git and is not exposed as a static web path.

## API

All endpoints return JSON and are served from the same origin as the application.

| Endpoint | Methods | Purpose |
| --- | --- | --- |
| `/api/health` | `GET` | Health check |
| `/api/exercises` | `GET`, `POST` | List and create custom exercises |
| `/api/exercises/:id` | `DELETE` | Delete a custom exercise |
| `/api/child-profile` | `GET`, `PUT` | Load and save the child profile |
| `/api/yoga-config` | `GET`, `PUT` | Load and save reference-pose settings |
| `/api/yoga-sessions` | `GET`, `POST` | Read and record yoga sessions |
| `/api/exercise-sessions` | `GET`, `POST` | Read and record exercise sessions |

Use `npm test` to run JavaScript syntax checks.
