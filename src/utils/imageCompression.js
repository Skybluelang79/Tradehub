/**
 * Compress an image file using the Canvas API.
 * Returns a new File (or Blob) with reduced dimensions and quality.
 */
export function compressImage(file, { maxWidth = 1200, maxHeight = 1200, quality = 0.82, type = 'image/jpeg' } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
          const ext = type === 'image/png' ? '.png' : '.jpg';
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, ext), { type, lastModified: Date.now() });
          resolve(compressed);
        },
        type,
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for compression'));
    };

    img.src = url;
  });
}

/**
 * Compress a file and return a data URL (for preview / base64 storage).
 */
export async function compressToDataUrl(file, opts) {
  const compressed = await compressImage(file, opts);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read compressed image'));
    reader.readAsDataURL(compressed);
  });
}