# Membership Manager

Login-protected membership manager with encrypted server-side data storage.

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
