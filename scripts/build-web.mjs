// Kopiert die Web-App nach www/ – daraus baut Capacitor die Android-App.
// Die Web-App selbst (GitHub Pages) läuft weiter direkt aus dem Hauptordner.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const files = ['index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'sw.js', 'icons'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of files) cpSync(f, `www/${f}`, { recursive: true });

// Capacitor-Kern (u. a. registerPlugin) nur in der App laden – vor app.js
cpSync('node_modules/@capacitor/core/dist/capacitor.js', 'www/capacitor.js');
const html = readFileSync('www/index.html', 'utf8');
if (!html.includes('<script src="app.js"></script>')) throw new Error('app.js-Einbindung nicht gefunden');
writeFileSync('www/index.html', html.replace('<script src="app.js"></script>', '<script src="capacitor.js"></script>\n  <script src="app.js"></script>'));
console.log('www/ aktualisiert');
