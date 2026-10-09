import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import qrcode from "qrcode-generator";
import { exportBadgePng, imageFileToDataUrl } from "../lib/exportBadge.js";
import { removeBackground } from "../lib/imageUtils.js";

// Fuentes alojadas localmente (solo subconjunto latino): sin CORS al exportar el PNG
import "@fontsource/space-mono/latin-400.css";
import "@fontsource/space-mono/latin-700.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";

/* ------------------------------------------------------------------ */
/*  Configuración                                                      */
/* ------------------------------------------------------------------ */

const STEPS = ["Datos", "Foto", "Pase", "Aporte"];
const STEP_TITLES = ["Identidad", "Captura", "Output", "Comparte tu pase"];

const SOCIALS = {
  linkedin: { label: "LinkedIn", base: "https://www.linkedin.com/in/", short: "in/" },
  x: { label: "X", base: "https://x.com/", short: "@" },
  instagram: { label: "Instagram", base: "https://instagram.com/", short: "@" },
};

/** Ejemplos que se muestran en el formulario y, atenuados, en la tarjeta mientras el campo está vacío */
const FIELD_PLACEHOLDERS = {
  name: "Didi",
  role: "Product Owner",
  company: "Apex Global Co.",
};

const DEFAULT_ATTENDEE = {
  name: "",
  role: "",
  company: "",
  email: "",
  photoUrl: "",
  ticketId: "BWC-LIM2-0142",
  socialNetwork: "linkedin",
  socialHandle: "",
  contribution: "",
};

/** Página del evento: destino del QR cuando no hay red social y enlace que se comparte */
const EVENT_URL = "https://luma.com/39mwym77";

/** Pase físico: se solicita enviando la credencial por correo hasta el plazo indicado */
const PHYSICAL_PASS_EMAIL = "didi@nxtep.org";
const PHYSICAL_PASS_DEADLINE = new Date("2026-10-12T10:00:00-05:00"); // lunes 12 oct, 10:00 a.m. (Lima)
const PHYSICAL_PASS_NOTICE =
  "Los pases físicos se pueden solicitar enviando tu credencial a didi@nxtep.org únicamente hasta el lunes 12 de octubre a las 10:00 a.m. Pasado este plazo, el beneficio ya no estará disponible.";

/** Estados del pase físico */
const PHYSICAL = { NONE: "none", PENDING: "pending" };

const EXPORT_PIXEL_RATIO = 3;

/** Recursos gráficos del badge (carpeta /public) */
const BADGE_ASSETS = {
  title: "/ia-en-accion.png",
  neural: "/fondo-neuronal.png",
  logoNxtep: "/logo-nxtep.png",
  logoPeruTechWeek: "/logo-peru-tech-week.png",
};


/* ------------------------------------------------------------------ */
/*  Utilidades (sin estado)                                            */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isValidEmail = (v) => EMAIL_RE.test(v.trim());

/** Normaliza "usuario", "@usuario" o una URL completa al enlace del perfil */
function buildSocialUrl(network, input) {
  const v = input.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(www\.)?(linkedin\.com|x\.com|twitter\.com|instagram\.com)\//i.test(v)) return `https://${v}`;
  return SOCIALS[network].base + v.replace(/^@/, "").replace(/\s+/g, "");
}

/** Texto corto para mostrar bajo el QR: "@maria" / "in/maria" */
function socialDisplay(network, url) {
  if (!url) return "";
  const slug = url.replace(/\/+$/, "").split("/").pop();
  return `${SOCIALS[network].short}${slug}`;
}

/**
 * Mensaje para redes. Sin aporte es exactamente:
 * "¡Ya tengo mi credencial! Este es un evento premium y voy a estar ahí. 🔥 #IAenAcción"
 */
function buildShareText(contribution) {
  const base = "¡Ya tengo mi credencial! Este es un evento premium y voy a estar ahí.";
  const extra = contribution.trim() ? ` Mi objetivo: ${contribution.trim()}.` : "";
  return `${base}${extra} 🔥 #IAenAcción`;
}

function buildLinkedInShareUrl(url) {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}

/** mailto: con asunto y cuerpo prellenados (los adjuntos no se pueden incluir desde un enlace) */
function buildPhysicalPassMailto(attendee) {
  const line = (label, value) => `${label}: ${value.trim() || "—"}`;
  const body = [
    "Hola,",
    "",
    "Quiero solicitar mi pase físico para IA en Acción. Adjunto mi credencial (PNG).",
    "",
    line("Nombre", attendee.name),
    line("Rol", attendee.role),
    line("Empresa", attendee.company),
    line("Correo", attendee.email),
    "",
    "¡Gracias!",
  ].join("\r\n");
  const subject = `Solicitud de pase físico · IA en Acción${attendee.name.trim() ? ` · ${attendee.name.trim()}` : ""}`;
  return `mailto:${PHYSICAL_PASS_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const INSTAGRAM_WEB = "https://www.instagram.com/";

/**
 * Abre Instagram de la forma más directa posible:
 *  - Android: enlace intent:// → abre la app y, si no está instalada, Chrome va solo a la web.
 *  - iPhone/iPad: esquema instagram:// → si la app no se abre en ~1,5 s, se redirige a la web.
 *  - Escritorio: instagram.com en una pestaña nueva.
 * Debe llamarse directamente dentro del clic del usuario (sin await previo).
 */
function openInstagram() {
  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  if (isAndroid) {
    window.location.href = `intent://instagram.com/#Intent;package=com.instagram.android;scheme=https;S.browser_fallback_url=${encodeURIComponent(INSTAGRAM_WEB)};end`;
    return "app";
  }
  if (isIOS) {
    const fallback = setTimeout(() => {
      if (!document.hidden) window.location.href = INSTAGRAM_WEB; // la app no se abrió
    }, 1500);
    // si la app se abre, la página pasa a segundo plano y se cancela el respaldo
    document.addEventListener("visibilitychange", () => document.hidden && clearTimeout(fallback), { once: true });
    window.location.href = "instagram://app";
    return "app";
  }
  window.open(INSTAGRAM_WEB, "_blank", "noopener,noreferrer");
  return "web";
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback para contextos sin Clipboard API (http, iframes sin permiso)
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "builder";

/* ------------------------------------------------------------------ */
/*  Estilos globales del módulo: fuentes técnicas + keyframes          */
/*  (scoped bajo .bwc para no afectar al resto de la app)              */
/* ------------------------------------------------------------------ */

const GLOBAL_CSS = `
.bwc, .bwc .font-mono, .bwc .font-display { font-family: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif; }
/* la credencial (PNG descargable) conserva su diseño técnico original */
.bwc .bwc-badge, .bwc .bwc-badge .font-mono { font-family: 'Space Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
.bwc .bwc-badge .font-display { font-family: 'Space Grotesk', 'Space Mono', ui-sans-serif, system-ui, sans-serif; }
.bwc ::selection { background: #ee5734; color: #000; }
@keyframes bwcFadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@keyframes bwcScan { from { transform: translateY(-100%) } to { transform: translateY(400%) } }
@keyframes bwcIndet { from { transform: translateX(-100%) } to { transform: translateX(250%) } }
`;

/* ------------------------------------------------------------------ */
/*  Primitivas visuales                                                */
/* ------------------------------------------------------------------ */

function TechLabel({ children, className = "" }) {
  return (
    <span
      className={`font-display text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400 ${className}`}
    >
      {children}
    </span>
  );
}

