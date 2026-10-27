# ADR-0009: Cashier PINs hashed with bcrypt in the database

**Status:** Accepted · **Date:** 2026-10-23

## Context

The blueprint asks for Argon2id PIN hashes, but PostgreSQL (pgcrypto) cannot compute Argon2id, and PIN checks must happen inside the same transaction as the lane unlock.

## Decision

Hash PINs with `extensions.crypt(pin, gen_salt('bf', 10))`; hide `members.pin_hash` from the API with column grants; lock a cashier after 5 wrong PINs for 15 minutes. PIN-checking functions return `{ok:false}` instead of raising so the failure count is kept.

## Consequences

- PINs are short; the lockout, not the hash, is the main defence.
- Revisit if PIN checks move to an Edge Function.
