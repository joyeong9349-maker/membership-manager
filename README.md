# Membership Manager

Login-protected membership manager with encrypted server-side data storage.

Includes separate manager/customer entry screens, manager approval, customer self-signup, customer coupon view, and coupon redemption tracking.
Receipt camera OCR uses Tesseract.js in the browser, with editable text and amount fields for correction.
Coupon issuance is unified into one dialog with custom and birthday coupon modes.
Receipt OCR now preprocesses the image and recognizes three-digit totals such as 364.
Customers now create their own login account, and coupon redemption or point deduction requires manager approval.
Customer membership pages use a full scrolling layout with a polished customer-facing design.

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
DATABASE_URL=your-render-postgres-url
```

Use Postgres for deployed data persistence. File storage is only a local fallback and can be reset by redeploys on free web services.
When updating the app on Render, keep the same `DATABASE_URL` and `MEMBERSHIP_DATA_SECRET` values to preserve existing data.

Do not upload real member data to a public GitHub repository.
