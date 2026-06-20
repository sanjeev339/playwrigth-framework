# Extracted Document Context
Document Type: FSD
Source: User Management Specification.pdf
Section: 4.2 User Management & Access Control
BRD ID: BR-UM-01
FSD ID: FS-UM-02

## Global Definitions
The User Management module allows platform administrators and organization owners to provision, edit, deactivate, and manage roles for platform users.

### Acronyms
- **UM**: User Management
- **RBAC**: Role-Based Access Control

---

## 4.2. User Management Module

### 4.2.1. User Creation Workflow
#### Objective
Provide an interface to add internal users and assign them specific roles within the tenant organization.

#### Workflow Steps
1. **Navigate to User Management**: Admin clicks on the "User Management" navigation button. The system displays the Internal Users list (navigating to `/users/internal-user`) with columns for Name, Email, Role, Status, and Created At.
2. **Click Add User**: Admin clicks the "Add User" button. The system opens a modal dialog showing options: "Add Internal User" or "Invite Users".
3. **Click Add Internal User**: Admin clicks "Add Internal User". The system renders the user details form.
4. **Enter Details**: Admin enters the required details:
   - **First Name**: Required text field.
   - **Last Name**: Required text field.
   - **Email Address**: Required email text field.
   - **Role**: Custom dropdown selection (requiring click triggers to open popup options) displaying pre-seeded tenant roles (e.g. `QA TEST MAGT`, `Adthiya Role`).
5. **Save User**: Admin clicks "Save". The system triggers validations.

#### Validation & Business Rules
- **Email Uniqueness**: The Email Address must be unique across the tenant. If the email address is already in use by another active or inactive user, the system must prevent the save action.
- **Duplicate Email Validation Error**: When a duplicate email is detected, the system displays an inline error message directly below the Email input field: **"This email address is already in use. Please enter a unique email."**
- **Successful Creation Outcome**:
  - The new user is created with a default status of **"Active"**.
  - A success toast notification is displayed.
  - The new user appears in the Internal Users list.
  - The "Created At" timestamp is populated with the current date/time.