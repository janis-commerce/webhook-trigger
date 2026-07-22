# webhook-trigger — correlationId en sendBatch + WebhookTrigger.shouldSend()

> Repo: `packages/webhook-trigger` (`@janiscommerce/webhook-trigger`) · Branch: `feature/correlation-id-should-send` · Épica: [ATR-2474](https://janiscommerce.atlassian.net/browse/ATR-2474) / [JCAT-1238](https://janiscommerce.atlassian.net/browse/JCAT-1238)
> Estado: aprobado · Creado: 2026-07-22

## Objetivo

Features backward-compatible en `@janiscommerce/webhook-trigger` (release **v3.1.0**):
1. **`correlationId`** opcional por evento en `sendBatch`, ecoado en cada `output` → el caller correlaciona 1:1 cada resultado con su origen (ej. mapear un fallo a su record SQS y reportar `batchItemFailures` preciso).
2. **`WebhookTrigger.shouldSend(clientCode, entity, eventName)`** público → expone el pre-filtering de subscriptions (fail-open) para short-circuit temprano y ahorro de costos.
3. Ajustes menores: optimización de `ClientModel` (query + estructura de lookup) y nivel de log del fail-open.

## Contexto

Motivado por la implementación de webhooks en catalog (JCAT-1238). El consumer quiere usar `sendBatch` (batch nativo, eficiente) con retry parcial exacto vía `batchItemFailures`, pero hoy `sendBatch` no permite correlacionar outputs con records: no devuelve el `messageId` de SQS ni garantiza orden posicional (skips/validation-failures inline, éxitos/fallos del batch después; los `Successful` ni siquiera traen el evento). Sin correlación, la única opción es `throw` (redrive total → duplica) o mapear por content (colisiona con ids repetidos). `correlationId` lo resuelve de raíz.

`shouldSend` nace de servicios como WMS stock: hoy el pre-filtering vive dentro de `send`/`sendBatch`, recién después de armar el webhook. Exponerlo permite preguntar **antes** de hacer procesamiento caro y evitarlo si nadie está suscripto. Como `send` se llama a muy alta frecuencia (stock), se aprovecha para optimizar la lectura de subscriptions.

## Alcance

✅ Incluye:
- `correlationId` opcional en cada `WebhookEvent` de `sendBatch`; ecoado en el `output` correspondiente en los 4 caminos: success, send-failure, skipped, validation-failure.
- `WebhookTrigger.shouldSend(clientCode, entity, eventName): Promise<boolean>` (delega en el helper de subscriptions, fail-open).
- **Optimizar `ClientModel.getSubscriptions`**: `getBy` con `fields: ['code', 'webhookSubscriptions']` (traer solo lo necesario, no el doc completo del cliente) y devolver/cachear `webhookSubscriptions` como **`Set`** para lookup O(1) con `.has()`.
- `has-subscription`: fail-open por subs no sincronizadas `info()` → `warn()`; usar `.has()` (Set) en vez de `.includes()`.
- README: documentar `correlationId` (Batch event triggering) y `shouldSend` (Subscription pre-filtering + su sección), ambos con **"Added in v3.1.0"**; sacar el `🆕` de Batch event triggering (viene de v2); **revisar TODO el README** y corregir/aclarar lo ya existente.
- Tests de todo lo anterior. CHANGELOG `[Unreleased] → [3.1.0]`.

❌ NO incluye:
- `correlationId` en `send()` (single) — `send` ya es 1:1. Solo `sendBatch`.
- Que el `correlationId` viaje al webhook real: es **metadata del output**, NO se incluye en el `MessageBody` de la cola central ni llega al subscriber.
- Cambios en `registration` / `sync-webhook-subscriptions-consumer` / `serverless-helper-hooks`.
- El consumer de WMS stock que usará `shouldSend` (otra sesión).
- Cambiar el formato persistido de `webhookSubscriptions` en Mongo (sigue siendo array; el `Set` es solo en memoria para lectura).

## Criterios de aceptación

- [ ] `sendBatch` con eventos que traen `correlationId` → cada `output` correspondiente incluye el mismo `correlationId`, en los 4 caminos (success, send-failure, skipped, validation-failure).
- [ ] `sendBatch` sin `correlationId` → outputs sin el campo; comportamiento byte-idéntico al actual (WMS no se afecta).
- [ ] El `correlationId` NO aparece en el `MessageBody` enviado a `JANIS_WEBHOOKS_QUEUE_URL`.
- [ ] `WebhookTrigger.shouldSend(clientCode, entity, eventName)` devuelve `true`/`false` según la subscription local, y `true` (fail-open) si las subs son `undefined` o falla la lectura.
- [ ] `ClientModel.getSubscriptions` llama a `getBy` con `fields: ['code', 'webhookSubscriptions']` y devuelve un `Set` (o `undefined` si nunca sincronizó); el cache guarda el `Set`.
- [ ] La validación de subscription usa `Set.has()`; `has-subscription` loguea `warn` (no `info`) en el fail-open por subs no sincronizadas; el fail-open por error de lectura sigue en `error`; el skip normal sigue en `info`.
- [ ] README: `correlationId` y `shouldSend` documentados con "Added in v3.1.0"; sin `🆕` en Batch event triggering; resto revisado y consistente.
- [ ] `npm run lint` y tests verdes; cobertura de los nuevos paths.

## Plan de archivos

- `lib/trigger.js` (edit) — `sendBatch`: leer `correlationId` por event; mapa `correlationIdByIndex[eventIndex]` (el `Id` del batch entry SQS sigue siendo `eventIndex`, **no** usar el correlationId como Id); incluir `correlationId` en outputs de validation-failure y skip; pasar el mapa a `sendMessagesBatch`. Agregar `static shouldSend(clientCode, entity, eventName)` delegando en el helper.
- `lib/helpers/sqs.js` (edit) — `sendMessagesBatch`: recibir el mapa; ecoar `correlationId` en outputs `Successful` (usa `successfulResult.Id`) y `Failed`.
- `lib/helpers/client-model.js` (edit) — `getSubscriptions`: `getBy('code', clientCode, { limit: 1, fields: ['code', 'webhookSubscriptions'] })`; convertir `webhookSubscriptions` a `Set` al leer y cachear el `Set`. `updateSubscriptions` sin cambios (persiste array).
- `lib/helpers/has-subscription.js` (edit) — `.includes()` → `.has()`; `info()` → `warn()` en el fail-open por subs no sincronizadas. Rename interno permitido por consistencia con `shouldSend` (opcional).
- `lib/index.js` — revisar; sin cambios esperados (shouldSend es método de `WebhookTrigger`).
- `README.md` (edit) — ver Alcance.
- `CHANGELOG.md` (edit) — `[3.1.0]`.
- `tests/trigger.js`, `tests/sqs.js`, `tests/helpers/has-subscription.js`, `tests/helpers/client-model.js` (edit/nuevo) — `correlationId` (4 caminos + ausencia), `shouldSend` (true/false/fail-open), `getBy` con `fields`, `Set`/`has`, nivel de log.

## Decisiones

- **Campo `correlationId`** — término de mensajería; no colisiona con `referenceId` (dominio) — planos distintos.
- **Método `shouldSend`** — refleja el fail-open ("deberías enviar", `true` cuando no se puede determinar), mejor que un `hasSubscription` que sugeriría booleano estricto.
- **`correlationId` solo en `sendBatch`**; es metadata del output, no viaja al webhook.
- **`Id` del batch entry SQS sigue siendo `eventIndex`**; el `correlationId` va en un mapa paralelo (evita romper unicidad/validez del `Id` si el correlationId trae chars inválidos o se repite).
- **`webhookSubscriptions` como `Set` en memoria** para lookup O(1) (`send` es hot path, sobre todo stock); persistencia en Mongo sigue array; `getBy` con `fields` para minimizar el payload.
- **Bump minor 3.1.0** — todo backward-compatible.

## Abiertas

—
