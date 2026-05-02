# Stage 1

## Campus Notification System — REST API Design

### Overview

The Campus Notification Platform delivers real-time updates to students across three categories: **Placements**, **Events**, and **Results**. Students are pre-authorised; no login/registration is required.

---

### Core Actions & REST Endpoints

#### 1. Get All Notifications

```
GET /api/notifications
Authorization: Bearer <token>
```

**Response (200)**
```json
{
  "status": "success",
  "total_count": 30,
  "notifications": [
    {
      "ID": "d146095a-0d86-4a34-9e69-3900a14576bc",
      "Type": "Result",
      "Message": "mid-sem",
      "Timestamp": "2026-04-22 17:51:30"
    }
  ]
}
```

---

#### 2. Get Top N Priority Notifications (Priority Inbox)

```
GET /api/notifications/priority?n=10
Authorization: Bearer <token>
```

**Query Params**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `n`   | int  | 10      | Number of top notifications to return |

**Response (200)**
```json
{
  "status": "success",
  "returned_count": 10,
  "priority_notifications": [
    {
      "ID": "...",
      "Type": "Placement",
      "Message": "CSX Corporation hiring",
      "Timestamp": "2026-04-22 17:51:18",
      "priority_score": 1.98
    }
  ]
}
```

---

#### 3. Get Notifications by Type

```
GET /api/notifications?type=Placement
Authorization: Bearer <token>
```

**Query Params**
| Param  | Type   | Values                      |
|--------|--------|-----------------------------|
| `type` | string | `Placement`, `Result`, `Event` |

---

#### 4. Mark Notification as Read

```
PATCH /api/notifications/{id}/read
Authorization: Bearer <token>
```

**Response (200)**
```json
{ "status": "success", "message": "Notification marked as read" }
```

---

#### 5. Get Notification by ID

```
GET /api/notifications/{id}
Authorization: Bearer <token>
```

---

#### 6. Delete a Notification

```
DELETE /api/notifications/{id}
Authorization: Bearer <token>
```

---

### Real-Time Notification Mechanism: **WebSockets**

For real-time delivery, use **WebSocket** connections (native browser support, low latency, full-duplex).

```
WS  /ws/notifications
Authorization: Bearer <token>   (sent as query param or first message)
```

**Rationale over alternatives:**
- **SSE (Server-Sent Events)** — unidirectional only; cannot send read/ack events back
- **Polling** — inefficient at scale (50k students × every 5s = 250k req/5s)
- **WebSockets** — bidirectional, persistent connection, push-on-event model

**Flow:**
1. Student connects to `/ws/notifications`
2. Server pushes notification JSON when a new event occurs
3. Client acknowledges with `{ "action": "ack", "id": "..." }`

---

### Headers

| Header          | Value                      |
|-----------------|----------------------------|
| `Authorization` | `Bearer <access_token>`    |
| `Content-Type`  | `application/json`         |

---

# Stage 2

## Database Schema & Persistent Storage

### Recommended DB: **PostgreSQL**

**Rationale:**
- Relational model suits structured notification data (typed, timestamped, per-student)
- Native support for `ENUM` types (notification_type)
- Excellent indexing support (B-tree, composite, partial indexes)
- JSONB column available for extensible metadata
- Better concurrency than MySQL via MVCC

---

### Schema

```sql
-- Enum type for notification categories
CREATE TYPE notification_type AS ENUM ('Placement', 'Result', 'Event');

-- Students table
CREATE TABLE students (
    student_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(100) NOT NULL,
    email        VARCHAR(150) UNIQUE NOT NULL,
    roll_no      VARCHAR(30)  UNIQUE NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Notifications table
CREATE TABLE notifications (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type             notification_type NOT NULL,
    message          TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata         JSONB
);

-- Student-Notification join (tracks read status per student)
CREATE TABLE student_notifications (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id       UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    notification_id  UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    is_read          BOOLEAN NOT NULL DEFAULT FALSE,
    read_at          TIMESTAMPTZ,
    UNIQUE(student_id, notification_id)
);
```

