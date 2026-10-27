# Casa Mundial 2.0

Sitio web y API hechos con FastAPI, conectados por TLS a MySQL en Aiven. La
misma aplicación sirve la página y la API para que las credenciales de Aiven
permanezcan en el servidor.

## Requisitos

- Python 3.10 o superior.
- Un servicio MySQL activo en Aiven.
- La base de datos configurada con las tablas y la vista que espera
  `..\casa_mundial_completo.sql`.

> **Cuidado con el SQL de ejemplo:** `casa_mundial_completo.sql` ejecuta
> `DROP DATABASE IF EXISTS casa_mundial` y borra todos los datos de esa base.
> Úsalo solamente para crear o reiniciar una base de pruebas vacía. No lo
> importes sobre una base de producción o con datos que quieras conservar.

El esquema administra inmuebles en alquiler. Los controles de compra y
proyectos nuevos no mostrarán resultados hasta que el modelo de datos incluya
esas operaciones.

## Configuración de Aiven

1. En Aiven Console, abre el servicio MySQL y copia host, puerto, usuario y
   contraseña desde **Connection information**.
2. Descarga el certificado CA del servicio y guárdalo como `ca.pem` en esta
   carpeta. No lo publiques ni lo agregues al repositorio.
3. Configura la base `casa_mundial` en Aiven. Si vas a usar el script SQL, sigue
   la advertencia anterior: este elimina y vuelve a crear la base completa.
4. Copia `.env.example` como `.env` y completa los valores reales. Genera un
   `JWT_SECRET` aleatorio de al menos 32 bytes. Nunca uses `CHANGE_ME`.

Los usuarios demo del SQL tienen contraseñas de marcador, no hashes válidos.
Registra una cuenta desde el sitio para probar el inicio de sesión.

## Ejecutar desde VS Code en Windows

1. En VS Code selecciona **File > Open Folder...** y abre exactamente la
   carpeta `CasaMundial 2.0` (la que contiene `main.py`).
2. Instala las extensiones recomendadas **Python** y **Python Debugger** si
   VS Code lo solicita.
3. Abre `main.py` y pulsa **F5**. La primera vez VS Code crea `.venv`, instala
   `requirements.txt` y ejecuta FastAPI en la terminal integrada. En VS Code
   también puedes abrir **Terminal > Run Task...** y seleccionar
   **Casa Mundial: iniciar API**.
4. Abre `http://127.0.0.1:3000`. Detén el servidor con **Ctrl+C** en la
   terminal integrada.

El proyecto selecciona `.venv\Scripts\python.exe` como intérprete. Si VS Code
ya tenía otro intérprete seleccionado, pulsa `Ctrl+Shift+P`, elige **Python:
Select Interpreter** y selecciona `.venv\Scripts\python.exe`.

## Instalar y ejecutar manualmente en Windows

En PowerShell, desde esta carpeta:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
# Edita .env con los datos del servicio Aiven.
python main.py
```

También puedes iniciar `main.py` con Python global: el archivo detecta y usa
automáticamente `.venv\Scripts\python.exe` si ese entorno ya está creado.

Al iniciar, la terminal muestra el enlace directo al panel CRUD local.
La aplicación queda en `http://127.0.0.1:3000`. Comprueba la conexión en
`http://127.0.0.1:3000/api/health`; debe responder
`{"estado":"ok","baseDeDatos":"conectada"}`. La documentación interactiva de
FastAPI está en `http://127.0.0.1:3000/docs`.

Cuando Aiven esté conectado, la página principal mostrará **Administrar base**.
El panel también se puede abrir en `http://127.0.0.1:3000/admin`: lista las
tablas y vistas, permite consultar registros y crear, editar o borrar filas de
tablas. Las vistas son de solo lectura y los cambios respetan las claves
foráneas y restricciones de MySQL. Columnas sensibles como `password_hash` no
se muestran ni se pueden modificar desde el panel.

El panel solo acepta conexiones locales (`localhost`, `127.0.0.1` o `::1`);
no es un panel remoto ni debe exponerse mediante un proxy público. Las
eliminaciones son definitivas y pueden estar bloqueadas si otras filas
dependen del registro.

## Publicar en Render

El archivo `render.yaml` configura un servicio web de Python. La aplicación
sirve en el mismo dominio el sitio, la API y las publicaciones; no despliegues
`index.html` como un sitio estático separado.

1. Sube a un repositorio de GitHub los archivos de esta carpeta, incluido
   `render.yaml`. Si el repositorio contiene otras carpetas, al crear el
   servicio selecciona esta carpeta como raíz de Blueprint y de la aplicación.
2. En Render, crea un **Blueprint** y conecta ese repositorio. Revisa la
   configuración de `render.yaml` y crea el servicio `casa-mundial`.
