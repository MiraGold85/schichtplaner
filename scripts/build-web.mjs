// Kopiert die Web-App nach www/ – daraus baut Capacitor die Android-App.
// Die Web-App selbst (GitHub Pages) läuft weiter direkt aus dem Hauptordner.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const files = ['index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'sw.js', 'icons'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of files) cpSync(f, `www/${f}`, { recursive: true });
console.log('www/ aktualisiert');