---

### Key Queries (matching Stage 1 API contracts)

**Fetch all unread notifications for a student:**
```sql
SELECT n.id, n.type, n.message, n.created_at
FROM notifications n
JOIN student_notifications sn ON sn.notification_id = n.id
WHERE sn.student_id = $1
  AND sn.is_read = FALSE
ORDER BY n.created_at DESC;
```

**Fetch notifications by type:**
```sql
SELECT n.id, n.type, n.message, n.created_at
FROM notifications n
JOIN student_notifications sn ON sn.notification_id = n.id
WHERE sn.student_id = $1
  AND n.type = $2::notification_type
ORDER BY n.created_at DESC;
```

**Mark notification as read:**
```sql
UPDATE student_notifications
SET is_read = TRUE, read_at = NOW()
WHERE student_id = $1 AND notification_id = $2;
```

---

### Scalability Problems at High Volume

| Problem | Cause | Impact |
|---------|-------|--------|
| Slow unread queries | Full table scan on `student_notifications` | Latency spikes |
| `student_notifications` growth | 50k students × N notifications = millions of rows | Bloat |
| Write amplification on `notify_all` | 50k INSERT operations in a loop | DB overload |
| Join cost | `notifications JOIN student_notifications` without indexes | Slow at 5M rows |

---

# Stage 3

## Query Optimisation Analysis

### Original Query

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

### Is This Query Accurate?

**No — the schema should use a join table** (`student_notifications`) for read status tracking, since a single notification goes to multiple students. Embedding `studentID` and `isRead` directly in `notifications` violates normalisation (a notification row per student = massive duplication).

**Corrected query** (with proper normalised schema):
```sql
SELECT n.id, n.type, n.message, n.created_at
FROM notifications n
JOIN student_notifications sn ON sn.notification_id = n.id
WHERE sn.student_id = 1042
  AND sn.is_read = FALSE
ORDER BY n.created_at DESC;
```

---

### Why Is The Original Query Slow?

With 5,000,000 rows:
- `studentID = 1042` and `isRead = false` require a **full table scan** (sequential scan)
- `ORDER BY createdAt DESC` requires an **in-memory sort** of matched rows
- **Approximate cost**: O(n) scan + O(m log m) sort where n=5M, m=unread count

---

### Should We Index Every Column?

**No — this advice is not effective.**

**Why adding indexes on every column is harmful:**
1. Each index adds **write overhead** — every INSERT/UPDATE/DELETE must update all indexes
2. `notify_all` (50k inserts) would become significantly slower
3. Indexes consume **significant disk space** (each B-tree index can be 20-30% of table size)
4. The query planner may choose wrong indexes if too many exist
5. Low-cardinality columns like `isRead` (only 2 values) make poor standalone indexes

**Recommended indexes instead:**

```sql
-- Composite index: covers the WHERE clause AND the ORDER BY
CREATE INDEX idx_student_notifications_lookup
ON student_notifications (student_id, is_read, notification_id);

-- Index on created_at for range/sort queries
CREATE INDEX idx_notifications_created_at
ON notifications (created_at DESC);

-- Partial index: only indexes unread rows (much smaller, much faster)
CREATE INDEX idx_student_notifications_unread
ON student_notifications (student_id, notification_id)
WHERE is_read = FALSE;
```

The **partial index** (`WHERE is_read = FALSE`) is especially powerful — it only indexes the rows that the unread query cares about, making it much smaller and faster than a full index.

---

### Query: All Students With a Placement Notification in the Last 7 Days

```sql
SELECT DISTINCT s.student_id, s.name, s.email
FROM students s
JOIN student_notifications sn ON sn.student_id = s.student_id
JOIN notifications n ON n.id = sn.notification_id
WHERE n.type = 'Placement'::notification_type
  AND n.created_at >= NOW() - INTERVAL '7 days';
```

