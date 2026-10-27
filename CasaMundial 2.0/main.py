from __future__ import annotations

import subprocess
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
PROJECT_VENV = BASE_DIR / ".venv"
PROJECT_PYTHON = PROJECT_VENV / "Scripts" / "python.exe"


def use_project_interpreter() -> None:
    if sys.platform != "win32" or Path(sys.prefix).resolve() == PROJECT_VENV.resolve():
        return

    if not PROJECT_PYTHON.is_file():
        print(
            "No existe el entorno virtual del proyecto. En VS Code ejecuta "
            "'Casa Mundial: preparar entorno Python' desde Terminal > Run Task.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    print("Usando el entorno Python del proyecto (.venv)...", flush=True)
    result = subprocess.run(
        [str(PROJECT_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]],
        cwd=BASE_DIR,
        check=False,
    )
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    use_project_interpreter()

import logging
import os
import re
from contextlib import asynccontextmanager
import ipaddress
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Literal

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy import MetaData, Table, and_, func, inspect, select, text
from sqlalchemy.engine import Engine, URL, create_engine
from sqlalchemy.exc import IntegrityError, SQLAlchemyError


load_dotenv(BASE_DIR / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("casa_mundial")

TOKEN_COOKIE = "casa_mundial_token"
TOKEN_LIFETIME_SECONDS = 60 * 60 * 12
INTERESES_PERMITIDOS = {"comprar", "arrendar", "vender", "asesoria"}
BCRYPT_HASH_PATTERN = re.compile(r"^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$")
IMAGEN_POR_DEFECTO = (
    "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d"
    "?auto=format&fit=crop&w=900&q=80"
)


def required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise RuntimeError(f"Falta configurar la variable {name}.")
    return value


def create_database_engine() -> Engine:
    jwt_secret = required_env("JWT_SECRET")
    if len(jwt_secret.encode("utf-8")) < 32:
        raise RuntimeError("JWT_SECRET debe tener al menos 32 bytes.")

    try:
        port = int(required_env("DB_PORT"))
    except ValueError as error:
        raise RuntimeError("DB_PORT debe ser un número de puerto válido.") from error

    if not 1 <= port <= 65535:
        raise RuntimeError("DB_PORT debe estar entre 1 y 65535.")

    ca_path = (BASE_DIR / required_env("DB_SSL_CA")).resolve()
    if not ca_path.is_file():
        raise RuntimeError(f"No se encontró el certificado CA de Aiven: {ca_path}")

    url = URL.create(
        drivername="mysql+pymysql",
        username=required_env("DB_USER"),
        password=required_env("DB_PASSWORD"),
        host=required_env("DB_HOST"),
        port=port,
        database=required_env("DB_NAME"),
        query={"charset": "utf8mb4"},
    )

    return create_engine(
        url,
        pool_pre_ping=True,
        pool_recycle=1800,
        pool_size=5,
        max_overflow=5,
        connect_args={
            "ssl": {
                "ca": str(ca_path),
                "check_hostname": True,
            },
            "connect_timeout": 10,
        },
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine: Engine | None = None
    app.state.db = None
    app.state.db_error = None

    try:
        engine = create_database_engine()
    except (RuntimeError, OSError, SQLAlchemyError) as error:
        app.state.db_error = error
        logger.exception("No se pudo configurar la conexión con Aiven.")

    app.state.db = engine
    if engine is not None:
        try:
            with engine.connect() as connection:
                connection.execute(
                    text("SELECT id_inmueble FROM v_inmuebles_disponibles LIMIT 0")
                )
            logger.info("Conexión TLS con MySQL en Aiven y esquema API verificados.")
        except SQLAlchemyError as error:
            app.state.db_error = error
            logger.exception(
                "No se pudo verificar Aiven o la vista de propiedades al iniciar; "
                "la API seguirá disponible para informar el estado en /api/health."
            )

    if os.getenv("ENVIRONMENT", "development").lower() == "production":
        logger.info("Panel CRUD local deshabilitado en producción.")
    else:
        logger.info(
            "Panel CRUD local: http://127.0.0.1:%s/admin",
            os.getenv("PORT", "3000"),
        )

    yield
    if engine is not None:
        engine.dispose()


limiter = Limiter(key_func=get_remote_address, default_limits=[])
app = FastAPI(
    title="Casa Mundial API",
    description="API inmobiliaria conectada a MySQL en Aiven.",
    version="1.0.0",
    lifespan=lifespan,
)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_error_handler(_request: Request, _error: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"error": "Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo."},
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_request: Request, error: StarletteHTTPException):
    message = error.detail if isinstance(error.detail, str) else "Solicitud no válida."
    return JSONResponse(
        status_code=error.status_code,
        content={"error": message},
        headers=error.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, _error: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"error": "Revisa los datos enviados."},
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
        "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; "
        "img-src 'self' data: https://images.unsplash.com; "
        "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    )
    return response


@app.exception_handler(SQLAlchemyError)
async def database_error_handler(_request: Request, error: SQLAlchemyError):
    logger.exception("Error al consultar MySQL en Aiven.", exc_info=error)
    return JSONResponse(
        status_code=503,
        content={"error": database_error_hint(error)},
    )


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RegistroInput(APIModel):
    nombre: str = Field(min_length=3, max_length=121)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    rol: Literal["inquilino", "propietario"]

    @field_validator("password")
    @classmethod
    def validar_bytes_password(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("La contraseña no puede superar 72 bytes.")
        return value


class LoginInput(APIModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)
    rol: Literal["inquilino", "propietario"]

    @field_validator("password")
    @classmethod
    def validar_bytes_password(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("La contraseña no puede superar 72 bytes.")
        return value


class ContactoInput(APIModel):
    nombre: str = Field(min_length=1, max_length=100)
    email: EmailStr
    telefono: str | None = Field(default=None, max_length=20)
    interes: Literal["comprar", "arrendar", "vender", "asesoria"]
    mensaje: str | None = Field(default=None, max_length=2000)


class PublicacionInmuebleInput(APIModel):
    id_tipo: int = Field(gt=0, le=255)
    id_barrio: int = Field(gt=0)
    titulo: str = Field(min_length=8, max_length=150)
    descripcion: str | None = Field(default=None, max_length=4000)
    direccion: str = Field(min_length=5, max_length=150)
    canon_mensual: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    deposito: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)
    habitaciones: int = Field(ge=0, le=255)
    banos: int = Field(ge=1, le=255)
    area_m2: Decimal = Field(gt=0, max_digits=8, decimal_places=2)


class AdminCreateRow(APIModel):
    values: dict[str, Any]


class AdminUpdateRow(APIModel):
    pk: dict[str, Any]
    values: dict[str, Any]


class AdminDeleteRow(APIModel):
    pk: dict[str, Any]


def engine_for(request: Request) -> Engine:
    engine = request.app.state.db
    if engine is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Aiven no está configurado. Revisa las variables de .env "
                "y el certificado CA indicado en README.md."
            ),
        )
    return engine


def require_local_admin(request: Request) -> None:
    if os.getenv("ENVIRONMENT", "development").lower() == "production":
        raise HTTPException(status_code=404, detail="No encontrado.")

    client = request.client
    if client is None:
        raise HTTPException(status_code=403, detail="El panel solo está disponible localmente.")

    try:
        if not ipaddress.ip_address(client.host).is_loopback:
            raise HTTPException(
                status_code=403,
                detail="El panel de administración solo acepta conexiones locales.",
            )
    except ValueError:
        raise HTTPException(
            status_code=403,
            detail="No se pudo verificar que la conexión sea local.",
        ) from None

    hostname = (request.url.hostname or "").lower()
    if hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise HTTPException(
            status_code=403,
            detail="Abre el panel usando http://127.0.0.1:3000/admin.",
        )


def admin_table(request: Request, table_name: str) -> tuple[Engine, Table, bool]:
    require_local_admin(request)
    engine = engine_for(request)
    inspector = inspect(engine)
    if table_name in inspector.get_table_names():
        is_view = False
    elif table_name in inspector.get_view_names():
        is_view = True
    else:
        raise HTTPException(status_code=404, detail="No existe esa tabla en la base activa.")

    reflected = Table(table_name, MetaData(), autoload_with=engine)
    return engine, reflected, is_view


def admin_columns(table: Table) -> list[dict[str, Any]]:
    result = []
    for column in table.columns:
        if column.name.lower() in {"password_hash", "password", "token", "secret"}:
            continue
        result.append({
            "name": column.name,
            "type": str(column.type),
            "nullable": column.nullable,
            "primary_key": column.primary_key,
            "auto_increment": bool(column.autoincrement is True),
            "has_default": column.default is not None or column.server_default is not None,
            "editable": not column.primary_key and column.autoincrement is not True,
        })
    return result


def json_database_value(value: Any) -> Any:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def admin_row_values(row: Any, table: Table) -> dict[str, Any]:
    hidden = {"password_hash", "password", "token", "secret"}
    return {
        column.name: json_database_value(row[column.name])
        for column in table.columns
        if column.name.lower() not in hidden
    }


def admin_primary_key(table: Table, supplied: dict[str, Any]) -> Any:
    primary_key = list(table.primary_key.columns)
    expected_names = {column.name for column in primary_key}
    if not expected_names or set(supplied) != expected_names:
        raise HTTPException(
            status_code=400,
            detail="Envía todos los campos de la clave primaria de la fila.",
        )
    return and_(*(column == supplied[column.name] for column in primary_key))


def validate_admin_values(table: Table, values: dict[str, Any], *, updating: bool) -> dict[str, Any]:
    columns = {column.name: column for column in table.columns}
    hidden = {"password_hash", "password", "token", "secret"}
    unknown = set(values) - columns.keys()
    forbidden = set(values) & hidden
    primary_key = {column.name for column in table.primary_key.columns}

    if unknown or forbidden:
        invalid = sorted(unknown | forbidden)
        raise HTTPException(
            status_code=400,
            detail=f"No se pueden modificar estas columnas: {', '.join(invalid)}.",
        )
    if updating and not values:
        raise HTTPException(status_code=400, detail="Indica al menos un campo para actualizar.")
    if updating and set(values) & primary_key:
        raise HTTPException(
            status_code=400,
            detail="No se permite cambiar la clave primaria de una fila.",
        )
    if not updating:
        generated = {
            column.name for column in table.columns
            if column.autoincrement is True
        }
        values = {name: value for name, value in values.items() if name not in generated}
    return values


def database_error_hint(error: Exception) -> str:
    messages = []
    current: BaseException | None = error

    for _ in range(6):
        if current is None:
            break
        messages.append(str(current).lower())
        current = (
            getattr(current, "orig", None)
            or current.__cause__
            or current.__context__
        )

    details = " ".join(messages)
    if "doesn't exist" in details or "does not exist" in details:
        return (
            "Falta una tabla o vista del esquema en DB_NAME; importa el esquema "
            "casa_mundial_completo.sql en esa base."
        )
    if "unknown database" in details:
        return "DB_NAME no existe en Aiven; revisa el nombre de la base."
    if "access denied" in details or "authentication" in details:
        return "Aiven rechazó las credenciales; revisa DB_USER y DB_PASSWORD."
    if "certificate verify failed" in details or "ssl" in details or "tls" in details:
        return "Falló TLS; revisa DB_SSL_CA y el certificado CA de Aiven."
    if any(term in details for term in ("timed out", "timeout", "can't connect to mysql server")):
        return "No se alcanza el puerto MySQL; revisa DB_PORT y la lista de IPs permitidas en Aiven."
    if "name or service not known" in details or "getaddrinfo failed" in details:
        return "No se resuelve el host; revisa DB_HOST en la información de conexión de Aiven."
    return "Revisa las credenciales, el estado del servicio y la lista de acceso de red de Aiven."


def jwt_secret() -> str:
    return required_env("JWT_SECRET")


def set_session_cookie(response: Response, user_id: int, role: str) -> None:
    token = jwt.encode(
        {"sub": str(user_id), "role": role},
        jwt_secret(),
        algorithm="HS256",
    )
    response.set_cookie(
        key=TOKEN_COOKIE,
        value=token,
        max_age=TOKEN_LIFETIME_SECONDS,
        httponly=True,
        secure=os.getenv("ENVIRONMENT", "development").lower() == "production",
        samesite="strict",
        path="/api",
    )


def session_user(request: Request) -> dict:
    token = request.cookies.get(TOKEN_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="No hay una sesión iniciada.")

    try:
        claims = jwt.decode(token, jwt_secret(), algorithms=["HS256"])
        user_id = int(claims["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=401,
            detail="La sesión expiró o no es válida. Inicia sesión de nuevo.",
        ) from None

    query = text(
        """
        SELECT u.id_usuario, CONCAT(u.nombre, ' ', u.apellido) AS nombre_completo,
               u.email, r.nombre AS rol
        FROM usuarios u
        JOIN roles r ON r.id_rol = u.id_rol
        WHERE u.id_usuario = :user_id AND u.activo = 1
        LIMIT 1
        """
    )
    with engine_for(request).connect() as connection:
        user = connection.execute(query, {"user_id": user_id}).mappings().first()

    if user is None:
        raise HTTPException(status_code=401, detail="La cuenta ya no está disponible.")
    return dict(user)


def public_user(user: dict) -> dict:
    return {
        "nombre": user["nombre_completo"],
        "email": user["email"],
        "rol": user["rol"],
    }


@app.get("/api/health")
def health(request: Request):
    if request.app.state.db is None:
        return JSONResponse(
            status_code=503,
            content={
                "estado": "error",
                "baseDeDatos": "no configurada",
                "error": (
                    "Revisa las variables de .env y el certificado CA indicado "
                    "en README.md."
                ),
            },
        )

    try:
        with engine_for(request).connect() as connection:
            connection.execute(
                text("SELECT id_inmueble FROM v_inmuebles_disponibles LIMIT 0")
            )
    except SQLAlchemyError as error:
        logger.exception("La comprobación de conexión con Aiven falló.")
        request.app.state.db_error = error
        return JSONResponse(
            status_code=503,
            content={
                "estado": "error",
                "baseDeDatos": "esquema incompleto o no disponible",
                "error": database_error_hint(error),
            },
        )
    request.app.state.db_error = None
    return {"estado": "ok", "baseDeDatos": "conectada"}


@app.get("/api/propiedades")
def propiedades(request: Request):
    query = text(
        """
        SELECT id_inmueble AS id, titulo, etiqueta, tipo, ciudad, barrio,
               CAST(canon_mensual AS DOUBLE) AS canon_mensual,
               habitaciones, banos, CAST(area_m2 AS DOUBLE) AS area_m2,
               imagen_principal
        FROM v_inmuebles_disponibles
        ORDER BY id DESC
        """
    )
    with engine_for(request).connect() as connection:
        rows = connection.execute(query).mappings().all()

    result = []
    for row in rows:
        property_data = dict(row)
        property_data["imagen_principal"] = (
            property_data["imagen_principal"] or IMAGEN_POR_DEFECTO
        )
        result.append(property_data)
    return {"propiedades": result}


@app.get("/api/publicaciones/opciones")
def listing_options(request: Request):
    with engine_for(request).connect() as connection:
        types = connection.execute(
            text(
                """
                SELECT id_tipo, nombre
                FROM tipos_inmueble
                WHERE nombre LIKE 'Casa%'
                ORDER BY nombre
                """
            )
        ).mappings().all()
        neighborhoods = connection.execute(
            text(
                """
                SELECT b.id_barrio, b.nombre AS barrio, c.nombre AS ciudad
                FROM barrios b
                JOIN ciudades c ON c.id_ciudad = b.id_ciudad
                ORDER BY c.nombre, b.nombre
                """
            )
        ).mappings().all()

    return {
        "tipos": [dict(row) for row in types],
        "barrios": [dict(row) for row in neighborhoods],
    }


@app.post("/api/publicaciones", status_code=201)
@limiter.limit("5/15minutes")
def create_listing(request: Request, payload: PublicacionInmuebleInput):
    user = session_user(request)
    if user["rol"].casefold() != "propietario":
        raise HTTPException(
            status_code=403,
            detail="Inicia sesión con una cuenta de propietario para publicar una casa.",
        )

    engine = engine_for(request)
    try:
        with engine.begin() as connection:
            property_type = connection.execute(
                text(
                    """
                    SELECT id_tipo
                    FROM tipos_inmueble
                    WHERE id_tipo = :id_tipo AND nombre LIKE 'Casa%'
                    LIMIT 1
                    """
                ),
                {"id_tipo": payload.id_tipo},
            ).scalar_one_or_none()
            if property_type is None:
                raise HTTPException(status_code=400, detail="Selecciona un tipo de casa válido.")

            neighborhood = connection.execute(
                text("SELECT id_barrio FROM barrios WHERE id_barrio = :id_barrio"),
                {"id_barrio": payload.id_barrio},
            ).scalar_one_or_none()
            if neighborhood is None:
                raise HTTPException(status_code=400, detail="Selecciona un barrio válido.")

            result = connection.execute(
                text(
                    """
                    INSERT INTO inmuebles (
                        id_propietario, id_tipo, id_barrio, titulo, descripcion,
                        direccion, canon_mensual, deposito, habitaciones, banos,
                        area_m2, etiqueta, estado
                    )
                    VALUES (
                        :id_propietario, :id_tipo, :id_barrio, :titulo, :descripcion,
                        :direccion, :canon_mensual, :deposito, :habitaciones, :banos,
                        :area_m2, 'Nuevo', 'pendiente'
                    )
                    """
                ),
                {
                    "id_propietario": user["id_usuario"],
                    "id_tipo": payload.id_tipo,
                    "id_barrio": payload.id_barrio,
                    "titulo": payload.titulo,
                    "descripcion": payload.descripcion or None,
                    "direccion": payload.direccion,
                    "canon_mensual": str(payload.canon_mensual),
                    "deposito": str(payload.deposito),
                    "habitaciones": payload.habitaciones,
                    "banos": payload.banos,
                    "area_m2": str(payload.area_m2),
                },
            )
    except IntegrityError as error:
        raise HTTPException(
            status_code=409,
            detail="No se pudo guardar la publicación. Revisa los datos e inténtalo de nuevo.",
        ) from error

    return {
        "mensaje": "La casa se guardó en Aiven y quedó pendiente de revisión.",
        "id_inmueble": result.lastrowid,
        "estado": "pendiente",
    }


@app.get("/api/admin/tables")
def admin_tables(request: Request):
    require_local_admin(request)
    engine = engine_for(request)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    views = set(inspector.get_view_names())
    objects = [
        {"name": name, "type": "view" if name in views else "table"}
        for name in sorted(tables | views)
    ]
    return {"database": engine.url.database, "objects": objects}


@app.get("/api/admin/tables/{table_name}")
def admin_table_rows(
    request: Request,
    table_name: str,
    offset: int = 0,
    limit: int = Query(default=50, ge=1, le=100),
):
    engine, table, is_view = admin_table(request, table_name)
    primary_key = [column.name for column in table.primary_key.columns]
    query = select(table).limit(limit).offset(offset)
    if primary_key:
        query = query.order_by(*table.primary_key.columns)

    with engine.connect() as connection:
        rows = connection.execute(query).mappings().all()
        count = connection.execute(select(func.count()).select_from(table)).scalar_one()

    return {
        "name": table_name,
        "type": "view" if is_view else "table",
        "read_only": is_view or not primary_key,
        "primary_key": primary_key,
        "columns": admin_columns(table),
        "rows": [admin_row_values(row, table) for row in rows],
        "total": count,
        "offset": offset,
        "limit": limit,
    }


@app.post("/api/admin/tables/{table_name}/rows", status_code=201)
def admin_create_row(request: Request, table_name: str, payload: AdminCreateRow):
    engine, table, is_view = admin_table(request, table_name)
    if is_view or not table.primary_key.columns:
        raise HTTPException(status_code=405, detail="Este objeto es de solo lectura.")

    values = validate_admin_values(table, payload.values, updating=False)
    try:
        with engine.begin() as connection:
            result = connection.execute(table.insert().values(**values))
            primary_key = list(table.primary_key.columns)
            inserted = dict(zip(
                (column.name for column in primary_key),
                result.inserted_primary_key or (),
            ))
            if inserted:
                row = connection.execute(
                    select(table).where(admin_primary_key(table, inserted))
                ).mappings().first()
            else:
                row = None
    except IntegrityError as error:
        raise HTTPException(
            status_code=409,
            detail="No se pudo insertar: revisa campos obligatorios, valores únicos y relaciones.",
        ) from error

    return {
        "mensaje": "Registro creado.",
        "row": admin_row_values(row, table) if row is not None else None,
    }


@app.put("/api/admin/tables/{table_name}/rows")
def admin_update_row(request: Request, table_name: str, payload: AdminUpdateRow):
    engine, table, is_view = admin_table(request, table_name)
    if is_view or not table.primary_key.columns:
        raise HTTPException(status_code=405, detail="Este objeto es de solo lectura.")

    condition = admin_primary_key(table, payload.pk)
    values = validate_admin_values(table, payload.values, updating=True)
    try:
        with engine.begin() as connection:
            result = connection.execute(table.update().where(condition).values(**values))
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="No se encontró la fila solicitada.")
            row = connection.execute(
                select(table).where(condition)
            ).mappings().first()
    except IntegrityError as error:
        raise HTTPException(
            status_code=409,
            detail="No se pudo actualizar: revisa campos obligatorios, valores únicos y relaciones.",
        ) from error

    return {"mensaje": "Registro actualizado.", "row": admin_row_values(row, table)}


@app.delete("/api/admin/tables/{table_name}/rows")
def admin_delete_row(request: Request, table_name: str, payload: AdminDeleteRow):
    engine, table, is_view = admin_table(request, table_name)
    if is_view or not table.primary_key.columns:
        raise HTTPException(status_code=405, detail="Este objeto es de solo lectura.")

    condition = admin_primary_key(table, payload.pk)
    try:
        with engine.begin() as connection:
            result = connection.execute(table.delete().where(condition))
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="No se encontró la fila solicitada.")
    except IntegrityError as error:
        raise HTTPException(
            status_code=409,
            detail="No se puede borrar: otros registros dependen de esta fila.",
        ) from error

    return {"mensaje": "Registro eliminado."}


