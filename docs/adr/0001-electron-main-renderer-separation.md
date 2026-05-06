# ADR 0001: Electron Main/Renderer Separation

- Status: Accepted
- Date: 2026-05-06

## Context

The application requires local filesystem access, Git clone operations, and credential handling while presenting a modern desktop UI.

## Decision

Use Electron with strict process separation:

- Main process for privileged operations.
- Renderer process for UI only.
- Preload script as the controlled communication bridge.

## Consequences

### Positive

- Reduces attack surface by preventing direct Node access in renderer.
- Keeps infrastructure concerns in one place.
- Easier testing and maintainability through clear boundaries.

### Negative

- Requires explicit IPC contracts for every feature.
- Slightly more boilerplate when expanding functionality.
