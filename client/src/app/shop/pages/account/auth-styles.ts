/** Shared styles for the login / register forms. */
export const AUTH_STYLES = `
  .auth { min-height: 70vh; display: grid; place-items: center; padding: 56px 16px 80px; }
  .box { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 18px; }
  .head { text-align: center; display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
  .head p { margin: 0; color: var(--muted); }
  .switch { text-align: center; font-size: 14px; color: var(--muted); }
  .switch a { color: var(--ink); }
  .error { color: var(--danger); font-size: 13px; text-align: center; }
`;