3. En **Environment**, completa `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`
   y `DB_NAME` con los datos de **Connection information** de Aiven. Render
   genera `JWT_SECRET`; conserva su valor como secreto y no lo compartas.
   `ENVIRONMENT`, `HOST` y `DB_SSL_CA` ya se configuran en el Blueprint.
4. En **Environment > Secret Files**, añade el certificado CA descargado de
   Aiven como `aiven-ca.pem`. El Blueprint configura `DB_SSL_CA` como
   `/etc/secrets/aiven-ca.pem`. No subas el certificado al repositorio.
5. En Aiven, permite las conexiones entrantes desde los rangos de salida de
   Render para la región del servicio. En Render, abre el servicio y copia los
   rangos CIDR de **Connect > Outbound** a la lista permitida de Aiven. Mantén
   TLS habilitado y no abras MySQL a todas las direcciones (`0.0.0.0/0`).
6. Espera a que el despliegue termine y comprueba la URL `onrender.com` que
   Render asignó. `/api/health` debe devolver
   `{"estado":"ok","baseDeDatos":"conectada"}`. Registra una cuenta de
   propietario y prueba enviar una casa; debe quedar como `pendiente`.

El plan gratuito puede suspender el servicio tras un periodo sin visitas, por
lo que la primera carga puede tardar. Para mantenerlo siempre activo, selecciona
un plan de pago en Render. El panel CRUD `/admin` se deshabilita en producción:
administra la base únicamente desde la aplicación local. El sitio público, el
registro, el inicio de sesión, el contacto y el envío de propiedades siguen
disponibles en Render.

### Publicar una casa en alquiler

1. Crea una cuenta como propietario o inicia sesión con una cuenta de propietario.
2. En la página principal, selecciona **Publicar una casa** y completa el
   formulario. Los datos se guardan en la tabla `inmuebles` de Aiven y quedan
   asociados a la cuenta que los envió.
3. Las casas nuevas quedan con estado `pendiente` y no se muestran al público.
   Revisa el registro en el panel local `/admin`; cuando la publicación esté
   aprobada, cambia su campo `estado` a `disponible`. La vista pública mostrará
   entonces la casa.

### Si la API no conecta

- La API y `/docs` arrancan aunque Aiven no esté configurado. En ese caso
  `/api/health` y las operaciones de base de datos responden `503` con un
  mensaje que indica qué configuración revisar. `/api/health` comprueba tanto
  la conexión como la vista requerida por la API.
- Confirma que `.env` esté junto a `main.py`, tenga los datos de conexión del
  servicio MySQL de Aiven y que `DB_SSL_CA=ca.pem` apunte al certificado CA
  descargado en esa misma carpeta. No uses los valores de ejemplo.
- Revisa en Aiven que el servicio esté encendido y que permita la conexión
  entrante desde tu dirección IP.
- Si indica que falta `v_inmuebles_disponibles`, el esquema de tablas puede
  estar creado sin esa vista. Ejecuta solo la sección **“6. VISTA PARA LA
  PÁGINA WEB”** de `..\casa_mundial_completo.sql` en la base correcta; no
  vuelvas a importar el archivo completo en una base con datos, porque empieza
  borrándola.
- Si `/api/health` indica tiempo de espera del puerto MySQL, compara `DB_PORT`
  con el puerto exacto de **Connection information** y agrega tu IP pública a
  **Networking / IP address allowlist** del servicio. No abras el acceso a
  todas las IP (`0.0.0.0/0`) para una base de datos de producción.
- Inicia el sitio con `python main.py` y abre `http://127.0.0.1:3000`; abrir
  `index.html` directamente o con otro servidor estático no inicia la API.

## API

- `GET /api/health`: comprueba la conexión con MySQL.
- `GET /api/propiedades`: inmuebles disponibles desde
  `v_inmuebles_disponibles`.
- `GET /api/publicaciones/opciones` y `POST /api/publicaciones`: opciones del
  formulario y envío de casas en alquiler para revisión por un propietario
  autenticado.
- `POST /api/contacto`: guarda solicitudes en `mensajes_contacto`.
- `POST /api/auth/register` y `POST /api/auth/login`: registro y acceso de
  inquilinos y propietarios, con contraseñas bcrypt y cookie `HttpOnly`.
- `GET /api/auth/me` y `POST /api/auth/logout`: consulta y cierre de sesión.

En producción, instala las dependencias con `pip install -r requirements.txt`,
configura las variables de entorno y el certificado CA en el servidor, y
establece `HOST=0.0.0.0`, `PORT` según el puerto del proveedor y
`ENVIRONMENT=production` para activar cookies seguras. Ejecuta `python main.py`.
Aiven debe permitir conexiones entrantes desde el servidor donde se ejecuta
FastAPI.