@app.post("/api/contacto", status_code=201)
@limiter.limit("5/15minutes")
def create_contact(request: Request, payload: ContactoInput):
    interest = payload.interes
    if interest not in INTERESES_PERMITIDOS:
        raise HTTPException(status_code=400, detail="Selecciona un motivo válido.")

    query = text(
        """
        INSERT INTO mensajes_contacto (nombre, email, telefono, interes, mensaje)
        VALUES (:nombre, :email, :telefono, :interes, :mensaje)
        """
    )
    values = {
        "nombre": payload.nombre,
        "email": str(payload.email).lower(),
        "telefono": payload.telefono or None,
        "interes": interest,
        "mensaje": payload.mensaje or None,
    }
    with engine_for(request).begin() as connection:
        connection.execute(query, values)
    return {"mensaje": "Solicitud guardada correctamente."}


@app.post("/api/auth/register")
@limiter.limit("10/15minutes")
def register(request: Request, payload: RegistroInput, response: Response):
    parts = payload.nombre.split()
    first_name = parts[0]
    last_name = " ".join(parts[1:])
    if len(first_name) > 60 or not last_name or len(last_name) > 60:
        raise HTTPException(
            status_code=400,
            detail="Escribe nombre y apellido (máximo 60 caracteres cada uno).",
        )

    role_query = text("SELECT id_rol FROM roles WHERE nombre = :role LIMIT 1")
    insert_query = text(
        """
        INSERT INTO usuarios (id_rol, nombre, apellido, email, password_hash)
        VALUES (:role_id, :first_name, :last_name, :email, :password_hash)
        """
    )
    password_hash = bcrypt.hashpw(
        payload.password.encode("utf-8"),
        bcrypt.gensalt(rounds=12),
    ).decode("ascii")
    email = str(payload.email).lower()

    try:
        with engine_for(request).begin() as connection:
            role_id = connection.execute(
                role_query,
                {"role": payload.rol},
            ).scalar_one_or_none()
            if role_id is None:
                raise HTTPException(
                    status_code=500,
                    detail="El rol no está configurado en la base de datos.",
                )
            result = connection.execute(
                insert_query,
                {
                    "role_id": role_id,
                    "first_name": first_name,
                    "last_name": last_name,
                    "email": email,
                    "password_hash": password_hash,
                },
            )
            user_id = result.lastrowid
    except SQLAlchemyError as error:
        if getattr(getattr(error, "orig", None), "args", [None])[0] == 1062:
            raise HTTPException(
                status_code=409,
                detail="Ya existe una cuenta con ese correo.",
            ) from None
        raise

    set_session_cookie(response, int(user_id), payload.rol)
    return {
        "usuario": {
            "nombre": f"{first_name} {last_name}",
            "email": email,
            "rol": payload.rol,
        }
    }


