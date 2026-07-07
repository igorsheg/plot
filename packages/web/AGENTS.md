# AGENTS.md

## Scope

Applies to `packages/web/**`.

## Direction

This web app is being rebuilt from first principles. Keep only essentials until a real screen needs more.

## Structure

```text
src/main.tsx          React entrypoint only
src/app/              App wiring plus app-owned Nano Stores
src/components/       Flat domain block compositions
src/components/ui/    Owned UI primitives we actually render (Coss primitives + Plot primitives)
src/data/             Gateway contracts, DTO parsing, fetch helpers, tiny parse helpers
src/theme/            Theme Nano Store persistence and Coss mode wiring
src/lib/              Tiny shared utilities
src/style.css         Tailwind v4 raw tokens, Coss semantic tokens, and base selectors only
```

## Rules

- Locality of behavior: feature-specific state, helpers, and markup live together under the owning directory.
- Domain block compositions start flat in `src/components/`; earn `src/components/<domain>/` only when the Module owns state, view-model, markup, and tests together.
- State lives in Nano Stores (`nanostores` + `@nanostores/react`); components subscribe and render, they do not own app state with React context/effects.
- API reads/writes go through `@nanostores/query` fetcher/mutator stores. Keep raw fetch/parse helpers in `src/data/`, but do not call them from views.
- Move non-UI logic into stores and derived stores. Prefer `computed` chains over component `useMemo` glue.
- Do not add barrel files that only re-export; import symbols from the Module that owns them.
- Separate changes from reactions: actions set/mutate stores only; persistence, DOM sync, revalidation, and other side effects live in store listeners/query stores.
- Do not rebuild the old Console model by inertia: no Fleet, Brief, lanes, replay scrub, palette, or optimistic queue unless re-proven.
- Keep gateway parsing at `src/data/`; views do not parse raw JSON.
- Port external UI primitives only when rendered. No closed component system.
- Use `@phosphor-icons/react` for icons throughout Plot web; do not mix icon sets.
- Import Phosphor icons by their modern `*Icon` exports, e.g. `XIcon`, not deprecated aliases like `X`.
- `src/style.css` is the Plot web design system: raw tokens, semantic aliases, Tailwind v4 theme entries, and base selectors only.
- Do not put component/block/domain selectors in `src/style.css`; colocate that styling with the owning component using idiomatic Tailwind utilities/composition.
- Visible text renders through `src/components/ui/text.tsx`; do not define typography styles in component CSS or inline styles.
- Keep `Text` small and semantic; avoid product-specific primitive variants.
- Use Tailwind/native spacing directly at the owning component; do not add JS spacing-token wrappers.
- Add the smallest behavior test that proves a kept contract.
