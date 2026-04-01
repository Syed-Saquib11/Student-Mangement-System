# Student Management System

Portable Electron app for local computer center management.

## Setup

```bash
npm install
npm start
```

## Project Structure

```
student-management-system/
├── package.json
├── data/
│   └── database.db          ← auto-created on first run
└── src/
    ├── backend/
    │   ├── database/
    │   │   └── db.js         ← DB connection ONLY
    │   ├── models/
    │   │   └── student-model.js  ← all SQL for students
    │   └── services/
    │       └── student-service.js  ← business logic
    ├── main/
    │   ├── main.js           ← Electron entry, IPC handlers
    │   └── preload.js        ← secure renderer ↔ main bridge
    └── renderer/
        ├── pages/
        │   └── index.html    ← main shell
        ├── css/
        │   ├── main.css      ← global design system
        │   └── student.css   ← student page styles
        └── js/
            ├── renderer.js   ← routing, toasts, nav
            └── student.js    ← student page UI logic
```

## Architecture Rules (DO NOT BREAK)

- ❌ Renderer NEVER talks to DB directly
- ❌ SQL NEVER goes in main.js
- ✅ SQL lives only in `backend/models/`
- ✅ Business logic lives only in `backend/services/`
- ✅ IPC channels defined in preload.js + main.js

## Build Order (Phases)

- [x] Phase 1: Students (add/edit/delete/search)
- [x] Phase 2: Courses
- [x] Phase 3: Test & Grade
- [ ] Phase 4: Slots / Batches
- [ ] Phase 5: Forms & Document
- [ ] Phase 6: Fees
- [ ] Phase 7: Dashboard

- [ ] Phase 8: ID Card generation
- [ ] Phase 9: Google Forms integration