---

# Stage 4

## Performance Strategy: Reducing DB Load on Page Load

### Problem

Fetching notifications from DB on **every page load** for **50,000 students** causes:
- Repeated identical queries per student
- DB connection pool exhaustion
- Cascading latency

---

### Recommended Solution: Multi-Layer Caching

#### Layer 1: In-Memory Cache (Redis)

Cache each student's unread notification list in Redis with a short TTL.

```
Key:   notifications:unread:{student_id}
Value: JSON array of notification objects
TTL:   60 seconds
```

**Flow:**
1. Page loads → check Redis cache
2. Cache HIT → return immediately (no DB query)
3. Cache MISS → query DB → store in Redis → return

**Invalidation:** When a new notification is broadcast or a student reads a notification, delete their cache key.

```python
# Cache lookup
cache_key = f"notifications:unread:{student_id}"
cached = redis.get(cache_key)
if cached:
    return json.loads(cached)

# Cache miss
result = db.query(...)
redis.setex(cache_key, 60, json.dumps(result))
return result
```

#### Layer 2: HTTP Cache Headers

For the notifications API, set `Cache-Control` headers so the browser caches responses:
```
Cache-Control: private, max-age=30
```

#### Layer 3: Pagination

Never return all notifications at once. Paginate:
```
GET /api/notifications?page=1&limit=20
```

---

### Tradeoffs

| Strategy | Benefit | Tradeoff |
|----------|---------|----------|
| Redis cache (60s TTL) | Eliminates 90%+ of DB reads | Stale data up to 60s |
| HTTP Cache-Control | Zero server hit on refresh | User may see old data |
| Pagination | Reduces response size | Requires frontend pagination logic |
| WebSocket push | Real-time, no polling | Persistent connection overhead |

