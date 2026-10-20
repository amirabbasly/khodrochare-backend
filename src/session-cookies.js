const NAMES = { CUSTOMER: 'khodrochare_customer_session', DRIVER: 'khodrochare_driver_session' };
function cookieToken(header, role) {
  const name = NAMES[role];
  if (!name || !header) return undefined;
  const pair = header.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return pair?.slice(name.length + 1);
}
function setSessionCookie(res, session, config, persistent = true) {
  res.cookie(NAMES[session.user.role], session.token, {
    httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', path: '/',
    ...(persistent ? { expires: session.expiresAt } : {}),
  });
}
function clearSessionCookie(res, role, config) {
  if (NAMES[role]) res.clearCookie(NAMES[role], { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
}
module.exports = { cookieToken, setSessionCookie, clearSessionCookie };