/** Chip de estado secundario: [● OK] */
function StatusChip({ tone = "idle", children, pulse = false, className = "" }) {
  const tones = {
    ok: "border-brand/50 text-brand bg-brand/10",
    live: "border-brand bg-brand text-white",
    idle: "border-white/25 text-white bg-white/[0.03]",
    done: "border-white/30 text-neutral-100 bg-white/[0.06]",
    error: "border-red-500/60 text-red-400 bg-red-500/10",
  };
  const dot = {
    ok: "bg-brand",
    live: "bg-white",
    idle: "bg-neutral-400",
    done: "bg-neutral-100",
    error: "bg-red-400",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-display text-[12px] font-medium leading-tight ${tones[tone]} ${className}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[tone]} ${pulse ? "animate-pulse" : ""}`} />
      {children}
    </span>
  );
}

/** Encabezado de sección: índice dentro de un círculo + etiqueta espaciada */
function TechDivider({ label, index }) {
  return (
    <div className="flex items-center gap-3">
      {index && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/40 font-display text-[11px] font-semibold tabular-nums text-white">
          {index}
        </span>
      )}
      {label && (
        <span className="font-display text-[13px] font-medium uppercase tracking-[0.22em] text-white/90">{label}</span>
      )}
    </div>
  );
}

/** Tarjeta redondeada con degradado suave (cálido: naranja→azul, frío: azul→naranja) */
function Card({ tone = "neutral", className = "", children }) {
  const tones = {
    warm: "bg-[linear-gradient(115deg,rgba(238,87,52,0.18)_0%,rgba(16,14,26,0.85)_48%,rgba(37,99,235,0.14)_100%)]",
    cool: "bg-[linear-gradient(115deg,rgba(37,99,235,0.14)_0%,rgba(16,14,26,0.85)_50%,rgba(238,87,52,0.12)_100%)]",
    neutral: "bg-white/[0.025]",
  };
  return <div className={`rounded-2xl border border-white/10 p-5 sm:p-6 ${tones[tone]} ${className}`}>{children}</div>;
}

function CornerBrackets({ color = "border-brand", size = "h-3 w-3", inset = "" }) {
  const base = `pointer-events-none absolute ${size} ${color}`;
  return (
    <>
      <span className={`${base} left-0 top-0 border-l-2 border-t-2 ${inset}`} />
      <span className={`${base} right-0 top-0 border-r-2 border-t-2 ${inset}`} />
      <span className={`${base} bottom-0 left-0 border-b-2 border-l-2 ${inset}`} />
      <span className={`${base} bottom-0 right-0 border-b-2 border-r-2 ${inset}`} />
    </>
  );
}

/** Botón en píldora: degradado (primary), borde claro (outline) o discreto (ghost) */
function Button({ variant = "primary", icon, hint, children, className = "", href, ...props }) {
  const styles = {
    primary:
      "border-transparent bg-[linear-gradient(90deg,#2563eb,#ee5734)] text-white shadow-[0_10px_30px_-14px_rgba(238,87,52,0.8)] hover:brightness-110",
    outline: "border-white/25 bg-white/[0.04] text-white hover:border-brand hover:text-brand",
    ghost: "border-white/12 bg-transparent text-neutral-200 hover:border-white/35 hover:text-white",
  };
  const Tag = href ? "a" : "button";
  return (
    <Tag
      {...(href ? { href } : { type: "button" })}
      className={`group relative inline-flex items-center justify-center gap-2 rounded-full border px-6 py-3 font-display text-[15px] font-semibold tracking-[-0.01em] transition-all duration-150 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-35 ${styles[variant]} ${className}`}
      {...props}
    >
      {icon}
      {children}
      {hint && (
        <span
          className={`hidden pl-1 text-[12px] font-medium sm:inline ${
            variant === "primary" ? "text-white/70" : "text-neutral-500"
          }`}
        >
          · {hint}
        </span>
      )}
    </Tag>
  );
}

/** Píldora con borde degradado azul → #ee5734 → azul (BUILDER, ACREDITACIÓN) */
function GradientPill({ children, className = "", innerClassName = "" }) {
  return (
    // el "borde" es el degradado de fondo que asoma 1.5 px alrededor del relleno oscuro
    <span
      className={`inline-block rounded-full p-[1.5px] shadow-[-4px_0_14px_-4px_rgba(37,99,235,0.8),4px_0_14px_-4px_rgba(238,87,52,0.8)] ${className}`}
      style={{ backgroundImage: "linear-gradient(90deg, #2563eb, #ee5734, #2564ec)" }}
    >
      <span
        className={`block rounded-full bg-[#0a0a0a] font-display font-bold uppercase leading-none text-white ${innerClassName}`}
      >
        {children}
      </span>
    </span>
  );
}

