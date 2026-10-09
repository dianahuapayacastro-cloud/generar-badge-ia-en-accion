/**
 * Exportación del badge a PNG.
 *
 * Estrategia:
 *  1. Espera a que fuentes e imágenes del nodo estén listas.
 *  2. Renderiza con html-to-image (mejor fidelidad: filtros, sombras, gradientes).
 *  3. Si falla o tarda demasiado, reintenta con html2canvas (más tolerante, p. ej. en Safari).
 *  4. Descarga vía Blob + object URL (más liviano y fiable que un data URL gigante).
 *
 * CORS: las fuentes son locales (@fontsource) y la foto subida se guarda como data URL,
 * así que no hay recursos de otros dominios. Si una imagen externa no permite CORS,
 * se sustituye por un placeholder en lugar de romper la exportación.
 */

import { getFontEmbedCSS, toBlob } from "html-to-image";

const BACKGROUND = "#0a0a0a";
const RENDER_TIMEOUT_MS = 12_000; // un render normal tarda < 1 s
// PNG transparente de 1×1 para imágenes que no se pueden incrustar
const IMAGE_PLACEHOLDER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const isWebKit =
  typeof navigator !== "undefined" &&
  /AppleWebKit/.test(navigator.userAgent) &&
  !/Chrome|Chromium|Edg/.test(navigator.userAgent);

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: tiempo de espera agotado (${ms / 1000}s)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Espera fuentes web y que todas las <img> del nodo hayan cargado (o fallado) */
async function waitForAssets(node) {
  if (document.fonts?.ready) await document.fonts.ready;
  const images = [...node.querySelectorAll("img")];
  await Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          })
    )
  );
}

// El CSS de fuentes incrustadas se calcula una sola vez y se reutiliza
let fontEmbedCSSCache = null;

async function renderWithHtmlToImage(node, pixelRatio) {
  if (fontEmbedCSSCache === null) {
    fontEmbedCSSCache = await getFontEmbedCSS(node).catch((err) => {
      console.warn("[exportBadge] No se pudieron incrustar las fuentes; se usarán las del sistema", err);
      return "";
    });
  }
  const options = {
    pixelRatio,
    backgroundColor: BACKGROUND,
    imagePlaceholder: IMAGE_PLACEHOLDER,
    fontEmbedCSS: fontEmbedCSSCache,
  };
  // WebKit a veces omite imágenes/fuentes en la primera pasada: se hace una de calentamiento
  if (isWebKit) await toBlob(node, options).catch(() => {});
  const blob = await toBlob(node, options);
  if (!blob) throw new Error("html-to-image devolvió una imagen vacía");
  return blob;
}

async function renderWithHtml2Canvas(node, pixelRatio) {
  // html2canvas (~200 KB) solo se descarga si hace falta el respaldo
  let html2canvas;
  try {
    ({ default: html2canvas } = await import("html2canvas"));
  } catch {
    throw new Error("no se pudo cargar el exportador de respaldo; recarga la página e inténtalo de nuevo");
  }
  const canvas = await html2canvas(node, {
    scale: pixelRatio,
    backgroundColor: BACKGROUND,
    useCORS: true, // pide imágenes externas con CORS
    allowTaint: false, // un canvas "contaminado" no se puede exportar
    imageTimeout: 15_000,
    logging: false,
    onclone: (_doc, clone) => {
      // html2canvas mide el texto distinto: evita recortes y solapamientos
      clone.querySelectorAll(".truncate").forEach((el) => {
        el.style.overflow = "visible";
        el.style.textOverflow = "clip";
      });
      clone.querySelectorAll(".leading-none").forEach((el) => {
        el.style.lineHeight = "1.15";
      });
    },
  });
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob devolvió vacío"))), "image/png")
  );
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Se revoca después para no cortar la descarga en navegadores lentos
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Renderiza `node` como PNG (Blob) sin descargarlo: html-to-image y, si falla, html2canvas.
 * @returns {{ blob: Blob, engine: string }}
 */
export async function renderBadgeBlob(node, { pixelRatio = 3 } = {}) {
  if (!node) throw new Error("No se encontró la tarjeta a exportar");
  await waitForAssets(node);
  try {
    const blob = await withTimeout(renderWithHtmlToImage(node, pixelRatio), RENDER_TIMEOUT_MS, "html-to-image");
    return { blob, engine: "html-to-image" };
  } catch (primaryError) {
    console.warn("[exportBadge] html-to-image falló; reintentando con html2canvas", primaryError);
    const blob = await withTimeout(renderWithHtml2Canvas(node, pixelRatio), RENDER_TIMEOUT_MS, "html2canvas");
    return { blob, engine: "html2canvas" };
  }
}

/**
 * Exporta `node` como PNG y lo descarga.
 * @returns {{ width: number, height: number, sizeKB: number, engine: string }}
 */
export async function exportBadgePng(node, { fileName, pixelRatio = 3 }) {
  const { blob, engine } = await renderBadgeBlob(node, { pixelRatio });
  triggerDownload(blob, fileName);
  return {
    width: Math.round(node.offsetWidth * pixelRatio),
    height: Math.round(node.offsetHeight * pixelRatio),
    sizeKB: Math.round(blob.size / 1024),
    engine,
  };
}

/**
 * Convierte el archivo subido en un data URL JPEG listo para el badge:
 * recortado al centro en 4:5, en blanco y negro y con el lado mayor ≤ maxHeight.
 * Así la foto no depende de CSS (filter / object-fit) al exportar, y se evitan
 * URLs blob: y fotos de varios MB que hacen fallar la exportación.
 */
export async function imageFileToDataUrl(file, maxHeight = 900) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Formato de imagen no compatible"));
      el.src = objectUrl;
    });
    const ASPECT = 4 / 5;
    const { naturalWidth: w, naturalHeight: h } = img;
    // recorte centrado al formato 4:5 del marco de la foto
    const cropW = w / h > ASPECT ? h * ASPECT : w;
    const cropH = w / h > ASPECT ? h : w / ASPECT;
    const outH = Math.min(maxHeight, Math.round(cropH));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(outH * ASPECT);
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.filter = "grayscale(1)"; // navegadores sin ctx.filter usan el grayscale del CSS
    ctx.drawImage(img, (w - cropW) / 2, (h - cropH) / 2, cropW, cropH, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
