# ADR 0002: Unified Repository Domain Model

- Status: Accepted
- Date: 2026-05-06

## Context

GitHub and Azure DevOps expose repository metadata with different shapes and field names. The UI and clone workflow should remain provider-agnostic.

## Decision

Introduce a shared `RepositorySummary` domain model and map provider responses into this model in adapter modules.

## Consequences

### Positive

- Renderer logic stays simple and consistent.
- New providers can be introduced by adapter mapping only.
- Clone workflow can remain generic.

### Negative

- Potential loss of provider-specific fields unless explicitly modeled.
- Requires careful mapping validation as APIs evolve.
