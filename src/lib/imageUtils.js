/**
 * Utilidades de imagen para los recursos gráficos del badge.
 */

const cache = new Map();

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    img.src = src;
  });
}

/** Color de fondo de referencia: promedio de las 4 esquinas */
function cornerColor(d, w, h) {
  const idx = [0, w - 1, (h - 1) * w, h * w - 1].map((p) => p * 4);
  return [0, 1, 2].map((ch) => idx.reduce((sum, i) => sum + d[i + ch], 0) / idx.length);
}

/**
 * Quita el fondo sólido de una imagen ("color a alfa"), conservando colores y
 * bordes suavizados para que se integre limpia sobre la tarjeta oscura.
 *
 *  - Si la imagen YA tiene transparencia → se usa tal cual.
 *  - Si no, el color de las esquinas (blanco, negro o un gris como #0d0d0d)
 *    se toma como fondo y pasa a transparente.
 *
 * Modos:
 *  - "global": quita el color de fondo en toda la imagen (ideal para la red
 *    neuronal, cuyas líneas encierran zonas de fondo).
 *  - "edges":  solo quita el fondo conectado con los bordes (flood fill), así se
 *    conservan los interiores del mismo color que el fondo.
 *
 * `trim: true` recorta el resultado al área con contenido visible.
 *
 * Devuelve `{ url, coverage }`: un data URL (mismo origen → sin CORS al exportar)
 * y la fracción de píxeles visibles (≈0 significa imagen vacía).
 * El resultado se cachea por `src` y opciones.
 */
export function removeBackground(src, { mode = "global", trim = false } = {}) {
  const key = `${mode}:${trim}:${src}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const img = await loadImage(src);
        const { naturalWidth: w, naturalHeight: h } = img;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;
        const total = w * h;

        let transparent = false;
        let visible = 0;
        for (let i = 3; i < d.length; i += 4) {
          if (d[i] < 255) transparent = true;
          if (d[i] > 8) visible++;
        }
        if (transparent) return { url: src, coverage: visible / total };

        const bg = cornerColor(d, w, h);
        // opacidad mínima (0–1) que explica el píxel como "color sobre el fondo"
        const alphaAt = (i) => {
          let a = 0;
          for (let ch = 0; ch < 3; ch++) {
            const c = d[i + ch];
            const b = bg[ch];
            // en fondos muy oscuros, lo aún más oscuro (p. ej. negro puro vs #0d0d0d) también es fondo
            const ac = c > b ? (c - b) / (255 - b || 1) : c < b && b >= 40 ? (b - c) / b : 0;
            if (ac > a) a = ac;
          }
          return a;
        };
        const distance = (i) => alphaAt(i) * 255; // 0 = fondo puro

        const isBackground = mode === "edges" ? floodFromEdges(w, h, distance) : null;

        visible = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (isBackground && !isBackground[i / 4]) {
            visible++; // contenido interior: se conserva opaco
            continue;
          }
          const a = alphaAt(i);
          if (a < 1 / 255) {
            d[i + 3] = 0;
            continue;
          }
          // color original = a·color + (1−a)·fondo  →  color = fondo + (original − fondo) / a
          for (let ch = 0; ch < 3; ch++) {
            const v = bg[ch] + (d[i + ch] - bg[ch]) / a;
            d[i + ch] = Math.max(0, Math.min(255, Math.round(v)));
          }
          d[i + 3] = Math.round(a * 255);
          if (a * 255 > 8) visible++;
        }
        ctx.putImageData(imageData, 0, 0);
        const url = trim ? trimToContent(canvas, d) : canvas.toDataURL("image/png");
        return { url, coverage: visible / total };
      })()
    );
  }
  return cache.get(key);
}

/** Recorta el canvas al rectángulo que contiene píxeles visibles */
function trimToContent(canvas, d) {
  const { width: w, height: h } = canvas;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas.toDataURL("image/png"); // vacía: sin recorte
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext("2d").drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/** Marca como fondo los píxeles casi-fondo alcanzables desde el borde de la imagen */
function floodFromEdges(w, h, distance, threshold = 128) {
  const mask = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const p = y * w + x;
    if (!mask[p] && distance(p * 4) < threshold) {
      mask[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return mask;
}

/**
 * Recorta las filas/columnas de los bordes que son casi blancas (p. ej. una línea
 * de 1 px que queda al exportar una imagen), para que la imagen encaje limpia
 * sobre la tarjeta oscura. Devuelve un data URL; el resultado se cachea.
 */
export function cropLightEdges(src, { threshold = 225 } = {}) {
  const key = `crop:${threshold}:${src}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const img = await loadImage(src);
        const { naturalWidth: w, naturalHeight: h } = img;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, w, h).data;

        // una línea es "clara" si la mayoría de sus píxeles tiene todos los canales altos
        const isLight = (x0, y0, dx, dy, n) => {
          let light = 0;
          for (let k = 0; k < n; k++) {
            const i = ((y0 + dy * k) * w + (x0 + dx * k)) * 4;
            if (Math.min(d[i], d[i + 1], d[i + 2]) >= threshold) light++;
          }
          return light / n > 0.5;
        };

        let top = 0, bottom = h - 1, left = 0, right = w - 1;
        while (top < bottom && isLight(left, top, 1, 0, right - left + 1)) top++;
        while (bottom > top && isLight(left, bottom, 1, 0, right - left + 1)) bottom--;
        while (left < right && isLight(left, top, 0, 1, bottom - top + 1)) left++;
        while (right > left && isLight(right, top, 0, 1, bottom - top + 1)) right--;

        const out = document.createElement("canvas");
        out.width = right - left + 1;
        out.height = bottom - top + 1;
        out.getContext("2d").drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
        return { url: out.toDataURL("image/png"), cropped: { top, left, right: w - 1 - right, bottom: h - 1 - bottom } };
      })()
    );
  }
  return cache.get(key);
}
