# Pull Request Description

## Title
`feat(frontend): improve accessibility, enable optimistic user permissions, and enhance network status dashboard controls`

## Overview
This PR introduces frontend accessibility enhancements, state refactoring, and polished visual micro-interactions across the Pluto dashboard framework. It successfully addresses four frontend tasks (#821, #822, #823, and #824) while ensuring total system compile stability.

---

## Detailed Changes

### 1. Network Status Indicator (`ApiHealthBadge.tsx`)
* **Interactive Controls**: Refactored the container from a passive `div` to a semantic `<button>` to enable keyboard focus and manual rechecking.
* **Optimistic Update**: Transitioning immediately to a `"loading"` state upon mouse click or Enter keypress for a responsive feedback loop, before initiating the real backend health endpoint check.
* **Advanced Accessibility (Screen Readers & Keyboard)**:
  - Added descriptive `aria-live="polite"` tags to report status updates to screen readers dynamically.
  - Linked detailed status/degradation alerts using `aria-describedby` referencing the hover/focus tooltip.
  - Formulated precise dynamic `aria-label` definitions announcing the connection quality.
  - Enabled tooltips on tab focus using standard Tailwind `group-focus-visible` styles.

### 2. Premium User Permissions Manager (`UserPermissionsManager.tsx` & `settings/page.tsx`)
* **Premium Settings Panel**: Integrated a new high-fidelity **Permissions & Team** tab under merchant settings complete with clean user group icons and layout selectors.
* **Optimistic State Actions & Rollbacks**:
  - Implemented persistent browser storage (`localStorage`) synced with memory.
  - Invites, role transitions, and member revoking are computed **optimistically**. Rows update instantly in the UI with state snapshots saved beforehand.
  - In the event of a simulated API failure, the component runs automatic rollback procedures to revert the UI state cleanly and prompts the user via toast notifications.
* **Dynamic Animations**: 
  - Integrated Framer Motion's `<AnimatePresence>` to animate layout shifts, spring updates, and fade transitions during addition, removal, or filtering of rows.

### 3. Dashboard Webpack Compile Fix (`dashboard/page.tsx`)
* Corrected a pre-existing webpack path resolution error where `dashboard/page.tsx` attempted to load `WithdrawModal` instead of `WithdrawalModal`. The build compiles cleanly with no fatal errors or runtime blockages.

### 4. Code Cleanup & Lints (`WalletSelector.tsx`)
* Removed an unused `useMemo` React import that triggered pre-existing linter warnings.

---

## Verification & Build Log
* **ESLint Check**: Passed with `✔ No ESLint warnings or errors`.
* **Next.js Production Compilation**: Verified via `pnpm run build` compiling `20/20` pages successfully with zero failures.

---

## Linked Issues

Closes #821  
Closes #822  
Closes #823  
Closes #824  
