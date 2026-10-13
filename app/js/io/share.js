// Hand a generated file to the user: Web Share sheet (iPad: AirDrop, Mail,
// Files, WhatsApp…) when available, otherwise a normal download.
// Both stay on-device; nothing is uploaded by the app.

export function makeFile(blob, name) {
  try {
    return new File([blob], name, { type: blob.type, lastModified: Date.now() });
  } catch {
    blob.name = name;
    return blob;
  }
}

export function canShareFile(file) {
  try {
    return Boolean(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

/** Must be called directly from a tap handler (Safari requires a user gesture). */
export async function shareFile(file, title) {
  await navigator.share({ files: [file], title });
}

export function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
