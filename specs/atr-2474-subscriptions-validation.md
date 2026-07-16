# ATR-2474 — Pre-filtro de webhooks por suscripción en el package (validación en send() + consumer de sync)

> Repo: `packages/webhook-trigger` (`@janiscommerce/webhook-trigger`) · Branch: `ATR-2474-subscriptions-validation` · Ticket: [ATR-2474](https://janiscommerce.atlassian.net/browse/ATR-2474)
> Estado: aprobado (2026-07-16) · Creado: 2026-07-16

## Objetivo

El package deja de encolar webhooks a ciegas: `send()`/`sendBatch()` validan contra una copia local de las suscripciones del cliente (`clients.webhookSubscriptions`) y no emiten cuando nadie está suscripto al trigger. La copia se mantiene por push: el package expone un consumer SQS suscripto al topic `clientSubscriptionsUpdated` de webhooks-service que, ante un cambio, reconsolida vía la lambda `ClientTriggersSubscriptions` y sobreescribe la copia local. Retrocompatible: sin datos sincronizados (`undefined`) → fail-open (emite igual, con logger específico).

## Contexto

Paso 2 del rollout de ATR-2474 (épica "Webhooks de Catálogo, Precio y Stock" → Producteca, VierciUY/MELI). Hoy los 9 services emisores (vtex-catalog, picking, tms, control, oms, delivery, csx, wms, batch) encolan a la cola `webhooks` sin validar suscripción; el miss se descarta recién en el `events-consumer`, pagando SQS + Lambda igual. Con webhooks de stock (altísima frecuencia) la relación miss/hit se vuelve insostenible.

Paso 1 (webhooks-service, branch `ATR-2474-subscriptions-topic`, ya en beta) fijó el contrato cross-repo:
- **Topic SNS `clientSubscriptionsUpdated`** (semántica por cliente): body `{ clientCode, triggersEvents, source }` (`source ∈ subscription-save | client-created | backfill`), message attribute `services` = todos los services con triggers registrados. Publicado en save de suscripción, en alta de cliente (consumer de `devops.clientCreated` → estado `[]`) y en el backfill. `RawMessageDelivery: true`.
- **Lambda `ClientTriggersSubscriptions`** (sessionada por cliente, NO recibe clientCode; input opcional `serviceCode`) → `{ triggersIds: [ObjectId], triggersEvents: [String] }` de suscripciones `status active`, dedup. `triggersEvents` en formato `service:entity:eventName`.
- **Lambda backfill `PublishClientsSubscriptions`** ya publica el topic por cliente para poblar en masa.

El payload del topic es informacional: el consumer nunca aplica el `triggersEvents` del mensaje — siempre reconsolida vía la lambda y sobreescribe (idempotente; el desorden entre mensajes converge).

Estado del package (v2.2.0): `send()`/`sendBatch()` en `lib/trigger.js` encolan directo a SQS vía `lib/helpers/sqs.js`; no tocan Mongo. Ya expone piezas que el service monta (`RegistrationLambda` factory, `serverlessHelperHooks()`). Deps actuales relevantes: `@janiscommerce/lambda` (Invoker), `@janiscommerce/log`, `lllog`.

## Alcance

✅ Incluye:
- **Helper unificado de acceso al ClientModel del service host** (`lib/helpers/client-model.js`): resuelve por require dinámico `process.cwd()/${MS_PATH}/models/client` (patrón `@janiscommerce/api-session/lib/client.js`), memoiza la instancia, instancia `new ClientModel()` **sin session** (colección `clients`, `databaseKey: 'core'` — no requiere session ni para leer ni para escribir). Lectura con caché in-memory propio **TTL 5 min por clientCode** (objeto módulo-level con `expirationTime`, sobrevive warm container). Escritura sin caché.
- **Validación en `send()`**: antes de encolar, lee `client.webhookSubscriptions` vía el helper. Si es array (incl. `[]`) → emite si incluye la key `${JANIS_SERVICE_NAME}:${entity}:${eventName}`, descarta si no. Si es `undefined` o la lectura falla → **fail-open + logger específico por caso** (emite igual).
- **Validación en `sendBatch()`**: misma lógica por evento (agrupa lecturas por clientCode, reusa el caché); los descartados no se encolan y se contabilizan aparte.
- **Consumer SQS `WebhookSubscriptionsConsumer`** (`lib/webhook-subscriptions-consumer.js`, extiende `IterativeSQSConsumer` de `@janiscommerce/sqs-consumer`, single-record): toma `body.clientCode` → invoca `ClientTriggersSubscriptions` en webhooks (sessionada por cliente, `{ serviceCode: JANIS_SERVICE_NAME }`) → **overwrite** `clients.webhookSubscriptions` con `triggersEvents` vía el helper. Body sin `clientCode` → log y descarta sin romper el batch; falla de lambda/escritura → reintento SQS.
- **Factory de hooks de serverless para el consumer** (`subscriptionsConsumerServerlessHelperHooks(SQSHelper)`, patrón `exportServerlessHelperHooks` de api-list): devuelve `[SQSHelper.sqsPermissions, ...SQSHelper.buildHooks({...})]` con `sourceSnsTopic` remoto a `webhooks/clientSubscriptionsUpdated` filtrado por `filterPolicy: { services: ['${self:custom.serviceCode}'] }`, resiliencia MainQueue → DelayQueue → DLQ, e IAM para invocar la lambda. `SQSHelper` se inyecta por parámetro (no se acopla la versión).
- Nuevos exports en `lib/index.js`, actualización de `README.md` y tests con 100% de cobertura.

❌ NO incluye:
- Cambios en `janis-webhooks-service` (paso 1, ya en beta).
- Montar el consumer / actualizar el package en los services emisores (paso 3, repo por repo).
- Ejecutar el backfill (paso 4, operativo).
- Un consumer propio de `devops.clientCreated` en el package: las altas de cliente ya llegan por el mismo topic `clientSubscriptionsUpdated` (webhooks publica `[]` al crearse). El package tiene **un solo** consumer.
- Poblar `webhookSubscriptions` vía `additionalFields`/client-creator: es un campo lateral escrito **solo** por este consumer (los `additionalFields` no presentes en el payload del ID se `$unset`ean en el sync ID↔MS).
- La CloudWatch Alarm sobre la DLQ (la maneja infra, estándar).
- Deprecación/migración de `TriggerSettingsUpdate` (definición A, abierta; no bloquea).

## Criterios de aceptación

Validación en `send()`:
- [ ] Con `webhookSubscriptions` array que **incluye** `${JANIS_SERVICE_NAME}:${entity}:${eventName}` → encola a SQS como hoy y devuelve `{ success: true, messageId }`.
- [ ] Con `webhookSubscriptions` array que **NO incluye** la key (incluido `[]`) → **no encola**, devuelve `{ success: true, skipped: true }` y loguea el descarte con logger identificable.
- [ ] Con `webhookSubscriptions` `undefined` → **fail-open**: encola y loguea con logger específico ("cliente sin suscripciones sincronizadas, emitiendo").
- [ ] Si la lectura del client falla (client no encontrado, model del service ausente, error de Mongo) → **fail-open**: encola y loguea el error con logger propio y claro por caso.
- [ ] La lectura del client usa caché 5 min por clientCode: N `send()` del mismo clientCode dentro de la ventana pegan a Mongo **una** vez.

Validación en `sendBatch()`:
- [ ] Cada evento se valida por su `clientCode`; los suscriptos se encolan, los no suscriptos se omiten y se reportan en un contador nuevo `skippedCount` (+ output `{ success: true, skipped: true, message }`), sin romper `successCount`/`failedCount` existentes.
- [ ] `undefined`/error de lectura por clientCode → fail-open (esos eventos se encolan), con el logger correspondiente.

Consumer:
- [ ] Un mensaje con `body.clientCode` invoca `ClientTriggersSubscriptions` en `webhooks` (sessionada por ese cliente, payload `{ serviceCode: JANIS_SERVICE_NAME }`) y sobreescribe `clients.webhookSubscriptions` del service con el `triggersEvents` devuelto (overwrite total, no merge).
- [ ] `triggersEvents: []` (cliente sin suscripciones / alta) → persiste `[]` (habilita el bloqueo desde el día cero).
- [ ] Record sin `body.clientCode` → se loguea y descarta sin marcar fallo del batch.
- [ ] Falla de la lambda o de la escritura → el record se marca fallido / se propaga para que SQS reintente (no se traga el error).

Serverless hooks:
- [ ] `subscriptionsConsumerServerlessHelperHooks(SQSHelper)` devuelve hooks que declaran la queue suscripta a `webhooks/clientSubscriptionsUpdated` con `filterPolicy` por `services` conteniendo el serviceCode, la cadena MainQueue → DelayQueue → DLQ, el IAM de invocación de la lambda y el handler por convención (`src/sqs-consumer/<prefixPath>/webhook-subscriptions-consumer.handler`).
- [ ] `serverlessHelperHooks()` (send) mantiene su firma y comportamiento actuales (retrocompat).

Transversales:
- [ ] `lib/index.js` exporta `WebhookSubscriptionsConsumer` y `subscriptionsConsumerServerlessHelperHooks` además de lo actual.
- [ ] `npm run lint` y `npm test` en verde; cobertura 100%. Tests nuevos cubren: send (incluye/no incluye/`[]`/undefined/error de lectura/caché hit), sendBatch (mix suscripto/no/undefined), helper (resolución+memoize del model, caché TTL, lectura, escritura), consumer (ok/`[]`/body inválido/falla lambda/falla update) y los hooks nuevos.
- [ ] `README.md` documenta el montaje del consumer en un service (archivo de 3 líneas + spread de hooks con `SQSHelper`).

## Plan de archivos

- `package.json` (edit) — dep `@janiscommerce/sqs-consumer` (para `IterativeSQSConsumer`, que el consumer extiende). NO se agrega `@janiscommerce/model` (el model se trae del service vía require dinámico) ni `sls-helper-plugin-janis` (el `SQSHelper` se inyecta por parámetro). `@janiscommerce/lambda` ya está (Invoker).
- `lib/helpers/client-model.js` (nuevo) — helper unificado: `getModel()` (require dinámico + memoize), `getSubscriptions(clientCode)` (caché 5 min → `string[] | undefined`), `updateSubscriptions(clientCode, triggersEvents)` (`model.update({ webhookSubscriptions }, { code: clientCode }, { skipAutomaticSetModifiedData: true })`). Molde: `@janiscommerce/api-session/lib/client.js`.
- `lib/trigger.js` (edit) — `send()` y `sendBatch()`: leer suscripciones vía helper, armar la key `service:entity:eventName`, decidir emitir/descartar/fail-open con logging por caso; nuevo shape de retorno para descarte (`skipped`) y `skippedCount` en el batch.
- `lib/webhook-subscriptions-consumer.js` (nuevo) — clase `WebhookSubscriptionsConsumer extends IterativeSQSConsumer`, `processSingleRecord(record, logger)`.
- `lib/subscriptions-consumer-hooks.js` (nuevo) — `subscriptionsConsumerServerlessHelperHooks(SQSHelper, opts)` → `[SQSHelper.sqsPermissions, ...SQSHelper.buildHooks({ name: 'webhookSubscriptions', sourceSnsTopic: { scope:'remote', serviceCode:'webhooks', name:'clientSubscriptionsUpdated', filterPolicy:{ services:['${self:custom.serviceCode}'] } }, consumerProperties: { prefixPath, batchSize:1, ... }, mainQueueProperties:{ maxReceiveCount:3 }, delayQueueProperties:{...}, delayConsumerProperties:{ useMainHandler:true } }), <iamStatement invoke lambda>]`.
- `lib/index.js` (edit) — exportar `WebhookSubscriptionsConsumer`, `subscriptionsConsumerServerlessHelperHooks`.
- `README.md` (edit) — sección de sincronización de suscripciones + montaje del consumer.
- `tests/**` (nuevos/edit) — espejo de todo lo anterior.

(>5 archivos + integración cross-service → developer con opus.)

## Decisiones

- **Model directo + caché propio 5 min, no api-session** (usuario 2026-07-16): en vez de `@janiscommerce/api-session` (caché fijo 10 min), un helper propio que replica el patrón de `api-session/lib/client.js` (require dinámico + memoize del model + lookup `getBy('code', ...)`) pero con TTL 5 min configurable en el package. Molde adicional: `DataLakeLoadFunction`/`ModelFetcher` de `@janiscommerce/data-lake` (mismo require dinámico, lee y escribe el ClientModel core sin session).
- **Helper unificado read+write** (usuario 2026-07-16): un solo lugar resuelve el ClientModel del service; `send()` lee (cacheado) y el consumer escribe (sin caché). Evita duplicar la resolución del model. `databaseKey: 'core'` → `new ClientModel()` sin session sirve para ambos (confirmado en el `DatabaseDispatcher`: la config core se resuelve antes del check de session).
- **Validación siempre ON + fail-open** (definición B, cerrada 2026-07-10): es el default; retrocompat 100% porque un service que actualiza sin montar el consumer nunca puebla `webhookSubscriptions` → siempre `undefined` → fail-open → emite como hoy. El pre-filtro real arranca cuando el service monta el consumer y corre el backfill. Adopción gradual entre los 9 emisores.
- **Sin fill on-demand** (Manu 2026-07-10): `undefined` → fail-open + logger, sin poblar nada. El bootstrap lo hace el backfill (paso 1).
- **Un solo consumer** (deriva del spec paso 1): las altas de cliente ya publican al mismo topic `clientSubscriptionsUpdated` (source `client-created`, estado `[]`), así que el package no necesita consumir `devops.clientCreated`.
- **Key de validación `service:entity:eventName`** (contrato paso 1): el consumer invoca la lambda con `serviceCode = JANIS_SERVICE_NAME`, así el `triggersEvents` persistido queda filtrado a este service y en ese formato; `send()` compara contra `${JANIS_SERVICE_NAME}:${entity}:${eventName}`.
- **Overwrite, no merge** (contrato paso 1): el consumer reconsolida el estado completo y sobreescribe → idempotente ante desorden/duplicados.
- **`SQSHelper` inyectado por parámetro** (patrón api-list): el package no importa `sls-helper-plugin-janis`, el service se lo pasa desde su propia versión.
- **Retorno de descarte** (usuario, a validar): `send()` descartado → `{ success: true, skipped: true }`; `sendBatch()` agrega `skippedCount` y outputs `skipped`. Campos nuevos, retrocompatibles.
- **Resiliencia MainQueue(3) → DelayQueue(5) → DLQ; alarma por infra** (propuesta original): la alarma al 1er mensaje en DLQ la declara infra, fuera del package.
- **Bump**: se decide en release (§12 del flujo). El comportamiento es retrocompatible → candidato a minor; a confirmar según se cuente la nueva dep + lectura de Mongo.

## Abiertas

—
