# Membership Manager

Login-protected membership manager with encrypted server-side data storage.

Includes separate manager/customer entry screens, manager approval, customer self-signup, customer coupon view, and coupon redemption tracking.
Receipt camera OCR uses Tesseract.js in the browser, with editable text and amount fields for correction.
Coupon issuance is unified into one dialog with custom and birthday coupon modes.

## Run

```bash
npm start
```

## Render Settings

- Service type: Web Service
- Build command: leave empty
- Start command: `npm start`

## Environment Variables

```text
MEMBERSHIP_ADMIN_USER=your-admin-username
MEMBERSHIP_ADMIN_PASSWORD=your-login-password
MEMBERSHIP_DATA_SECRET=your-long-encryption-secret
MEMBERSHIP_DATA_DIR=/var/data
```

Do not upload real member data to a public GitHub repository.
