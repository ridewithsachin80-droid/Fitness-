/**
 * scripts/sim/calibration-storage.cjs — SIMULATION ONLY (Fixes-2x). Loaded with `node -r` AFTER
 * voice-evidence-providers.cjs by scripts/sim/screens-2x.mjs, so a volunteer's take can be saved in
 * the browser run: recordings are kept in memory. The app never loads this file.
 */
const path = require('path');
const storage = require(path.join(__dirname, '../../services/storage'));
const objects = new Map();
storage.isConfigured = () => true;
storage.putObject = async (k, buf) => { objects.set(String(k), Buffer.from(buf)); };
storage.deleteObject = async (k) => { objects.delete(String(k)); };
const fallbackGet = storage.getObject;
storage.getObject = async (k) => objects.get(String(k)) || fallbackGet(k);
