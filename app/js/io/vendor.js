// Lazy loader for the vendored libraries (served from ./vendor, same origin,
// pre-cached by the service worker). Loaded on first use so the app starts
// fast; nothing is ever fetched from a CDN.

const loaded = new Map();

function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = () => resolve();
        s.onerror = () => {
          loaded.delete(src);
          reject(new Error(`Could not load ${src}. Open the app once while online so it can be cached.`));
        };
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src);
}

/** SheetJS (xlsx-js-style build, supports cell styles on write). */
export async function getXLSX() {
  await loadScript('vendor/xlsx.bundle.js');
  return window.XLSX;
}

/** jsPDF constructor with the AutoTable plugin applied. */
export async function getJsPDF() {
  await loadScript('vendor/jspdf.umd.min.js');
  await loadScript('vendor/jspdf.plugin.autotable.min.js');
  return window.jspdf.jsPDF;
}
