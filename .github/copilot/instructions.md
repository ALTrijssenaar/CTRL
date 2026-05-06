# Copilot Instructions for CTRL

When contributing to this repository:

1. Preserve process boundaries: renderer is UI-only, main process handles credentials, filesystem, and Git.
2. Keep provider-specific API translation in `src/main/providers`.
3. Reuse shared models from `src/main/types/repository.ts`.
4. Update architecture docs and ADRs in `docs/` when decisions change.
5. Apply available SKILLS:
   - `.github/copilot/skills/repo-overview/SKILL.md`
   - `.github/copilot/skills/repo-sync/SKILL.md`