@app.post("/api/auth/login")
@limiter.limit("10/15minutes")
def login(request: Request, payload: LoginInput, response: Response):
    query = text(
        """
        SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.password_hash,
               r.nombre AS rol
        FROM usuarios u
        JOIN roles r ON r.id_rol = u.id_rol
        WHERE u.email = :email AND u.activo = 1
        LIMIT 1
        """
    )
    with engine_for(request).connect() as connection:
        user = connection.execute(
            query,
            {"email": str(payload.email).lower()},
        ).mappings().first()

    valid_hash = user is not None and user["password_hash"] is not None
    if valid_hash:
        valid_hash = bool(BCRYPT_HASH_PATTERN.fullmatch(user["password_hash"]))
    password_matches = False
    if valid_hash and user["rol"] == payload.rol:
        password_matches = bcrypt.checkpw(
            payload.password.encode("utf-8"),
            user["password_hash"].encode("ascii"),
        )

    if not password_matches:
        raise HTTPException(
            status_code=401,
            detail="Correo, contraseña o tipo de cuenta incorrectos.",
        )

    set_session_cookie(response, int(user["id_usuario"]), user["rol"])
    return {
        "usuario": {
            "nombre": f"{user['nombre']} {user['apellido']}",
            "email": user["email"],
            "rol": user["rol"],
        }
    }


