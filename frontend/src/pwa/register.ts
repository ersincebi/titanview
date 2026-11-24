/** Servis işçisi kaydı. Yalnız üretimde ve güvenli bağlamda (https veya localhost). */
export function canRegister(env: {
  prod: boolean;
  hasSW: boolean;
  secure: boolean;
}): boolean {
  return env.prod && env.hasSW && env.secure;
}

export function registerServiceWorker(): void {
  const ok = canRegister({
    prod: import.meta.env.PROD,
    hasSW: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    secure: typeof window !== 'undefined' && window.isSecureContext,
  });
  if (!ok) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // kayıt başarısızsa uygulama yine çalışır (yalnız çevrimdışı kabuk yok)
    });
  });
}
