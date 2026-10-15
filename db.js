import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const path = process.env.DB_PATH || resolve('data/admin.sqlite');
mkdirSync(dirname(path), { recursive: true });
export const db = new DatabaseSync(path);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS people(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK(role IN ('motorista','usuario')), status TEXT NOT NULL, vehicle TEXT DEFAULT '', plate TEXT DEFAULT '', course TEXT DEFAULT '', reason TEXT DEFAULT '', created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trips(id INTEGER PRIMARY KEY, driver_id INTEGER NOT NULL REFERENCES people(id), origin TEXT NOT NULL, destination TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, passengers INTEGER NOT NULL, amount REAL NOT NULL);
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, target_id INTEGER NOT NULL REFERENCES people(id), trip_id INTEGER REFERENCES trips(id), reporter TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'aberta', resolution TEXT DEFAULT '', created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
export function audit(actor, action, target, reason) { db.prepare('INSERT INTO audit(actor,action,target,reason,created) VALUES(?,?,?,?,?)').run(actor,action,String(target),reason,new Date().toISOString()); }
