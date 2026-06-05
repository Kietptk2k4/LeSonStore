# Bước 11 — Auth Service (E2)

**Dự án:** LeSonStore  
**Ngày:** 05/06/2026  
**Trạng thái:** Hoàn thành — toàn bộ `__tests__/auth/*`

---

## Mục đích

Tách **Identity & Access** khỏi `authController` sang **Service Layer** (`authService.js`). Controller chỉ còn HTTP adapter: `validationResult` + gọi service + JSON/redirect.

## Pattern

| Pattern | Vị trí |
|---------|--------|
| Service Layer | `server/services/auth/authService.js` |
| Layered / MVC | Validators trên `authRoutes`; controller mỏng |
| DTO mapper | `mapUserForAuthResponse`, duplicate `errors[]` |
| Purpose JWT | `email_verify`, `password_reset` |
| Strategy (OAuth) | `passport.js` + `authSocialRoutes.js` — **ngoài E2** |

## Handlers

| Controller | Service |
|------------|---------|
| `register` | `register` |
| `registerEmailVerification` | `registerWithEmailVerification` |
| `verifyEmail` | `verifyEmailAndIssueSession` → `{ redirectUrl }` |
| `forgotPassword` | `forgotPassword` |
| `resetPasswordRedirect` | `validateResetTokenForRedirect` |
| `resetPassword` | `resetPassword` |
| `login` | `login` |
| `getCurrentUser` | `getCurrentUser` |
| `updateProfile` | `updateProfile` |

DRY: `createUserAccount` + `checkDuplicateUser` + `provisionNewUser`.

Auth email: nodemailer inline trong service (không gộp `emailService.js` order).

## Kiểm tra

```bash
cd server
npm test -- __tests__/auth/
```

## Không đổi (E2)

- `authRoutes.js`, `authSocialRoutes.js`, `passport.js`, `middleware/auth.js`
