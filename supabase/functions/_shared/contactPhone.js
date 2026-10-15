// Shared by the form and the write API. Checks the number's shape, not ownership.
export function isValidContactPhone(value) {
  if (typeof value !== 'string' || !/^[\d\s()-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  return /^(?:02\d{7,8}|0[3-6]\d{8,9}|01[016789]\d{7,8}|070\d{8}|080\d{7,8}|050\d{8,9}|1[5-9]\d{6})$/.test(digits);
}
