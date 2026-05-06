# ADR 0003: Credential Storage and Authenticated Clone Strategy

- Status: Accepted
- Date: 2026-05-06

## Context

The user needs one-click cloning for repositories across platforms. API listing and clone operations need credentials.

## Decision

- Persist credentials in a local user-scoped JSON settings file.
- Build authenticated clone URLs in main process only.
- Never expose token-bearing URLs to renderer.

## Consequences

### Positive

- Provides frictionless one-click cloning.
- Centralizes credential usage and handling in a privileged process.
- Reduces accidental secret leaks through UI rendering.

### Negative

- Local settings storage requires machine-level trust.
- Token rotation must be handled by updating settings.
