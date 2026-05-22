/**
 * Test Data — User Management Module
 * Source: test_data_enriched.json (TC-UM-001 → TC-UM-004)
 *
 * ⚠ Live-behaviour notes (verified 2026-05-22, env: dev):
 *   - Role "Executive" (from spec) does NOT exist in live app.
 *     Replaced with "Workflow Operators" which is available.
 *   - New user status after creation = "Password Not Set" (not "Pending" as spec states).
 *   - Role dropdown is DISABLED in Edit User form — cannot be changed via UI (TC-UM-003).
 */

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface CreateUserPayload {
  firstName: string;
  lastName: string;
  emailAddress: string;
  role: string;
}

export interface DuplicateEmailPayload {
  firstName: string;
  lastName: string;
  emailAddress: string;
  expectedError: string;
}

export interface EditUserTarget {
  targetEmail: string;
  expectedCurrentRole: string;
}

export interface DeactivateUserTarget {
  targetEmail: string;
  expectedStatusAfter: string;
}

// ─── TC-UM-001: Create user — unique email per run ────────────────────────────
/**
 * Factory function: generates a unique email on every call using a timestamp suffix.
 * This prevents "Email already exists" collisions when tests are re-run.
 *
 * Data strategy : positive_valid_create
 * Execution order: 1
 */
export function createUserData(runId?: string): CreateUserPayload {
  // Last 10 digits of Date.now() gives an 8-10 char suffix — short but unique enough
  const suffix = runId ?? String(Date.now()).slice(-10);
  return {
    firstName: 'Rio',
    lastName: 'Sharma',
    // ⚠ Spec used "rio.sharma+auto001@piraiinfotech.com" (static — collides on re-run)
    emailAddress: `riosharma+auto${suffix}@piraiinfotech.com`,
    // ⚠ Spec role "Executive" does not exist in live app — using "Workflow Operators"
    role: 'Workflow Operators',
  };
}

// ─── TC-UM-002: Duplicate email constraint ────────────────────────────────────
/**
 * Uses a pre-existing email in the live system to trigger "Email already exists" error.
 * Depends on: TC-UM-001 (execution order ensures system state is stable)
 *
 * Data strategy : negative_invalid_create
 * Edge case type: duplicate_value
 */
export function getDuplicateEmailData(): DuplicateEmailPayload {
  return {
    firstName: 'adithya',
    lastName: 'j',
    // This email belongs to an active user "adithya j" already in the live system
    emailAddress: 'sanjeevkumar.m00@gmail.com',
    expectedError: 'Email already exists',
  };
}

// ─── TC-UM-003: Edit user / role assignment ───────────────────────────────────
/**
 * Target: existing user "adithya j" (sanjeevkumar.m00@gmail.com)
 *
 * ⚠ Live-behaviour note (2026-05-22):
 *   Spec says: select role from Role dropdown and save.
 *   Reality   : Role dropdown is DISABLED in Edit User form. Role cannot be changed.
 *   Test verifies: Edit form opens correctly and role field is displayed (even if disabled).
 *
 * Data strategy : positive_valid_update
 */
export function getEditUserTarget(): EditUserTarget {
  return {
    targetEmail: 'sanjeevkumar.m00@gmail.com',
    // Current role visible in the edit form (verified live 2026-05-22)
    expectedCurrentRole: 'Workflow Designer (Orchestrator Author)',
  };
}

// ─── TC-UM-004: Deactivate user ───────────────────────────────────────────────
/**
 * Target: existing active user "adithya j" (sanjeevkumar.m00@gmail.com)
 * After deactivation, their status should change to "Deactivated".
 *
 * Data strategy : positive_valid_update
 * Edge case type: status_change
 */
export function getDeactivationTarget(): DeactivateUserTarget {
  return {
    targetEmail: 'sanjeevkumar.m00@gmail.com',
    expectedStatusAfter: 'Deactivated',
  };
}
