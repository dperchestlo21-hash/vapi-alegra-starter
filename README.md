
# Vapi ↔ Alegra (Starter)

Middleware listo para conectar tu agente de voz (Vapi) con tu cuenta de Alegra.

## 0) Requisitos
- Node.js LTS instalado (https://nodejs.org)
- Token y correo de Alegra

## 1) Descarga e instala
```bash
npm install
```
> Ejecuta este comando dentro de la carpeta del proyecto.

## 2) Configura variables de entorno
Copia `.env.example` a `.env` y pon tus datos reales:
```
ALEGRA_EMAIL=tu-correo@dominio.com
ALEGRA_TOKEN=TU_TOKEN
PORT=3000
```

## 3) Ejecuta en local
```bash
npm start
```
Verás: `Servidor listo en http://localhost:3000`

## 4) Prueba con curl o Postman
- Buscar SKU:
```bash
curl -X POST http://localhost:3000/api/alegra/itemBySKU   -H "Content-Type: application/json"   -d "{"sku":"0445120232"}"
```

- Cliente por teléfono:
```bash
curl -X POST http://localhost:3000/api/alegra/customerByPhone   -H "Content-Type: application/json"   -d "{"phone":"8181234567"}"
```

- Precio según lista:
```bash
curl -X POST http://localhost:3000/api/alegra/priceForCustomer   -H "Content-Type: application/json"   -d "{"sku":"0445120232","priceListId":1}"
```

- Crear factura (ejemplo):
```bash
curl -X POST http://localhost:3000/api/alegra/createInvoice   -H "Content-Type: application/json"   -d "{"clientId":123,"items":[{"sku":"0445120232","quantity":1,"price":5000}],"observations":"Pedido telefónico"}"
```

## 5) Desplegar a Internet (Render)
1. Sube esta carpeta a un repositorio en GitHub.
2. Crea una cuenta en https://render.com e inicia sesión.
3. `New +` → **Web Service** → Conecta tu repo.
4. *Build Command*: `npm install`
5. *Start Command*: `npm start`
6. Variables de entorno: agrega `ALEGRA_EMAIL`, `ALEGRA_TOKEN` y `PORT` (opcional).
7. Al crear el servicio, Render te dará una **URL pública** (por ej. `https://tu-app.onrender.com`).

## 6) Configurar acciones en Vapi
Ejemplo (HTTP POST) para **get_item_by_sku**:

```json
{
  "name": "get_item_by_sku",
  "description": "Devuelve stock y precio base de un SKU en Alegra",
  "type": "http",
  "method": "POST",
  "url": "https://TU-DOMINIO.com/api/alegra/itemBySKU",
  "input_schema": {
    "type": "object",
    "properties": {
      "sku": { "type": "string", "description": "SKU o referencia del producto" }
    },
    "required": ["sku"]
  }
}
```

Repite para:
- `get_customer_by_phone` → `POST /api/alegra/customerByPhone` (body: `{ "phone": "..." }`)
- `get_price_for_customer` → `POST /api/alegra/priceForCustomer` (body: `{ "sku": "...", "priceListId": 1 }`)
- `create_invoice` → `POST /api/alegra/createInvoice`

## 7) Consejos
- Normaliza teléfonos a E.164 (+52...) para mejores aciertos.
- Cachea respuestas de SKUs populares 30–60s si lo necesitas.
- Protege tus endpoints con una API key propia o restringe IPs.
