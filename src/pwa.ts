/**
 * Meldet den Service Worker an, der das Spiel offline spielbar macht.
 * Nur im fertigen Build, damit er beim Entwickeln keine veralteten Dateien ausliefert.
 *
 * Übernimmt eine neue Version, lädt die Seite neu, sofern `mayReload` es erlaubt.
 * Sonst läuft die alte Version weiter, und die neue startet beim nächsten Öffnen.
 */
export function registerServiceWorker(mayReload: () => boolean): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const isUpdate = navigator.serviceWorker.controller !== null;
  void navigator.serviceWorker.register('./sw.js');
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isUpdate && mayReload()) location.reload();
  });
}