/** Contenedor de panel redondeado con barra superior */
function Panel({ code, title, chips, children, className = "" }) {
  return (
    <section
      className={`relative min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-[#0a0b10]/95 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9),-24px_0_60px_-34px_rgba(37,99,235,0.45),24px_0_60px_-34px_rgba(238,87,52,0.4)] ${className}`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.02] px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-display text-[11px] font-semibold tabular-nums text-brand">{code}</span>
          <span className="h-3 w-px bg-white/15" />
          <TechLabel className="text-neutral-300">{title}</TechLabel>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{chips}</div>
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Iconos (SVG inline, sin dependencias)                              */
/* ------------------------------------------------------------------ */

const svgProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 };

const Icon = {
  Download: (p) => (
    <svg {...svgProps} strokeWidth="2.25" className="h-4 w-4" {...p}>
      <path d="M12 3v12m0 0l-5-5m5 5l5-5M4 21h16" strokeLinecap="square" />
    </svg>
  ),
  Lock: (p) => (
    <svg {...svgProps} className="h-4 w-4" {...p}>
      <rect x="4" y="11" width="16" height="10" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  ),
  Check: (p) => (
    <svg {...svgProps} strokeWidth="3" className="h-3.5 w-3.5" {...p}>
      <path d="M5 12l5 5L20 7" strokeLinecap="square" />
    </svg>
  ),
  Eye: (p) => (
    <svg {...svgProps} className="h-4 w-4" {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Send: (p) => (
    <svg {...svgProps} className="h-4 w-4" {...p}>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" strokeLinejoin="miter" />
    </svg>
  ),
  Clock: (p) => (
    <svg {...svgProps} className="h-4 w-4" {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="square" />
    </svg>
  ),
  LinkedIn: (p) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" {...p}>
      <path d="M4.98 3.5a2.5 2.5 0 11-.01 5 2.5 2.5 0 01.01-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05C20.6 8.65 21 11.2 21 14.5V21h-4v-5.8c0-1.4-.03-3.2-1.95-3.2-1.95 0-2.25 1.52-2.25 3.1V21H9z" />
    </svg>
  ),
  X: (p) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" {...p}>
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3zm-1.08 16.2h1.7L7.4 4.73H5.58l11.1 14.47z" />
    </svg>
  ),
  Instagram: (p) => (
    <svg {...svgProps} className="h-4 w-4" {...p}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" />
    </svg>
  ),
  Link: (p) => (
    <svg {...svgProps} className="h-4 w-4" {...p}>
      <path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1" />
    </svg>
  ),
  User: (p) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <circle cx="12" cy="8" r="4.5" />
      <path d="M3 22c0-5 4-8.5 9-8.5s9 3.5 9 8.5z" />
    </svg>
  ),
  Upload: (p) => (
    <svg {...svgProps} className="h-5 w-5" {...p}>
      <path d="M12 16V4m0 0l-5 5m5-5l5 5M4 20h16" strokeLinecap="square" />
    </svg>
  ),
  Close: (p) => (
    <svg {...svgProps} strokeWidth="2.25" className="h-5 w-5" {...p}>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="square" />
    </svg>
  ),
};

const SOCIAL_ICONS = { linkedin: Icon.LinkedIn, x: Icon.X, instagram: Icon.Instagram };

/* ------------------------------------------------------------------ */
/*  Columna izquierda: navegación de pasos                             */
/* ------------------------------------------------------------------ */

/** Indicador de pasos en tarjetas: completado (✓ naranja), en proceso (borde degradado), pendiente */
function StepIndicator({ steps, current, onSelect }) {
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const status = done ? "Completado" : active ? "En proceso" : "Pendiente";

        const card = (
          <span
            className={`flex h-full flex-col items-start gap-3 rounded-[11px] px-4 py-4 text-left transition-colors ${
              active ? "bg-[#0b0c12]" : "bg-[#0b0c12] group-hover:bg-[#10121a]"
            }`}
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full font-display text-sm font-bold ${
                done
                  ? "bg-brand text-white"
                  : active
                  ? "border-2 border-brand text-brand"
                  : "border border-neutral-600 text-neutral-400"
              }`}
            >
              {done ? <Icon.Check className="h-4 w-4" /> : i + 1}
            </span>
            <span className="block">
              <span
                className={`block font-display text-lg font-bold leading-tight tracking-[-0.01em] ${
                  done || active ? "text-white" : "text-neutral-500"
                }`}
              >
                {step}
              </span>
              <span className={`mt-0.5 block font-display text-[13px] ${active ? "text-brand" : "text-neutral-400"}`}>
                {status}
              </span>
            </span>
          </span>
        );

        return (
          <li key={step}>
            <button
              type="button"
              onClick={() => onSelect?.(i)}
              aria-current={active ? "step" : undefined}
              aria-label={`Paso ${i + 1}: ${step} · ${status}`}
              className={`group block h-full w-full rounded-xl p-[1.5px] transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                active
                  ? "bg-[linear-gradient(135deg,#2563eb,#ee5734)] shadow-[0_0_24px_-10px_rgba(238,87,52,0.7)]"
                  : "bg-neutral-800 hover:bg-neutral-700"
              }`}
            >
              {card}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepNav({ current, total, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Button
        variant="ghost"
        onClick={() => onChange(current - 1)}
        disabled={current === 0}
        className="whitespace-nowrap px-5 py-2.5 text-sm"
      >
        ← Anterior
      </Button>
      <div className="hidden items-center gap-1 sm:flex" aria-hidden>
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === current ? "w-5 bg-brand" : i < current ? "w-1.5 bg-neutral-400" : "w-1.5 bg-neutral-700"
            }`}
          />
        ))}
        <span className="ml-2 font-display text-[12px] font-semibold tabular-nums text-neutral-400">
          {String(current + 1).padStart(2, "0")}
          <span className="text-neutral-600">/{String(total).padStart(2, "0")}</span>
        </span>
      </div>
      <Button
        variant="outline"
        onClick={() => onChange(current + 1)}
        disabled={current === total - 1}
        className="whitespace-nowrap px-5 py-2.5 text-sm"
      >
        Siguiente →
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Paso 1: Datos (formulario + red social para el QR)                 */
/* ------------------------------------------------------------------ */

function TextField({
  index,
  label,
  value,
  onChange,
  onBlur,
  maxLength = 24,
  placeholder,
  type = "text",
  required = false,
  error,
  uppercase = true,
  prefix = ">",
  hint,
}) {
  const id = `bwc-field-${label}`;
  const full = value.length >= maxLength;
  return (
    <div className="group">
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="flex items-center gap-2">
          <span
            className={`font-display text-[11px] font-semibold tabular-nums ${
              error ? "text-red-400" : "text-neutral-500 group-focus-within:text-brand"
            }`}
          >
            {index}
          </span>
          <TechLabel className={error ? "text-red-400" : "text-neutral-400 group-focus-within:text-brand"}>
            {label}
          </TechLabel>
          {required && (
            <span className="font-display text-[10px] font-semibold tracking-[0.12em] text-brand">* REQ</span>
          )}
        </label>
        <span
          className={`font-display text-[11px] font-medium tabular-nums ${full ? "text-brand" : "text-neutral-500"}`}
        >
          {String(value.length).padStart(2, "0")}/{maxLength}
        </span>
      </div>
      <div
        className={`relative flex items-center rounded-xl border bg-white/[0.03] transition-colors ${
          error
            ? "border-red-500/70 shadow-[0_0_0_1px_rgba(239,68,68,0.25)]"
            : "border-white/10 group-focus-within:border-brand group-focus-within:shadow-[0_0_0_3px_rgba(238,87,52,0.15)]"
        }`}
      >
        <span
          className={`select-none whitespace-nowrap pl-4 font-display text-[15px] font-semibold ${
            error ? "text-red-400" : "text-neutral-500 group-focus-within:text-brand"
          }`}
        >
          {prefix}
        </span>
        <input
          id={id}
          type={type}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          required={required}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          spellCheck={false}
          autoComplete={type === "email" ? "email" : "off"}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={`w-full min-w-0 bg-transparent px-2.5 py-3 font-display text-[15px] font-medium tracking-[0.02em] text-white caret-brand outline-none placeholder:normal-case placeholder:text-neutral-600 ${
            uppercase ? "uppercase" : ""
          }`}
        />
      </div>
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 font-display text-[12px] font-medium text-red-400">
          ✕ {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 truncate font-display text-[12px] text-neutral-500">{hint}</p>
      )}
    </div>
  );
}

