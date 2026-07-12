import { randomInt } from 'node:crypto';

const OTP_LENGTH = 6;
const OTP_MAX_EXCLUSIVE = 10 ** OTP_LENGTH;

export function generateOtp(): string {
  return randomInt(0, OTP_MAX_EXCLUSIVE).toString().padStart(OTP_LENGTH, '0');
}