**Best approach for 50k students:** Redis + Pagination + WebSocket push for new notifications (so clients don't need to poll).

---

# Stage 5

## Redesigning `notify_all` for Reliability

### Original Pseudocode Issues

```python
function notify_all(student_ids: array, message: string):
    for student_id in student_ids:
        send_email(student_id, message)   # synchronous — blocks
        save_to_db(student_id, message)   # tightly coupled to email
        push_to_app(student_id, message)  # real-time push
```

**Shortcomings:**
1. **Synchronous serial loop** — 50k iterations in sequence = very slow (minutes)
2. **No error handling** — if `send_email` fails for student 200, processing stops for 49,800 remaining students
3. **Tight coupling** — email, DB write, and push happen together; one failure blocks all
4. **No retry logic** — transient failures (network blip) cause permanent missed notifications
5. **DB in the loop** — 50k individual INSERT statements overwhelms the DB connection pool
6. **No atomicity** — if process crashes at student 25,000, we have no way to resume

---

### Scenario: `send_email` Failed for 200 Students Midway

With the original design, we don't know which 200 students failed. The DB may or may not have been written. There is no recovery path.

---

### Redesigned Solution: Message Queue + Async Workers

```python
function notify_all(student_ids: array, message: string):
    # Step 1: Bulk insert notifications into DB (single batch write)
    notification_id = db.bulk_insert_notifications(student_ids, message)
    Log("backend", "info", "service",
        f"Bulk inserted notification for {len(student_ids)} students, id={notification_id}")

    # Step 2: Publish a single job to the message queue
    queue.publish("notification_fanout", {
        "notification_id": notification_id,
        "student_ids": student_ids,
        "message": message
    })
    Log("backend", "info", "service", "Fanout job published to message queue")

    # Step 3: Return immediately — processing is async
    return { "status": "queued", "notification_id": notification_id }


# Worker (runs in parallel, multiple instances)
function notification_worker(job):
    batch = job.student_ids  # Workers receive smaller batches (e.g., 500 students)

    for student_id in batch:
        try:
            send_email(student_id, job.message)          # Email API
            push_to_app(student_id, job.notification_id) # WebSocket/FCM push
            db.mark_delivered(student_id, job.notification_id)
            Log("backend", "info", "service", f"Notification delivered to {student_id}")
        except EmailError as e:
            Log("backend", "error", "handler",
                f"Email failed for {student_id}: {e} — queuing for retry")
            retry_queue.publish("email_retry", {
                "student_id": student_id,
                "notification_id": job.notification_id,
                "attempt": job.attempt + 1
            })
```

---

### Should DB Save and Email Happen Together?

**No — they should be decoupled.**

- **DB write first**: Saving to DB is the source of truth. It should happen immediately and atomically (batch insert) before any delivery attempt.
- **Email delivery is best-effort**: Email APIs can fail, be rate-limited, or be slow. Coupling the DB write to the email call means DB writes fail when email fails — that's wrong.
- **Pattern**: Write-ahead → Queue → Deliver → Mark delivered

This way, if email fails, the notification is already persisted. A retry worker can re-attempt delivery from the DB record.

---

# Stage 6

## Priority Inbox — Implementation Approach

### Algorithm Design

The Priority Inbox selects the top N most important notifications using a **composite priority score**:

```
priority_score = (type_weight × 0.65) + (recency_score × 0.35)
```

**Type Weights:**
| Type      | Weight |
|-----------|--------|
| Placement | 3      |
| Result    | 2      |
| Event     | 1      |

**Recency Score:**
- Decays linearly from 3 → 0 over a 7-day window
- `recency_score = max(0, 1 - age_seconds / 604800) × 3`

**Why this formula?**
- Type weight is the primary signal (65%) — a Placement is always more important than an Event
- Recency prevents stale Placements from permanently dominating over very recent Events
- Weights (0.65/0.35) can be tuned per product requirements

---

### Efficient Top-N Maintenance

**Data Structure: Min-Heap of size n**

```python
heap = []  # min-heap of (score, index, notification)

for idx, notif in enumerate(all_notifications):
    score = calculate_priority_score(notif)
    if len(heap) < n:
        heappush(heap, (score, idx, notif))
    elif score > heap[0][0]:
        heapreplace(heap, (score, idx, notif))  # Eject lowest, add current
```

- **Time**: O(k log n) — k = total notifications, n = inbox size
- **Space**: O(n) — only the top n are kept in memory
- **Why not sort all?** O(k log k) — much worse when k >> n (e.g., 10,000 notifications, top 10)

---

### Handling New Notifications (Streaming)

As new notifications arrive (via WebSocket or queue), maintain the heap dynamically:

```python
def on_new_notification(notif, heap, n):
    score = calculate_priority_score(notif)
    if len(heap) < n:
        heappush(heap, (score, notif))
    elif score > heap[0][0]:
        heapreplace(heap, (score, notif))
    # heap always contains the current top n — O(log n) per update
```

This ensures the Priority Inbox stays current **without reprocessing all notifications** — O(log n) per new notification.

---

### API Endpoint

```
GET /api/notifications/priority?n=10
Authorization: Bearer <token>
```

**Response:**
```json
{
  "status": "success",
  "returned_count": 10,
  "scoring_info": {
    "type_weights": { "Placement": 3, "Result": 2, "Event": 1 },
    "formula": "score = (type_weight × 0.65) + (recency_score × 0.35)"
  },
  "priority_notifications": [
    {
      "ID": "b283218f-ea5a-4b7c-93a9-1f2f240d64b0",
      "Type": "Placement",
      "Message": "CSX Corporation hiring",
      "Timestamp": "2026-04-22 17:51:18",
      "priority_score": 1.9923,
      "type_weight": 3
    }
  ]
}
```

### Implementation

See `notification_app_be/priority_inbox.py` for the complete working implementation.