/** Selector segmentado de red social */
function SocialSelector({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Red social" className="grid grid-cols-3 gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
      {Object.entries(SOCIALS).map(([key, s]) => {
        const SIcon = SOCIAL_ICONS[key];
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(key)}
            className={`flex items-center justify-center gap-2 rounded-full px-2 py-2.5 font-display text-[13px] font-semibold transition-colors ${
              active
                ? "bg-[linear-gradient(90deg,#2563eb,#ee5734)] text-white"
                : "text-neutral-400 hover:bg-white/[0.05] hover:text-neutral-100"
            }`}
          >
            <SIcon />
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function DataStep({ attendee, onChange, emailError, onEmailBlur }) {
  const set = (key) => (value) => onChange({ ...attendee, [key]: value });
  const socialUrl = buildSocialUrl(attendee.socialNetwork, attendee.socialHandle);
  return (
    <div className="space-y-5">
      <fieldset className="min-w-0 space-y-5">
        <TextField index="01" label="Nombre" value={attendee.name} onChange={set("name")} placeholder={FIELD_PLACEHOLDERS.name} maxLength={28} />
        <TextField index="02" label="Rol" value={attendee.role} onChange={set("role")} placeholder={FIELD_PLACEHOLDERS.role} />
        <TextField index="03" label="Empresa" value={attendee.company} onChange={set("company")} placeholder={FIELD_PLACEHOLDERS.company} />
        <TextField
          index="04"
          label="Correo electrónico"
          type="email"
          uppercase={false}
          prefix="@"
          maxLength={64}
          value={attendee.email}
          onChange={set("email")}
          onBlur={onEmailBlur}
          placeholder="tu@correo.com"
          error={emailError}
          hint="Opcional · se incluye en tu solicitud de pase físico · no se imprime"
        />

        <Card className="space-y-5">
        <TechDivider index="QR" label="Red social" />
        <SocialSelector value={attendee.socialNetwork} onChange={set("socialNetwork")} />
        <TextField
          index="05"
          label="Usuario o enlace"
          uppercase={false}
          prefix={SOCIALS[attendee.socialNetwork].short}
          maxLength={120}
          value={attendee.socialHandle}
          onChange={set("socialHandle")}
          placeholder={attendee.socialNetwork === "linkedin" ? "tu-usuario" : "tuusuario"}
          hint={socialUrl ? `QR → ${socialUrl}` : `Vacío: el QR apunta a ${EVENT_URL}`}
        />
        </Card>
      </fieldset>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Paso 2: Foto                                                       */
/* ------------------------------------------------------------------ */

function PhotoStep({ photoUrl, onChange, onError }) {
  const [processing, setProcessing] = useState(false);
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (!file) return;
    setProcessing(true);
    try {
      onChange(await imageFileToDataUrl(file));
    } catch (err) {
      onError?.(err.message);
    } finally {
      setProcessing(false);
    }
  };
  return (
    <fieldset className="min-w-0 space-y-3">
      <label className="group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/20 bg-[linear-gradient(115deg,rgba(37,99,235,0.08),rgba(16,14,26,0.6)_50%,rgba(238,87,52,0.08))] px-4 py-10 text-center transition-colors hover:border-brand">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 text-neutral-200 transition-colors group-hover:border-brand group-hover:text-brand">
          <Icon.Upload />
        </span>
        <span className="font-display text-[17px] font-semibold text-white">
          {processing ? "Procesando…" : photoUrl ? "Cambiar foto" : "Subir foto"}
        </span>
        <div className="flex flex-wrap justify-center gap-1.5">
          <StatusChip>JPG / PNG</StatusChip>
          <StatusChip>4:5</StatusChip>
          <StatusChip tone="ok">Auto B&W</StatusChip>
        </div>
        <input type="file" accept="image/*" onChange={handleFile} className="sr-only" />
      </label>
      {photoUrl && (
        <Button variant="ghost" onClick={() => onChange("")} className="w-full py-2.5 text-sm">
          Quitar foto
        </Button>
      )}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */
/*  Paso 3: Pase (descarga real + flujo del pase físico)               */
/* ------------------------------------------------------------------ */

function StatusBox({ exportMeta }) {
  const meta = [
    ["Res", exportMeta ? `${exportMeta.width}×${exportMeta.height}` : "—"],
    ["Escala", `${EXPORT_PIXEL_RATIO}×`],
    ["Peso", exportMeta ? `${exportMeta.sizeKB} KB` : "—"],
  ];
  return (
    <Card tone="warm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/40 text-white">
          <Icon.Check className="h-4 w-4" />
        </span>
        <span className="font-display text-[13px] font-medium uppercase tracking-[0.22em] text-white/90">Status</span>
        <StatusChip tone="live">200_OK</StatusChip>
      </div>
      <h3 className="mt-5 font-display text-[32px] font-bold leading-none tracking-[-0.04em] text-brand sm:text-[40px]">
        ¡Pase operativo!
      </h3>
      <p className="mt-3 font-display text-[15px] text-neutral-300">
        {exportMeta ? "Imagen de alta resolución compilada" : "Listo para compilar en alta resolución"}
      </p>
      <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-white/10 pt-5">
        {meta.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="font-display text-[13px] text-neutral-400">{k}</dt>
            <dd className="mt-1 truncate font-display text-lg font-bold tabular-nums tracking-[-0.02em] text-white sm:text-[22px]">
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** idle → loading → done | error */
function DownloadButton({ status, meta, onClick }) {
  if (status === "loading") {
    return (
      <div
        className="relative overflow-hidden rounded-full border border-white/15 bg-white/[0.04] px-6 py-3"
        aria-busy="true"
      >
        <div className="absolute inset-y-0 left-0 w-2/5 animate-[bwcIndet_1s_linear_infinite] bg-[linear-gradient(90deg,transparent,rgba(238,87,52,0.35),transparent)]" />
        <div className="relative flex items-center justify-center gap-2 font-display text-[15px] font-semibold text-white">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          Compilando PNG…
        </div>
      </div>
    );
  }
  if (status === "done") {
    return (
      <Button variant="primary" icon={<Icon.Check />} hint={meta ? `${meta.sizeKB} KB` : undefined} onClick={onClick}>
        Descargado · repetir
      </Button>
    );
  }
  return (
    <Button variant="primary" icon={<Icon.Download />} hint={`PNG · ${EXPORT_PIXEL_RATIO}×`} onClick={onClick}>
      {status === "error" ? "Reintentar descarga" : "Descargar PNG"}
    </Button>
  );
}

function DataRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/10 py-4 last:border-b-0">
      <span className="shrink-0 font-display text-[15px] text-neutral-400">{label}</span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}

const PHYSICAL_UI = {
  [PHYSICAL.NONE]: { tone: "idle", text: "Sin solicitar" },
  [PHYSICAL.PENDING]: { tone: "ok", text: "Solicitud enviada / Pendiente de aprobación", pulse: true },
};

/**
 * Modal centrado con fondo translúcido. Se cierra con la X, con Esc o clic en el fondo;
 * mantiene el foco dentro mientras está abierto y bloquea el scroll de la página.
 */
function Modal({ open, onClose, code, title, children }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === "Tab") {
        // trampa de foco: Tab / Shift+Tab circulan dentro del modal
        const focusables = dialogRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables?.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="bwc fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
      {/* fondo oscuro translúcido */}
      <div
        className="absolute inset-0 animate-[bwcFadeIn_150ms_ease-out] bg-black/80 backdrop-blur-sm"
        onClick={() => onCloseRef.current()}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-xl animate-[bwcFadeIn_200ms_ease-out] overflow-y-auto rounded-3xl border border-white/10 bg-[#0a0b10] shadow-[-30px_0_80px_-30px_rgba(37,99,235,0.6),30px_0_80px_-30px_rgba(238,87,52,0.55)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.02] py-3 pl-6 pr-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-display text-[11px] font-semibold tabular-nums text-brand">{code}</span>
            <span className="h-3 w-px bg-white/15" />
            <h2 id={titleId} className="truncate font-display text-lg font-bold tracking-[-0.01em] text-white">
              {title}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Cerrar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 text-neutral-200 transition-colors hover:border-brand hover:text-brand focus:outline-none focus-visible:border-brand focus-visible:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Icon.Close />
          </button>
        </header>
        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/** Paso numerado dentro del modal */
function ModalStep({ index, title, children }) {
  return (
    <section className="flex gap-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand font-display text-[12px] font-semibold text-brand">
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <h3 className="pt-2 font-display text-[16px] font-bold tracking-[-0.01em] text-white">{title}</h3>
        {children}
      </div>
    </section>
  );
}

function PhysicalPassModal({ open, onClose, download, onDownload, mailtoHref, onOpenEmail, onCopyEmail, emailCopied }) {
  return (
    <Modal open={open} onClose={onClose} code="P2" title="Solicitar pase físico">
      <div className="space-y-6">
        <ModalStep index="01" title="Descarga tu credencial">
          <p className="font-display text-[14px] leading-relaxed text-neutral-400">
            Guarda tu credencial en PNG; la adjuntarás en el correo.
          </p>
          <div className="[&>*]:w-full">
            <DownloadButton {...download} onClick={onDownload} />
          </div>
        </ModalStep>

        <ModalStep index="02" title="Envíala por correo">
          <p className="font-display text-[14px] leading-relaxed text-neutral-400">
            Se abrirá tu correo con el destinatario, el asunto y tus datos listos. Solo adjunta el PNG y envía.
          </p>
          <Button
            variant="primary"
            icon={<Icon.Send className="h-4 w-4 shrink-0" />}
            href={mailtoHref}
            onClick={onOpenEmail}
            className="w-full text-center leading-snug"
          >
            Enviar credencial a {PHYSICAL_PASS_EMAIL}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
            <span className="font-display text-[13px] text-neutral-400">
              ¿Usas Gmail u Outlook web? Copia el correo:
            </span>
            <button
              type="button"
              onClick={onCopyEmail}
              className={`inline-flex shrink-0 items-center gap-1.5 font-display text-[13px] font-semibold transition-colors ${
                emailCopied ? "text-brand" : "text-neutral-200 hover:text-brand"
              }`}
            >
              {emailCopied ? <Icon.Check /> : <Icon.Link className="h-3.5 w-3.5" />}
              {emailCopied ? "¡Copiado!" : PHYSICAL_PASS_EMAIL}
            </button>
          </div>
        </ModalStep>

        <p className="flex gap-3 rounded-xl border border-brand/25 bg-brand/[0.07] px-4 py-3 font-display text-[13px] leading-relaxed text-neutral-200">
          <Icon.Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
          <span>{PHYSICAL_PASS_NOTICE}</span>
        </p>
      </div>
    </Modal>
  );
}

function PhysicalPass({ status, closed, onOpen }) {
  const ui = closed && status === PHYSICAL.NONE ? { tone: "idle", text: "Plazo cerrado" } : PHYSICAL_UI[status];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <DataRow label="Estado">
          <StatusChip tone={ui.tone} pulse={ui.pulse} className="whitespace-normal text-left">
            {ui.text}
          </StatusChip>
        </DataRow>
        <DataRow label="Enviar a">
          <span className="block truncate font-display text-[15px] text-white">{PHYSICAL_PASS_EMAIL}</span>
        </DataRow>
      </div>

      {closed ? (
        <Button variant="outline" icon={<Icon.Clock />} disabled>
          Plazo cerrado
        </Button>
      ) : (
        // abre el modal con los pasos: descargar PNG → enviar por correo
        <Button
          variant="outline"
          icon={<Icon.Send className="h-4 w-4 shrink-0" />}
          onClick={onOpen}
          aria-haspopup="dialog"
          className="text-center leading-snug"
        >
          Enviar credencial a {PHYSICAL_PASS_EMAIL}
        </Button>
      )}

      <p className="flex gap-3 rounded-xl border border-brand/25 bg-brand/[0.07] px-4 py-3 font-display text-[13px] leading-relaxed text-neutral-200">
        <Icon.Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
        <span>{PHYSICAL_PASS_NOTICE}</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Broadcast / Aporte                                                 */
/* ------------------------------------------------------------------ */

function ShareButtons({ onShare, copied }) {
  const targets = [
    { id: "linkedin", label: "LinkedIn", icon: <Icon.LinkedIn /> },
    { id: "instagram", label: "Instagram", icon: <Icon.Instagram /> },
    {
      id: "copy",
      label: copied ? "¡Copiado!" : "Copiar link",
      icon: copied ? <Icon.Check /> : <Icon.Link />,
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {targets.map((t) => (
        <Button
          key={t.id}
          variant="ghost"
          icon={t.icon}
          onClick={() => onShare(t.id)}
          aria-label={t.label}
          className={`gap-2 whitespace-nowrap px-3 py-2.5 text-[13px] ${
            t.id === "copy" && copied ? "border-brand text-brand hover:border-brand" : ""
          }`}
        >
          <span className="hidden sm:inline">{t.label}</span>
        </Button>
      ))}
    </div>
  );
}

function ContributionStep({ contribution, onChange, shareText, onShare, copied }) {
  const max = 140;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusChip tone="live" pulse>
          ¡Evento exclusivo!
        </StatusChip>
        <span className="font-display text-[14px] text-neutral-300">
          Que todos sepan que vas a estar ahí
        </span>
      </div>

      <div className="group">
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="bwc-contribution" className="flex items-center gap-2">
            <span className="font-display text-[11px] font-semibold text-neutral-500 group-focus-within:text-brand">06</span>
            <TechLabel className="text-neutral-400 group-focus-within:text-brand">¿Qué quieres aplicar con IA?</TechLabel>
          </label>
          <span className="font-display text-[11px] font-medium tabular-nums text-neutral-500">
            {String(contribution.length).padStart(3, "0")}/{max}
          </span>
        </div>
        <textarea
          id="bwc-contribution"
          rows={3}
          maxLength={max}
          value={contribution}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Automatizar la atención al cliente con IA…"
          className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 font-display text-[15px] text-white caret-brand outline-none transition-colors placeholder:text-neutral-600 focus:border-brand focus:shadow-[0_0_0_3px_rgba(238,87,52,0.15)]"
        />
      </div>

      <Card tone="warm" className="!p-4 sm:!p-5">
        <TechLabel>Mensaje a publicar</TechLabel>
        <p className="mt-2 font-display text-[15px] leading-relaxed text-white">{shareText}</p>
      </Card>

      <ShareButtons onShare={onShare} copied={copied} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toast                                                              */
/* ------------------------------------------------------------------ */

function Toast({ toast }) {
  const time = useMemo(() => new Date().toTimeString().slice(0, 8), [toast]);
  const isError = toast?.tone === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={`fixed bottom-6 right-6 z-[70] w-[min(20rem,calc(100vw-3rem))] overflow-hidden rounded-2xl border bg-[#0a0b10]/95 backdrop-blur transition-all duration-300 ${
        isError
          ? "border-red-500 shadow-[0_0_40px_-8px_rgba(239,68,68,0.7)]"
          : "border-brand shadow-[0_0_40px_-8px_rgba(238,87,52,0.7)]"
      } ${toast ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${isError ? "bg-red-500" : "bg-brand"}`} />
      <div className="flex items-center justify-between border-b border-white/10 py-2 pl-5 pr-4">
        <TechLabel className={isError ? "text-red-400" : "text-brand"}>{toast?.title ?? ""}</TechLabel>
        <span className="font-display text-[11px] tabular-nums text-neutral-500">{time}</span>
      </div>
      <p className="py-3 pl-5 pr-4 font-display text-[14px] leading-relaxed text-neutral-100">{toast?.message ?? ""}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel de control (compone los pasos)                               */
/* ------------------------------------------------------------------ */

function ControlPanel({ currentStep, onStepChange, children }) {
  return (
    <Panel
      code="MOD_03"
      title="Credencial"
      chips={
        <>
          <StatusChip tone="ok" pulse>
            Online
          </StatusChip>
          <StatusChip className="hidden sm:inline-flex">v2.1.0</StatusChip>
        </>
      }
    >
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <div>
          <h2 className="font-display text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-white sm:text-[34px]">
            Genera tu credencial
          </h2>
          <p className="mt-2 font-display text-sm text-neutral-400 sm:text-[15px]">
            Completa los {STEPS.length} pasos para obtener tu pase de acceso
          </p>
        </div>

        <StepIndicator steps={STEPS} current={currentStep} onSelect={onStepChange} />

        <TechDivider index={String(currentStep + 1).padStart(2, "0")} label={STEP_TITLES[currentStep]} />
        {/* key fuerza el re-montaje para animar la entrada de cada paso */}
        <div key={currentStep} className="animate-[bwcFadeIn_250ms_ease-out]">
          {children}
        </div>
      </div>

      <div className="border-t border-white/10 bg-white/[0.02] px-4 py-4 sm:px-6">
        <StepNav current={currentStep} total={STEPS.length} onChange={onStepChange} />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/*  Columna derecha: vista previa del badge                            */
/* ------------------------------------------------------------------ */

/**
 * Devuelve `{ url, coverage }` de la imagen sin fondo sólido
 * (o la original si ya era transparente). `null` mientras se procesa.
 */
function useTransparentImage(src, { mode = "global", trim = false } = {}) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let cancelled = false;
    removeBackground(src, { mode, trim })
      .then((out) => !cancelled && setResult(out))
      .catch(() => !cancelled && setResult({ url: src, coverage: 1 }));
    return () => {
      cancelled = true;
    };
  }, [src, mode, trim]);
  return result;
}

/** Imagen de marca sin fondo; reserva su espacio mientras se procesa */
function BrandImage({ src, alt, mode, trim, className = "", ...props }) {
  const image = useTransparentImage(src, { mode, trim });
  return image ? (
    <img src={image.url} alt={alt} draggable={false} className={className} {...props} />
  ) : (
    <span aria-hidden className={`inline-block ${className}`} />
  );
}

/**
 * Título del evento (PNG de /public). El fondo oscuro de sus esquinas se vuelve
 * transparente (solo el conectado al borde, así la barra y el texto quedan intactos)
 * Se muestra plano, sin resplandor.
 */
function EventTitle() {
  return (
    <BrandImage
      src={BADGE_ASSETS.title}
      alt="IA en Acción"
      mode="edges"
      className="block h-auto w-full"
    />
  );
}

/** QR real y escaneable (qrcode-generator) dibujado como un único <path> SVG */
function QRCode({ value }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M"); // versión automática, corrección de errores media
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { size: n, path: d };
  }, [value]);

  return (
    <svg
      viewBox={`-2 -2 ${size + 4} ${size + 4}`}
      className="h-full w-full"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Código QR: ${value}`}
    >
      <rect x="-2" y="-2" width={size + 4} height={size + 4} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

function PhotoFrame({ src, alt }) {
  return (
    <div className="relative">
      <div className="relative aspect-[4/5] w-full overflow-hidden border border-neutral-600 bg-neutral-900">
        {src ? (
          <img
            src={src}
            alt={alt}
            // Las URLs externas se piden con CORS para poder exportarlas al PNG
            crossOrigin={/^https?:/i.test(src) ? "anonymous" : undefined}
            className="h-full w-full object-cover contrast-125 grayscale"
          />
        ) : (
          <div className="flex h-full w-full items-end justify-center bg-gradient-to-b from-neutral-800 to-neutral-950">
            <Icon.User className="h-4/5 w-4/5 text-neutral-600" />
          </div>
        )}
        <span className="absolute bottom-0 left-0 bg-black px-1.5 py-0.5 font-mono text-[7px] font-bold uppercase tracking-[0.2em] text-brand">
          IMG_01 · B&W
        </span>
      </div>
      <CornerBrackets size="h-2.5 w-2.5" inset="-m-1" />
    </div>
  );
}

function BadgeField({ index, label, children, accent = false }) {
  return (
    <div className={`border-l-2 pl-2 ${accent ? "border-brand" : "border-neutral-600"}`}>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[8px] font-bold tabular-nums text-neutral-600">{index}</span>
        <span className="font-mono text-[8px] font-medium uppercase tracking-[0.22em] text-neutral-500">{label}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Tarjeta de credencial. `cardRef` apunta al <article> que se exporta a PNG,
 * así la imagen descargada es exactamente lo que se ve en la vista previa.
 */
function BadgePreview({ attendee, qrValue, qrCaption, cardRef }) {
  const { photoUrl } = attendee;
  // Campo vacío → se muestra el placeholder atenuado, que cambia al escribir
  const field = (key) => {
    const value = attendee[key].trim();
    return { text: value || FIELD_PLACEHOLDERS[key], empty: !value };
  };
  const name = field("name");
  const role = field("role");
  const company = field("company");
  const [first, ...rest] = name.text.split(/\s+/);
  const dim = "text-neutral-600";

  return (
    <div className="relative mx-auto w-full max-w-sm">
      {/* ranura del lanyard (fuera del área exportada) */}
      <div className="relative z-10 mx-auto mb-[-11px] flex h-[22px] w-20 items-center justify-center border border-neutral-500 bg-[#070707]">
        <span className="h-1.5 w-12 rounded-full border border-neutral-600 bg-black" />
      </div>

      <article
        ref={cardRef}
        className="bwc-badge relative overflow-hidden border border-neutral-500/80 bg-[#0a0a0a] shadow-[0_0_0_1px_#000,0_0_0_5px_#141414,0_0_0_6px_#2a2a2a,-28px_10px_70px_-14px_rgba(37,99,235,0.5),28px_-10px_70px_-14px_rgba(238,87,52,0.55)]"
      >
        {/* ---------- Encabezado ---------- */}
        <div className="relative h-48 overflow-hidden border-b border-neutral-700 bg-[radial-gradient(ellipse_at_top_right,#1c1c1c,#050505_70%)] px-5 pt-4">
          {/* red neuronal: esquina superior derecha (girada para que el núcleo quede en la esquina) */}
          <BrandImage
            src={BADGE_ASSETS.neural}
            alt=""
            className="pointer-events-none absolute -right-4 -top-4 z-0 w-[68%] rotate-180 opacity-60"
          />
          <h1 className="relative z-20 mt-4 w-[72%]">
            <EventTitle />
          </h1>
          <div className="absolute bottom-3 left-5 right-5 z-10 flex items-end justify-between">
            <span className="font-mono text-[8px] font-bold tracking-[0.2em] text-neutral-400">
              ACCESO TOTAL
            </span>
            <GradientPill innerClassName="px-4 py-1 text-[11px] tracking-[0.22em]">Builder</GradientPill>
          </div>
        </div>

        {/* ---------- Cuerpo ---------- */}
        <div className="grid grid-cols-[1fr_1.1fr] gap-5 px-5 py-5">
          <PhotoFrame src={photoUrl} alt={name.empty ? "" : name.text} />
          <div className="flex min-w-0 flex-col justify-between gap-3">
            <BadgeField index="01" label="Nombre">
              <p
                className={`mt-0.5 break-words font-display text-[22px] font-bold uppercase leading-[1.02] ${
                  name.empty ? dim : "text-white"
                }`}
              >
                {first}
                {rest.length > 0 && (
                  <>
                    <br />
                    <span className={name.empty ? dim : "text-neutral-300"}>{rest.join(" ")}</span>
                  </>
                )}
              </p>
            </BadgeField>
            <div className="space-y-2.5">
              <BadgeField index="02" label="Rol" accent>
                <p
                  className={`mt-0.5 truncate font-mono text-[13px] font-extrabold uppercase tracking-[0.08em] ${
                    role.empty ? dim : "text-brand"
                  }`}
                >
                  {role.text}
                </p>
              </BadgeField>
              <BadgeField index="03" label="Empresa">
                <p
                  className={`mt-0.5 truncate font-mono text-[13px] font-extrabold uppercase tracking-[0.08em] ${
                    company.empty ? dim : "text-white"
                  }`}
                >
                  {company.text}
                </p>
              </BadgeField>
            </div>
          </div>
        </div>


        {/* red neuronal sutil: esquina inferior izquierda */}
        <BrandImage
          src={BADGE_ASSETS.neural}
          alt=""
          className="pointer-events-none absolute -bottom-4 -left-4 z-0 w-[70%] opacity-70 [-webkit-mask-image:radial-gradient(circle_at_0%_100%,#000_45%,transparent_85%)] [mask-image:radial-gradient(circle_at_0%_100%,#000_45%,transparent_85%)]"
        />

        {/* ---------- Pie ---------- */}
        {/* Pie en una sola fila: fecha + "Powered by" a la izquierda, QR a la derecha */}
        <footer className="relative z-10 flex items-center justify-between gap-4 border-t border-neutral-700 bg-[radial-gradient(ellipse_at_0%_100%,rgba(37,99,235,0.16),transparent_55%),radial-gradient(ellipse_at_100%_0%,rgba(238,87,52,0.14),transparent_55%)] px-5 pb-4 pt-3.5">
          <div className="min-w-0">
            <p className="whitespace-nowrap font-display text-[32px] font-bold leading-[0.95] tracking-[-0.01em] text-brand min-[420px]:text-[40px]">
              LIMA 2026
            </p>
            {/* Textos secundarios del pie: misma fuente que "LIMA 2026" (Space Grotesk) */}
            <p className="mt-1.5 font-display text-[6.5px] font-medium tabular-nums tracking-[0.18em] text-neutral-500">
              12.0464° S · 77.0428° W
            </p>

            <span className="mt-2.5 block font-display text-[8px] font-semibold uppercase leading-none tracking-[0.22em] text-neutral-500">
              Powered by
            </span>
            {/* Logos sin su fondo #0d0d0d (se vuelve transparente) y recortados al contenido.
                Alturas distintas a propósito: NXTEP es una sola línea de mayúsculas y
                Perú Tech Week tiene dos líneas; así sus textos grandes pesan igual. */}
            <div className="mt-1.5 flex items-center gap-2.5">
              <BrandImage src={BADGE_ASSETS.logoNxtep} alt="NXTEP" trim className="h-3 w-auto shrink-0" />
              <span className="h-4 w-px shrink-0 bg-neutral-600" aria-hidden />
              <BrandImage
                src={BADGE_ASSETS.logoPeruTechWeek}
                alt="Perú Tech Week 2026"
                trim
                className="h-[18px] w-auto shrink-0"
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-center">
            <div className="h-[68px] w-[68px] overflow-hidden rounded-lg bg-white p-1 shadow-[-4px_0_16px_-6px_rgba(37,99,235,0.7),4px_0_16px_-6px_rgba(238,87,52,0.7)]">
              <QRCode value={qrValue} />
            </div>
            {/* la etiqueta puede ser algo más ancha que el QR; se corta solo si es muy larga */}
            <span className="mt-1.5 block max-w-[104px] truncate whitespace-nowrap font-display text-[7px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
              {qrCaption}
            </span>
          </div>
        </footer>
      </article>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hooks de estado                                                    */
/* ------------------------------------------------------------------ */

/** Toast único con auto-cierre; un toast nuevo reinicia el temporizador */
function useToast(duration = 4000) {
  const [toast, setToast] = useState(null);
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  const notify = (title, message, tone = "ok") => {
    setToast({ title, message, tone, id: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), duration);
  };
  return [toast, notify];
}

/** Bandera booleana que vuelve a false tras `ms` (p. ej. "¡Copiado!") */
function useFlash(ms = 2000) {
  const [on, setOn] = useState(false);
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = () => {
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  };
  return [on, flash];
}

/* ------------------------------------------------------------------ */
/*  Sección principal                                                  */
/* ------------------------------------------------------------------ */

export default function GenerarBadge({
  initialAttendee,
  initialStep = 0,
  /** Enlace que se comparte/copia. Por defecto: la página del evento. */
  shareUrl = EVENT_URL,
  onPhysicalRequest = () => {},
  onShare = () => {},
}) {
  const [step, setStep] = useState(initialStep);
  const [attendee, setAttendee] = useState({ ...DEFAULT_ATTENDEE, ...initialAttendee });
  const [emailTouched, setEmailTouched] = useState(false);
  const [physical, setPhysical] = useState(PHYSICAL.NONE);
  const [download, setDownload] = useState({ status: "idle", meta: null });
  const [toast, notify] = useToast();
  const [copied, flashCopied] = useFlash();
  const [emailCopied, flashEmailCopied] = useFlash();
  const [passModalOpen, setPassModalOpen] = useState(false);
  const cardRef = useRef(null);

  const email = attendee.email.trim();
  // El correo es opcional: solo se valida el formato si se escribió algo
  const emailError = email && !isValidEmail(email) ? "Formato de correo no válido" : "";
  const visibleEmailError = emailTouched ? emailError : "";

  const socialUrl = buildSocialUrl(attendee.socialNetwork, attendee.socialHandle);
  // Sin red social, el QR lleva siempre a la página del evento
  const qrValue = socialUrl || EVENT_URL;
  const qrCaption = socialUrl ? socialDisplay(attendee.socialNetwork, socialUrl) : "SCAN";
  const shareText = buildShareText(attendee.contribution);
  const physicalClosed = Date.now() >= PHYSICAL_PASS_DEADLINE.getTime();
  const badgeFileName = `badge-${slugify(attendee.name)}.png`;

  const goToStep = (i) => setStep(Math.max(0, Math.min(STEPS.length - 1, i)));

  /* ---- 2. Descarga real del PNG ---- */
  const handleDownload = async () => {
    if (!cardRef.current || download.status === "loading") return;
    setDownload({ status: "loading", meta: null });
    const fileName = badgeFileName;
    try {
      const meta = await exportBadgePng(cardRef.current, { fileName, pixelRatio: EXPORT_PIXEL_RATIO });
      setDownload({ status: "done", meta });
      notify("Download // OK", `${fileName} descargado · ${meta.width}×${meta.height}px.`);
    } catch (err) {
      console.error("[GenerarBadge] Error al exportar PNG", err);
      setDownload({ status: "error", meta: null });
      notify("Error // Export", `No se pudo generar el PNG (${err.message}). Intenta de nuevo.`, "error");
    }
  };

  /* ---- 4. Pase físico: modal → descargar PNG → mailto (con plazo) ---- */
  const openPassModal = () => {
    if (Date.now() >= PHYSICAL_PASS_DEADLINE.getTime()) {
      notify("Físico // Plazo cerrado", "El plazo para solicitar pases físicos ya terminó.", "error");
      return;
    }
    setPassModalOpen(true);
  };

  const copyPassEmail = async () => {
    if (await copyToClipboard(PHYSICAL_PASS_EMAIL)) {
      flashEmailCopied();
      notify("Clipboard // OK", `¡Copiado! ${PHYSICAL_PASS_EMAIL}`);
    } else {
      notify("Error // Clipboard", "No se pudo copiar el correo.", "error");
    }
  };

  const handlePhysicalRequest = (event) => {
    if (Date.now() >= PHYSICAL_PASS_DEADLINE.getTime()) {
      event.preventDefault(); // el plazo venció mientras la página estaba abierta
      notify("Físico // Plazo cerrado", "El plazo para solicitar pases físicos ya terminó.", "error");
      return;
    }
    // sin preventDefault: el navegador abre el cliente de correo con el mailto
    setPhysical(PHYSICAL.PENDING);
    notify(
      "Físico // Correo",
      `Se abrió tu correo para ${PHYSICAL_PASS_EMAIL}. Adjunta tu credencial (PNG) antes de enviarlo.`
    );
    onPhysicalRequest({ ...attendee, email });
  };

  /* ---- 5. Broadcast ---- */
  const shareMessage = `${shareText} ${shareUrl}`;

  // Instagram no tiene enlace web para compartir: se copia el mensaje y se abre la app
  // (instagram:// / intent:// en móvil) o la web como respaldo. Ambas llamadas arrancan
  // sin await previo para conservar el clic del usuario.
  const shareToInstagram = async () => {
    const copying = copyToClipboard(shareMessage);
    const opened = openInstagram();
    const copiedOk = await copying;
    notify(
      "Broadcast // Instagram",
      `${copiedOk ? "Copiamos tu mensaje. " : ""}${
        opened === "app" ? "Abriendo Instagram…" : "Abrimos Instagram en una pestaña nueva."
      } Sube tu credencial (PNG) como post o historia.`
    );
  };

  const handleShare = async (target) => {
    if (target === "copy") {
      const ok = await copyToClipboard(shareUrl);
      if (ok) {
        flashCopied();
        notify("Clipboard // OK", "¡Copiado!");
      } else {
        notify("Error // Clipboard", "No se pudo copiar el enlace.", "error");
      }
    } else if (target === "instagram") {
      await shareToInstagram();
    } else {
      window.open(buildLinkedInShareUrl(shareUrl), "_blank", "noopener,noreferrer,width=640,height=640");
    }
    onShare(target);
  };

  const stepContent = [
    <DataStep
      attendee={attendee}
      onChange={setAttendee}
      emailError={visibleEmailError}
      onEmailBlur={() => setEmailTouched(true)}
    />,
    <PhotoStep
      photoUrl={attendee.photoUrl}
      onChange={(photoUrl) => setAttendee((a) => ({ ...a, photoUrl }))}
      onError={(msg) => notify("Error // Foto", msg, "error")}
    />,
    <div className="flex flex-col gap-5">
      <StatusBox exportMeta={download.meta} />
      <div className="flex flex-wrap items-center gap-3">
        <DownloadButton {...download} onClick={handleDownload} />
      </div>

      <Card tone="cool" className="space-y-4">
        <TechDivider index="P2" label="Pase físico" />
        <PhysicalPass status={physical} closed={physicalClosed} onOpen={openPassModal} />
      </Card>

      <Card className="space-y-5">
        <TechDivider index="P3" label="Broadcast" />
        <ShareButtons onShare={handleShare} copied={copied} />
      </Card>
    </div>,
    <ContributionStep
      contribution={attendee.contribution}
      onChange={(contribution) => setAttendee((a) => ({ ...a, contribution }))}
      shareText={shareText}
      onShare={handleShare}
      copied={copied}
    />,
  ];

  return (
    <section className="bwc relative min-h-screen overflow-hidden bg-[#060606] px-4 py-10 text-neutral-200 antialiased sm:px-8">
      <style>{GLOBAL_CSS}</style>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:40px_40px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,#060606_100%)]" />
      <div className="pointer-events-none absolute -left-40 top-1/3 h-96 w-96 rounded-full bg-brand/10 blur-3xl" />

      <div className="relative mx-auto max-w-6xl">
        {/* Cabecera: logos + título a la izquierda; acreditación + fecha a la derecha sobre la red neuronal */}
        <header className="relative mb-8 border-b border-neutral-700 pb-6">
          <span className="absolute -bottom-px left-0 h-px w-40 bg-brand shadow-[0_0_10px_rgba(238,87,52,0.9)]" />

          {/* red neuronal de fondo en el lado derecho, difuminada hacia la izquierda */}
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[60%] overflow-hidden" aria-hidden>
            <BrandImage
              src={BADGE_ASSETS.neural}
              alt=""
              className="absolute -right-4 top-1/2 w-[520px] max-w-none -translate-y-[58%] rotate-180 opacity-90 [-webkit-mask-image:linear-gradient(to_left,#000_45%,transparent_100%)] [mask-image:linear-gradient(to_left,#000_45%,transparent_100%)]"
            />
          </div>

          <div className="relative flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <BrandImage src={BADGE_ASSETS.logoNxtep} alt="NXTEP" trim className="h-4 w-auto sm:h-[18px]" />
                <span className="h-5 w-px bg-neutral-600 sm:h-6" aria-hidden />
                {/* dos líneas: algo más alto que NXTEP para que su texto grande pese igual */}
                <BrandImage
                  src={BADGE_ASSETS.logoPeruTechWeek}
                  alt="Perú Tech Week 2026"
                  trim
                  className="h-[21px] w-auto sm:h-[23px]"
                />
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                <h1 className="w-[260px] max-w-full sm:w-[300px]">
                  <BrandImage src={BADGE_ASSETS.title} alt="IA en Acción" mode="edges" className="block h-auto w-full" />
                </h1>
                <p className="font-display text-xl font-medium leading-[1.15] tracking-[-0.01em] text-white sm:text-[22px]">
                  Casos reales de IA
                  <br />
                  en empresas líderes
                </p>
              </div>
            </div>

            <div className="flex items-center gap-5">
              <GradientPill innerClassName="px-5 py-2.5 text-[11px] tracking-[0.25em]">Acreditación</GradientPill>
              <div className="text-right">
                <p className="font-display text-lg font-bold leading-tight tracking-[-0.01em] text-brand sm:text-xl">
                  14 de octubre
                </p>
                <p className="font-display text-xs text-neutral-400">Lima, Perú</p>
              </div>
            </div>
          </div>
        </header>

        <div className="grid items-start gap-8 lg:grid-cols-[1fr_1fr]">
          <ControlPanel currentStep={step} onStepChange={goToStep}>
            {stepContent[step]}
          </ControlPanel>

          <Panel
            code="OUT_01"
            title="Preview"
            className="lg:sticky lg:top-6"
            chips={
              <>
                <StatusChip tone="live" pulse>
                  Live
                </StatusChip>
                <StatusChip className="hidden sm:inline-flex">54×86mm</StatusChip>
              </>
            }
          >
            <div className="relative bg-[radial-gradient(circle_at_50%_40%,rgba(238,87,52,0.06),transparent_60%)] px-5 py-10 sm:px-8">
              <CornerBrackets color="border-neutral-600" size="h-4 w-4" inset="m-3" />
              <BadgePreview
                attendee={attendee}
                qrValue={qrValue}
                qrCaption={qrCaption}
                cardRef={cardRef}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-neutral-800 bg-black/40 px-5 py-2">
              <TechLabel className="text-[9px]">Render // 1:1</TechLabel>
              <TechLabel className="truncate text-[9px] normal-case tracking-[0.1em]">
                QR → {qrValue}
              </TechLabel>
            </div>
          </Panel>
        </div>
      </div>

      <PhysicalPassModal
        open={passModalOpen}
        onClose={() => setPassModalOpen(false)}
        download={download}
        onDownload={handleDownload}
        mailtoHref={buildPhysicalPassMailto(attendee)}
        onOpenEmail={handlePhysicalRequest}
        onCopyEmail={copyPassEmail}
        emailCopied={emailCopied}
      />

      <Toast toast={toast} />
    </section>
  );
}

export { BadgePreview, ControlPanel, StepIndicator, QRCode };
