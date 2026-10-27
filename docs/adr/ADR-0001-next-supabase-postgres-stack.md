# ADR-0001: Next.js + Supabase + PostgreSQL stack

**Status:** Accepted · **Date:** 2026-10-15

## Context

LaneOS needs a cloud POS with a browser lane, a back office, a platform admin area and strict multi-tenant data rules, built by four developers who know TypeScript and SQL.

## Decision

Use Next.js (App Router, TypeScript) on Vercel for every UI and the server layer, and Supabase (PostgreSQL 17, Auth, Storage, Edge Functions, pg_cron) for data, identity and jobs. Business rules live in PostgreSQL functions; Next.js validates input and calls them.

## Consequences

- One language for UI and server; one database with transactions for money and stock.
- Vendor reliance on Supabase and Vercel; data stays in plain PostgreSQL (portable).
- Local development uses the linked staging project when Docker is unavailable.
