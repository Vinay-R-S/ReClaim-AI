# ADR 0008: Firestore listeners for chat, not a socket tier

## Status

Proposed. Phase 29.

## Context

The handover email sends the finder's raw email address to the owner and tells
two strangers to meet in person. That is a PII disclosure and a personal-safety
gap, and the fix is a channel inside the platform with a record of what was
said (defect SEC-22).

A chat feature needs realtime delivery. The options are a dedicated socket tier
or the realtime primitive already in the stack.

| Option                       | Pros                                                                                                                   | Cons                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Firestore snapshot listeners | No new infrastructure, realtime out of the box, and access control lives in `firestore.rules` next to every other rule | Read costs scale with listeners, no presence or typing indicators, message ordering needs care |
| A socket tier                | Presence, typing, read receipts, full control of the protocol                                                          | Another service, its own scaling and auth story, and a second place where access control lives |

The second cost of a socket tier is the one that decides it. Access control for
private messages between two strangers is exactly the thing that must not live
in two places.

## Decision

Reads are Firestore snapshot listeners, scoped by security rules to the two
participants plus admins. Writes go through the API like every other write in
this system.

That split is deliberate. The API write is what allows PII to be masked
**before** the message is persisted, rate limits to be enforced per sender, and
an outbox row to be written for the asynchronous classifiers. A client writing
straight to Firestore could do none of those.

## Consequences

- No new infrastructure, and the rules that protect a conversation are tested
  by the same emulator suite as every other rule.
- No presence or typing indicators. For a two-party conversation about
  returning an object, that is an acceptable loss.
- Read cost scales with open listeners. At two participants plus an occasional
  moderator per conversation, it is negligible.
- Admin supervision is a first-class case, not an afterthought: an admin can
  list conversations by risk, read any thread, post as a badged moderator, and
  freeze or close a thread. Every admin read of a conversation is itself
  audit-logged, because reading two users' private messages is a privileged
  action.

## Revisit when

- Presence, typing indicators or read receipts become requirements.
- Listener read costs become a visible line in the bill.
- Group conversations appear, for example a moderator plus both parties plus a
  site contact, where fan-out changes the arithmetic.
