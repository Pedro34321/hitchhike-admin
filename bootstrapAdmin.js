import { randomBytes, scryptSync } from 'node:crypto';

// Usado somente no primeiro início; nunca redefine contas ou senhas existentes.
export function bootstrapAdmin(db, env = process.env) {
  if (db.prepare('SELECT COUNT(*) AS total FROM admins').get().total > 0) return false;
  const email = (env.ADMIN_INITIAL_EMAIL || '').trim().toLowerCase();
  const password = env.ADMIN_INITIAL_PASSWORD || '';
  if (!email && !password) return false; // setup local continua disponível.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 16 || password.length > 256) {
    throw new Error('Defina ADMIN_INITIAL_EMAIL e ADMIN_INITIAL_PASSWORD (16 a 256 caracteres) nos segredos da hospedagem.');
  }
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  db.prepare('INSERT INTO admins(email,salt,hash) VALUES(?,?,?)').run(email, salt, hash);
  return true;
}
