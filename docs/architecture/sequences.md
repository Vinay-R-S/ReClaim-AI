# Sequences

The four flows worth drawing: the ones that cross a boundary, run partly
outside the request, or have to be undone.

## Report to match

Today. Matching runs in the same process after the response has been sent.

```mermaid
sequenceDiagram
    autonumber
    actor R as Reporter
    participant C as Client
    participant A as API
    participant CL as Cloudinary
    participant F as Firestore
    participant L as LLM
    actor AD as Admin

    R->>C: fill the report, pick a location, attach photos
    C->>C: compress images in the browser
    C->>A: POST /api/v1/items
    A->>A: zod validation, sanitize, authorize
    A->>CL: upload images
    CL-->>A: secure URLs
    A->>F: create item, status Pending, moderation pending
    A-->>C: 201 Created
    Note over A,C: the response does not wait for matching

    AD->>A: POST /api/v1/items/:id/moderate approve
    A->>F: moderation approved
    A->>A: triggerAutoMatching, after the response
    A->>F: pending items of the opposite type
    loop each candidate
        A->>L: score this pair
        L-->>A: verdict and score
    end
    A->>F: write the best match, both items to Matched
    Note over A: at most one handover per run
```

Approval is what starts matching, not creation. An unapproved report is
invisible and unmatchable, which is the moderation gate phase 10 introduced.

Where this breaks: the loop. One LLM call per candidate means cost and latency
grow with the corpus, and the work after the response is not durable. Phase 20
moves it behind an outbox, phase 23 replaces the loop with retrieval.

## Match to handover to completion

```mermaid
sequenceDiagram
    autonumber
    actor AD as Admin
    participant A as API
    participant F as Firestore
    participant M as Email
    actor O as Owner
    actor FI as Finder
    participant B as Sepolia

    AD->>A: POST /api/v1/matches/verify isValid true
    A->>F: load both items
    A->>A: validateHandoverCriteria<br/>distance, same day, time window
    alt criteria fail and no override
        A-->>AD: 400 with criteriaFailure
        Note over AD: the admin may override with a written reason
    end
    A->>F: transaction, issue the code<br/>HMAC hash, attempts 0, expiry
    A->>M: six-digit code to the owner
    A->>M: verification link to the finder
    A->>F: both items to Matched

    O->>FI: reads out the code at the meet
    FI->>A: POST /api/v1/handover/verify
    A->>F: transaction, compare hash, count the attempt
    alt wrong code
        A-->>FI: 200 success false, attemptsLeft
        Note over A: three failures block the session,<br/>never the user account
    end
    A->>F: batch, both items Claimed,<br/>match archived, handover record, credits
    A->>B: attestation, best effort
    A->>M: confirmation to both parties
```

The batch is the reliability boundary. Four collections move together; the
chain write and the emails are outside it and are best effort, which is why a
failed email cannot lose a completed handover but also cannot be retried. The
outbox in phase 20 closes that.

A session blocked by three wrong codes has exactly one way back: an admin
re-issues it from the open-handovers panel. The code is hashed, so nobody can
look up the old one.

## Revert (planned, phase 27)

Never a delete. Every forward step has a compensation and they run in reverse.

```mermaid
sequenceDiagram
    autonumber
    actor AD as Admin
    participant A as API
    participant F as Firestore
    participant L as Ledger
    participant B as Sepolia
    participant M as Email

    AD->>A: revertHandover(handoverId, typed reason)
    A->>F: append a reverted event
    A->>M: correction notice to both parties
    A->>B: linked revocation referencing the original transaction
    A->>L: reversing entries, originals untouched
    A->>F: restore the active match record
    A->>F: restore each item's prior status from the event log
    A->>F: invalidate the code
    A-->>AD: reverted, fully audited
```

Two properties make this safe. The prior state is read from the event log
rather than guessed, and credits are corrected with reversing entries rather
than edits, so the history stays true. The operation is idempotent and
admin-only.

## Chat with moderation (planned, phase 29)

Replaces mailing one user's address to another, which is defect SEC-22.

```mermaid
sequenceDiagram
    autonumber
    actor O as Owner
    participant C as Client
    participant A as API
    participant F as Firestore
    participant W as Worker
    participant AI as Safety pipeline
    actor AD as Admin
    actor FI as Finder

    Note over F: a confirmed match creates the conversation
    O->>C: type a message
    C->>A: POST /api/v1/conversations/:id/messages
    A->>AI: deterministic pass, PII patterns and size limits
    AI-->>A: redactions
    A->>F: persist the redacted body, rate limited per sender
    F-->>FI: snapshot listener delivers it
    A->>F: outbox row, message.created
    F-->>W: outbox drain
    W->>AI: classifiers, scam, toxicity, off-platform steering
    AI-->>W: flags and a risk delta
    W->>F: patch the flags, update the conversation risk score
    alt risk above the threshold
        W->>AD: escalate to the moderation queue
        AD->>F: freeze the thread, post as a badged moderator
    end
```

Reads are Firestore snapshot listeners scoped by security rules to the two
participants plus admins, which is [ADR 008](../adr/0008-firestore-chat.md);
writes go through the API like every other write in this system. That split is
what lets PII be masked before the message is persisted rather than hidden at
read time, while the slower classifiers run after delivery so they cannot delay
a message.
