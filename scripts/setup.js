import { createInterface } from 'node:readline/promises';
import { randomBytes, scryptSync } from 'node:crypto';
import { db } from '../db.js';
const rl=createInterface({input:process.stdin,output:process.stdout});
try {
 const email=(await rl.question('E-mail do administrador: ')).trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('E-mail inválido');
 const password=randomBytes(18).toString('base64url');
 const salt=randomBytes(16).toString('hex');
 db.prepare('INSERT INTO admins(email,salt,hash) VALUES(?,?,?)').run(email,salt,scryptSync(password,salt,64).toString('hex'));
 console.log('Administrador criado. Guarde a senha inicial em local seguro: '+password);
 console.log('Você pode trocar a senha em Configurações após entrar.');
} finally {rl.close(); db.close();}