@app.get("/api/auth/me")
def current_session(request: Request):
    return {"usuario": public_user(session_user(request))}


@app.post("/api/auth/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(
        key=TOKEN_COOKIE,
        httponly=True,
        secure=os.getenv("ENVIRONMENT", "development").lower() == "production",
        samesite="strict",
        path="/api",
    )


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/styles.css", include_in_schema=False)
def styles():
    return FileResponse(BASE_DIR / "styles.css", media_type="text/css")


@app.get("/main.js", include_in_schema=False)
def javascript():
    return FileResponse(BASE_DIR / "main.js", media_type="text/javascript")


@app.get("/admin", include_in_schema=False)
def admin_page(request: Request):
    require_local_admin(request)
    return FileResponse(BASE_DIR / "admin.html")


@app.get("/admin.css", include_in_schema=False)
def admin_styles(request: Request):
    require_local_admin(request)
    return FileResponse(BASE_DIR / "admin.css", media_type="text/css")


@app.get("/admin.js", include_in_schema=False)
def admin_javascript(request: Request):
    require_local_admin(request)
    return FileResponse(BASE_DIR / "admin.js", media_type="text/javascript")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv(
            "HOST",
            "0.0.0.0"
            if os.getenv("ENVIRONMENT", "development").lower() == "production"
            else "127.0.0.1",
        ),
        port=int(os.getenv("PORT", "3000")),
    )
