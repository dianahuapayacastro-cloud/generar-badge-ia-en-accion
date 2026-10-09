# Generar Badge · IA en Acción (NXTEP)

Generador de credenciales del evento: datos del asistente, foto, QR dinámico, descarga en PNG y solicitud de pase físico.

## Cómo correrlo

```bash
npm install
npm run dev
```

Se abre en <http://localhost:5173>. Para detenerlo: `Ctrl + C` en la terminal.

> Si `npm install` falla con un error de permisos en `~/.npm` ("root-owned files"), ejecuta una vez
> `sudo chown -R 501:20 ~/.npm` y vuelve a intentarlo.

## Estructura

```
src/
  main.jsx                     # punto de entrada
  index.css                    # Tailwind
  components/GenerarBadge.jsx  # todo el componente
```

## Props de `<GenerarBadge />`

| Prop | Por defecto | Uso |
|---|---|---|
| `initialAttendee` | Campos vacíos (la tarjeta muestra los placeholders atenuados) | Datos iniciales (`name`, `role`, `company`, `email`, `photoUrl`, `ticketId`, `socialNetwork`, `socialHandle`, `contribution`) |
| `initialStep` | `0` | Paso inicial (0 Datos · 1 Foto · 2 Pase · 3 Aporte) |
| `shareUrl` | https://luma.com/39mwym77 | Enlace que se comparte/copia (el QR sin red social siempre apunta a la página del evento) |
| `onPhysicalRequest(attendee)` | — | Se llama al abrir el correo de solicitud (mailto a didi@nxtep.org, hasta el lun 12 oct 10:00 a.m. Lima) |
| `onShare(target)` | — | `"linkedin"`, `"instagram"` o `"copy"` |

## Pendiente para producción

- La solicitud de pase físico se envía por correo (mailto) y se gestiona manualmente desde didi@nxtep.org; la página no confirma el envío ni la aprobación.
