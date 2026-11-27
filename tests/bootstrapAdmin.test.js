import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync } from 'node:crypto';
import { bootstrapAdmin } from '../bootstrapAdmin.js';

test('Primeira conta usa hash e não é recriada ou redefinida em atualizações', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE admins(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL)');
    assert.equal(bootstrapAdmin(db, {}), false);
    assert.throws(() => bootstrapAdmin(db, {ADMIN_INITIAL_EMAIL:'teste@example.invalid',ADMIN_INITIAL_PASSWORD:'curta'}));
    const env = {ADMIN_INITIAL_EMAIL:'TESTE@example.invalid',ADMIN_INITIAL_PASSWORD:'senha-ficticia-apenas-teste-2026'};
    assert.equal(bootstrapAdmin(db, env), true);
    const first = db.prepare('SELECT * FROM admins').get();
    assert.equal(first.email,'teste@example.invalid');
    assert.equal(first.hash,scryptSync(env.ADMIN_INITIAL_PASSWORD,first.salt,64).toString('hex'));
    assert.notEqual(first.hash,env.ADMIN_INITIAL_PASSWORD);
    assert.equal(bootstrapAdmin(db,{ADMIN_INITIAL_EMAIL:'outro@example.invalid',ADMIN_INITIAL_PASSWORD:'outra-senha-ficticia-de-teste'}),false);
    assert.deepEqual(db.prepare('SELECT * FROM admins').get(),first);
  } finally { db.close(); }
});
