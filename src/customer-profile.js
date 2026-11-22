const profileComplete = user => Boolean(user.fullName?.trim() && user.nationalId && user.passwordHash);
const customerFlags = user => user.role === 'CUSTOMER' ? { profileComplete: profileComplete(user), hasPassword: Boolean(user.passwordHash) } : {};
function requiresCompleteProfile(req) {
  if (req.user.role !== 'CUSTOMER' || req.user.profileComplete !== false) return false;
  const allowed = ['/api/v1/auth/logout', '/api/v1/me/complete-profile', '/api/v1/me/location', '/api/v1/me/account-deletion/otp'];
  if (req.path === '/api/v1/me' && req.method === 'DELETE') return false;
  if (allowed.includes(req.path)) return false;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  return /^\/api\/v1\/(hall\/(mine|conversations)|garage|support\/tickets|documents\/|requests\/)/.test(req.path);
}
module.exports = { profileComplete, customerFlags, requiresCompleteProfile };
