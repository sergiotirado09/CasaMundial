/* ==========================================================================
   CASA MUNDIAL — Script único
   --------------------------------------------------------------------------
   ÍNDICE
   01. Configuración y datos (PROPIEDADES)
   02. Utilidades
   03. Header: scroll, menú móvil y navegación activa
   04. Propiedades: render, filtros, favoritos y detalle
   05. Acceso (inicio de sesión / registro)
   06. Formulario de contacto
   07. Animaciones al hacer scroll
   08. Inicio
   ========================================================================== */

"use strict";

/* Permite que el CSS active las animaciones solo cuando hay JavaScript */
document.documentElement.classList.add("js");


/* ==========================================================================
   01. CONFIGURACIÓN Y DATOS
   Las propiedades se cargan desde la API y el canon se expresa en millones.
   ========================================================================== */
const CONFIG = {
    claveFavoritos: "casamundial:favoritos",
    umbralHeader: 20,
    margenSeccionActiva: 150
};

let PROPIEDADES = [];
let propiedadesCargadas = false;


/* ==========================================================================
   02. UTILIDADES
   ========================================================================== */
const $ = (selector, contexto = document) => contexto.querySelector(selector);
const $$ = (selector, contexto = document) => [...contexto.querySelectorAll(selector)];

function escapeHtml(valor) {
    return String(valor)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Minúsculas y sin tildes, para comparar textos ("Medellín" = "medellin"). */
function normalizar(texto) {
    return String(texto)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function formatearPrecio(millones, operacion) {
    const precio = `$${millones.toLocaleString("es-CO")} millones`;
    return operacion === "alquiler" ? `${precio} / mes` : precio;
}

async function apiRequest(url, opciones = {}) {
    const respuesta = await fetch(url, {
        credentials: "same-origin",
        ...opciones,
        headers: {
            "Content-Type": "application/json",
            ...opciones.headers
        }
    });

    let datos = null;

    if (respuesta.status !== 204) {
        try {
            datos = await respuesta.json();
        } catch (_error) {
            if (!respuesta.ok) {
                throw new Error("El servidor no pudo completar la solicitud.");
            }
        }
    }

    if (!respuesta.ok) {
        const error = new Error(datos?.error || "No se pudo completar la solicitud.");
        error.status = respuesta.status;
        throw error;
    }

    return datos;
}

function establecerEstadoPropiedades(texto, esError = false) {
    const estado = $("#propertiesFeedback");
    estado.textContent = texto;
    estado.hidden = texto === "";
    estado.classList.toggle("is-error", esError);
}

async function cargarPropiedades() {
    establecerEstadoPropiedades("Cargando propiedades...");

    try {
        const respuesta = await apiRequest("/api/propiedades");
        const tipos = {
            apartamento: "apartamento",
            casa: "casa",
            oficina: "oficina",
            localcomercial: "local"
        };

        PROPIEDADES = respuesta.propiedades.map(fila => {
            const tipoTexto = String(fila.tipo);
            const precio = Number(fila.canon_mensual);

            if (!Number.isFinite(precio)) {
                throw new Error("La base de datos devolvió un precio no válido.");
            }

            return {
                id: Number(fila.id),
                tipo: tipos[normalizar(tipoTexto).replace(/\s/g, "")] || "todos",
                tipoTexto,
                operacion: "alquiler",
                nuevo: false,
                etiqueta: fila.etiqueta || "Disponible",
                titulo: String(fila.titulo),
                ubicacion: `${fila.barrio}, ${fila.ciudad}`,
                precio: precio / 1_000_000,
                habitaciones: Number(fila.habitaciones),
                banos: Number(fila.banos),
                area: Number(fila.area_m2),
                imagen: fila.imagen_principal || "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=900&q=80",
                alt: String(fila.titulo)
            };
        });

        propiedadesCargadas = true;
        establecerEstadoPropiedades("");
        void mostrarEnlaceAdministracion();
    } catch (error) {
        console.error("No se pudieron cargar las propiedades:", error);
        establecerEstadoPropiedades(
            "No se pudieron cargar las propiedades. Comprueba la conexión con el servidor y Aiven.",
            true
        );
    }

    renderPropiedades();
}

async function mostrarEnlaceAdministracion() {
    const enlace = $("#adminLink");

    if (!enlace) {
        return;
    }

    try {
        await apiRequest("/api/admin/tables");
        enlace.hidden = false;
    } catch (error) {
        enlace.hidden = true;
        if (error.status !== 403 && error.status !== 404) {
            console.error("No se pudo habilitar el panel local de base de datos:", error);
        }
    }
}

function mostrarMensaje(elemento, texto, tipo) {
    elemento.textContent = texto;
    elemento.classList.remove("is-success", "is-error");
    elemento.classList.add("is-visible", tipo === "error" ? "is-error" : "is-success");
}

function ocultarMensaje(elemento) {
    elemento.textContent = "";
    elemento.classList.remove("is-visible", "is-success", "is-error");
}

function abrirDialogo(dialogo) {
    if (!dialogo.open) {
        dialogo.showModal();
    }
}

/** Configura el cierre de un <dialog> con su botón, el fondo y la tecla Esc (nativa). */
function configurarCierreDialogo(dialogo) {
    $$("[data-close-dialog]", dialogo).forEach(boton => {
        boton.addEventListener("click", () => dialogo.close());
    });

    dialogo.addEventListener("click", evento => {
        if (evento.target === dialogo) {
            dialogo.close();
        }
    });
}


/* ==========================================================================
   03. HEADER: SCROLL, MENÚ MÓVIL Y NAVEGACIÓN ACTIVA
   ========================================================================== */
function initHeader() {
    const header = $(".header");
    const menuToggle = $("#menuToggle");
    const nav = $("#mainNav");
    const enlaces = $$("a", nav);

    function establecerMenu(abierto) {
        nav.classList.toggle("is-open", abierto);
        header.classList.toggle("menu-open", abierto);
        menuToggle.setAttribute("aria-expanded", String(abierto));
        menuToggle.setAttribute("aria-label", abierto ? "Cerrar menú" : "Abrir menú");
    }

    menuToggle.addEventListener("click", () => {
        establecerMenu(!nav.classList.contains("is-open"));
    });

    enlaces.forEach(enlace => {
        enlace.addEventListener("click", () => establecerMenu(false));
    });

    document.addEventListener("keydown", evento => {
        if (evento.key === "Escape") {
            establecerMenu(false);
        }
    });

    /* Secciones a las que apunta el menú */
    const destinos = enlaces
        .map(enlace => ({ enlace, seccion: $(enlace.getAttribute("href")) }))
        .filter(item => item.seccion);

    function actualizarScroll() {
        header.classList.toggle("is-scrolled", window.scrollY > CONFIG.umbralHeader);

        let activo = destinos[0];

        destinos.forEach(item => {
            if (window.scrollY >= item.seccion.offsetTop - CONFIG.margenSeccionActiva) {
                activo = item;
            }
        });

        destinos.forEach(item => {
            const esActivo = item === activo;
            item.enlace.classList.toggle("active", esActivo);

            if (esActivo) {
                item.enlace.setAttribute("aria-current", "true");
            } else {
                item.enlace.removeAttribute("aria-current");
            }
        });
    }

    let pendiente = false;

    window.addEventListener("scroll", () => {
        if (pendiente) {
            return;
        }

        pendiente = true;

        requestAnimationFrame(() => {
            actualizarScroll();
            pendiente = false;
        });
    }, { passive: true });

    actualizarScroll();
}


/* ==========================================================================
   04. PROPIEDADES
   ========================================================================== */
const estadoBusqueda = {
    operacion: "alquiler",
    ubicacion: "",
    tipo: "todos",
    precio: "todos"
};

let favoritos = new Set();

function cargarFavoritos() {
    try {
        const guardados = JSON.parse(localStorage.getItem(CONFIG.claveFavoritos));

        if (Array.isArray(guardados)) {
            favoritos = new Set(guardados);
        }
    } catch (error) {
        favoritos = new Set();
    }
}

function guardarFavoritos() {
    try {
        localStorage.setItem(CONFIG.claveFavoritos, JSON.stringify([...favoritos]));
    } catch (error) {
        /* Almacenamiento no disponible: los favoritos solo duran la sesión. */
    }
}

function crearTarjeta(propiedad) {
    const esFavorito = favoritos.has(propiedad.id);

    return `
        <article class="property-card reveal" data-id="${propiedad.id}">
            <div class="property-image">
                <img
                    src="${escapeHtml(propiedad.imagen)}"
                    alt="${escapeHtml(propiedad.alt)}"
                    loading="lazy"
                    decoding="async"
                >
                <span class="property-tag">${escapeHtml(propiedad.etiqueta)}</span>
                <button
                    type="button"
                    class="favorite"
                    data-action="favorite"
                    aria-pressed="${esFavorito}"
                    aria-label="Guardar ${escapeHtml(propiedad.titulo)} en favoritos"
                >${esFavorito ? "♥" : "♡"}</button>
                <span class="property-status">${propiedad.operacion === "venta" ? "Venta" : "Alquiler"}</span>
            </div>

            <div class="property-content">
                <span class="property-type">${escapeHtml(propiedad.tipoTexto)}</span>
                <h3>${escapeHtml(propiedad.titulo)}</h3>
                <p class="property-location"><span aria-hidden="true">📍</span> ${escapeHtml(propiedad.ubicacion)}</p>

                <div class="property-features">
                    <span><span aria-hidden="true">🛏</span> ${propiedad.habitaciones} hab.</span>
                    <span><span aria-hidden="true">🚿</span> ${propiedad.banos} baños</span>
                    <span><span aria-hidden="true">▣</span> ${propiedad.area} m²</span>
                </div>

                <div class="property-footer">
                    <strong>${formatearPrecio(propiedad.precio, propiedad.operacion)}</strong>
                    <button type="button" class="details-btn" data-action="details">Ver detalles</button>
                </div>
            </div>
        </article>
    `;
}

function coincideConBusqueda(propiedad) {
    const { operacion, ubicacion, tipo, precio } = estadoBusqueda;

    const coincideOperacion =
        operacion === "nuevo" ? propiedad.nuevo : propiedad.operacion === operacion;

    const coincideUbicacion =
        ubicacion === "" ||
        normalizar(`${propiedad.ubicacion} ${propiedad.titulo}`).includes(ubicacion);

    const coincideTipo = tipo === "todos" || propiedad.tipo === tipo;

    const coincidePrecio = precio === "todos" || propiedad.precio <= Number(precio);

    return coincideOperacion && coincideUbicacion && coincideTipo && coincidePrecio;
}

function renderPropiedades() {
    const grid = $("#propertiesGrid");
    const sinResultados = $("#noResults");
    const filtradas = PROPIEDADES.filter(coincideConBusqueda);

    grid.innerHTML = filtradas.map(crearTarjeta).join("");
    sinResultados.hidden = !propiedadesCargadas || filtradas.length > 0;

    observarElementos($$(".reveal", grid));
}

function initBuscador() {
    const formulario = $("#searchForm");
    const tabs = $$(".search-tab");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(item => item.setAttribute("aria-pressed", String(item === tab)));
            estadoBusqueda.operacion = tab.dataset.operacion;
            renderPropiedades();
        });
    });

    formulario.addEventListener("submit", evento => {
        evento.preventDefault();

        estadoBusqueda.ubicacion = normalizar($("#searchLocation").value);
        estadoBusqueda.tipo = $("#searchType").value;
        estadoBusqueda.precio = $("#searchPrice").value;

        renderPropiedades();
        $("#propiedades").scrollIntoView({ behavior: "smooth" });
    });
}

function initTarjetas() {
    const grid = $("#propertiesGrid");
    const dialogo = $("#propertyDialog");
    const detalle = $("#propertyDetail");

    function abrirDetalle(propiedad) {
        detalle.innerHTML = `
            <img
                src="${escapeHtml(propiedad.imagen)}"
                alt="${escapeHtml(propiedad.alt)}"
                class="modal-property-image"
            >

            <span class="property-type">${escapeHtml(propiedad.tipoTexto)}</span>

            <h2>${escapeHtml(propiedad.titulo)}</h2>

            <p class="property-location"><span aria-hidden="true">📍</span> ${escapeHtml(propiedad.ubicacion)}</p>

            <strong class="modal-price">${formatearPrecio(propiedad.precio, propiedad.operacion)}</strong>

            <div class="property-features">
                <span><span aria-hidden="true">🛏</span> ${propiedad.habitaciones} hab.</span>
                <span><span aria-hidden="true">🚿</span> ${propiedad.banos} baños</span>
                <span><span aria-hidden="true">▣</span> ${propiedad.area} m²</span>
            </div>

            <div class="modal-actions">
                <a href="#contacto" class="btn btn-primary full-width" data-close-dialog>
                    Quiero información
                </a>
            </div>
        `;

        $("[data-close-dialog]", detalle).addEventListener("click", () => dialogo.close());
        abrirDialogo(dialogo);
    }

    /* Delegación de eventos: funciona aunque las tarjetas se vuelvan a generar */
    grid.addEventListener("click", evento => {
        const boton = evento.target.closest("[data-action]");

        if (!boton) {
            return;
        }

        const id = Number(boton.closest(".property-card").dataset.id);

        if (boton.dataset.action === "favorite") {
            const activo = !favoritos.has(id);

            if (activo) {
                favoritos.add(id);
            } else {
                favoritos.delete(id);
            }

            boton.setAttribute("aria-pressed", String(activo));
            boton.textContent = activo ? "♥" : "♡";
            guardarFavoritos();
        }

        if (boton.dataset.action === "details") {
            const propiedad = PROPIEDADES.find(item => item.id === id);

            if (propiedad) {
                abrirDetalle(propiedad);
            }
        }
    });

    configurarCierreDialogo(dialogo);
}


/* ==========================================================================
   05. ACCESO (INICIO DE SESIÓN / REGISTRO)
   Registro e inicio de sesión con la API.
   ========================================================================== */
const ROLES = {
    inquilino: {
        nombre: "Inquilino",
        plural: "inquilinos",
        subtitulo: "Encuentra tu próximo hogar",
        botonLogin: "Ingresar como inquilino",
        botonRegistro: "Registrarse como inquilino"
    },
    propietario: {
        nombre: "Propietario",
        plural: "propietarios",
        subtitulo: "Publica y gestiona tus propiedades",
        botonLogin: "Ingresar como propietario",
        botonRegistro: "Registrarse como propietario"
    }
};

const MIN_PASSWORD = 8;
let usuarioSesion = null;

function initAcceso() {
    const dialogo = $("#authDialog");
    const formulario = $("#authForm");
    const titulo = $("#authTitle");
    const subtitulo = $("#authSubtitle");
    const grupoNombre = $("#authNameGroup");
    const campoNombre = $("#authName");
    const campoEmail = $("#authEmail");
    const campoPassword = $("#authPassword");
    const botonEnviar = $("#authSubmit");
    const mensaje = $("#authFeedback");
    const botonesRol = $$("[data-rol]", dialogo);
    const botonesModo = $$("[data-modo]", dialogo);
    const botonesAbrir = $$("[data-open-auth]");

    const estado = { rol: "inquilino", modo: "login" };
    let solicitudPublicarCasa = false;

    function actualizarBotonesSesion() {
        botonesAbrir.forEach(boton => {
            boton.textContent = usuarioSesion ? "Cerrar sesión" : "Iniciar sesión";
            boton.setAttribute(
                "aria-label",
                usuarioSesion ? `Cerrar sesión de ${usuarioSesion.nombre}` : "Iniciar sesión"
            );
        });
    }

    async function cargarSesion() {
        try {
            const respuesta = await apiRequest("/api/auth/me");
            usuarioSesion = respuesta.usuario;
        } catch (error) {
            usuarioSesion = null;

            if (error.status !== 401) {
                console.error("No se pudo consultar la sesión:", error);
            }
        }

        actualizarBotonesSesion();
    }

    function actualizarInterfaz() {
        const rol = ROLES[estado.rol];
        const esLogin = estado.modo === "login";

        botonesRol.forEach(boton => {
            boton.setAttribute("aria-pressed", String(boton.dataset.rol === estado.rol));
        });

        botonesModo.forEach(boton => {
            boton.setAttribute("aria-pressed", String(boton.dataset.modo === estado.modo));
        });

        titulo.textContent = esLogin ? `Acceso para ${rol.plural}` : `Registro de ${rol.nombre.toLowerCase()}`;
        subtitulo.textContent = rol.subtitulo;
        botonEnviar.textContent = esLogin ? rol.botonLogin : rol.botonRegistro;

        grupoNombre.hidden = esLogin;
        campoNombre.required = !esLogin;
        campoPassword.autocomplete = esLogin ? "current-password" : "new-password";

        ocultarMensaje(mensaje);
    }

    window.addEventListener("casa-mundial:solicitar-publicacion", () => {
        solicitudPublicarCasa = true;
        estado.rol = "propietario";
        estado.modo = "login";
        actualizarInterfaz();
        abrirDialogo(dialogo);
        campoEmail.focus();
    });

    function marcarInvalido(campo, invalido) {
        campo.setAttribute("aria-invalid", String(invalido));
    }

    function validar() {
        const esRegistro = estado.modo === "registro";
        let error = "";

        [campoNombre, campoEmail, campoPassword].forEach(campo => marcarInvalido(campo, false));

        if (esRegistro && campoNombre.value.trim() === "") {
            marcarInvalido(campoNombre, true);
            error = "Escribe tu nombre completo.";
        } else if (!campoEmail.checkValidity() || campoEmail.value.trim() === "") {
            marcarInvalido(campoEmail, true);
            error = "Escribe un correo electrónico válido.";
        } else if (campoPassword.value === "") {
            marcarInvalido(campoPassword, true);
            error = "Escribe tu contraseña.";
        } else if (esRegistro && campoPassword.value.length < MIN_PASSWORD) {
            marcarInvalido(campoPassword, true);
            error = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
        }

        return error;
    }

    async function enviarAcceso() {
        const rol = ROLES[estado.rol].nombre.toLowerCase();
        const accion = estado.modo === "login" ? "Sesión iniciada" : "Cuenta creada";

        botonEnviar.disabled = true;

        try {
            const ruta = estado.modo === "login" ? "/api/auth/login" : "/api/auth/register";
            const respuesta = await apiRequest(ruta, {
                method: "POST",
                body: JSON.stringify({
                    nombre: campoNombre.value.trim(),
                    email: campoEmail.value.trim(),
                    password: campoPassword.value,
                    rol: estado.rol
                })
            });

            usuarioSesion = respuesta.usuario;
            actualizarBotonesSesion();
            mostrarMensaje(mensaje, `${accion} como ${rol}.`, "exito");

            if (solicitudPublicarCasa && usuarioSesion.rol === "propietario") {
                solicitudPublicarCasa = false;
                dialogo.close();
                window.dispatchEvent(new Event("casa-mundial:abrir-publicacion"));
            } else {
                setTimeout(() => {
                    if (dialogo.open) {
                        dialogo.close();
                    }
                }, 1000);
            }
        } catch (error) {
            mostrarMensaje(mensaje, error.message, "error");
        } finally {
            botonEnviar.disabled = false;
        }
    }

    botonesRol.forEach(boton => {
        boton.addEventListener("click", () => {
            estado.rol = boton.dataset.rol;
            actualizarInterfaz();
        });
    });

    botonesModo.forEach(boton => {
        boton.addEventListener("click", () => {
            estado.modo = boton.dataset.modo;
            actualizarInterfaz();
        });
    });

    formulario.addEventListener("submit", evento => {
        evento.preventDefault();

        const error = validar();

        if (error) {
            mostrarMensaje(mensaje, error, "error");
            return;
        }

        void enviarAcceso();
    });

    botonesAbrir.forEach(boton => {
        boton.addEventListener("click", async () => {
            if (usuarioSesion) {
                boton.disabled = true;

                try {
                    await apiRequest("/api/auth/logout", { method: "POST" });
                    usuarioSesion = null;
                    actualizarBotonesSesion();
                } catch (error) {
                    abrirDialogo(dialogo);
                    mostrarMensaje(mensaje, error.message, "error");
                } finally {
                    boton.disabled = false;
                }

                return;
            }

            abrirDialogo(dialogo);
            campoEmail.focus();
        });
    });

    dialogo.addEventListener("close", () => {
        solicitudPublicarCasa = false;
        formulario.reset();
        [campoNombre, campoEmail, campoPassword].forEach(campo => marcarInvalido(campo, false));
        ocultarMensaje(mensaje);
    });

    configurarCierreDialogo(dialogo);
    actualizarInterfaz();
    void cargarSesion();
}


/* ==========================================================================
   06. PUBLICAR UNA CASA
   Solo los propietarios autenticados pueden enviar una publicación.
   ========================================================================== */
function initPublicacion() {
    const botonAbrir = $("#publishPropertyButton");
    const dialogo = $("#listingDialog");
    const formulario = $("#listingForm");
    const selectorTipo = $("#listingType");
    const selectorBarrio = $("#listingNeighborhood");
    const botonEnviar = $("#listingSubmit");
    const mensaje = $("#listingFeedback");
    let opcionesCargadas = false;
    let cargaOpciones = null;

    async function cargarOpciones() {
        if (opcionesCargadas) {
            return;
        }

        if (!cargaOpciones) {
            cargaOpciones = apiRequest("/api/publicaciones/opciones");
        }

        try {
            const opciones = await cargaOpciones;
            if (!opciones.tipos.length || !opciones.barrios.length) {
                throw new Error("No hay tipos de casa o ubicaciones configurados en Aiven.");
            }

            selectorTipo.replaceChildren(new Option("Selecciona el tipo de casa", ""));
            opciones.tipos.forEach(tipo => {
                selectorTipo.add(new Option(tipo.nombre, String(tipo.id_tipo)));
            });

            selectorBarrio.replaceChildren(new Option("Selecciona barrio y ciudad", ""));
            opciones.barrios.forEach(barrio => {
                selectorBarrio.add(
                    new Option(
                        `${barrio.barrio}, ${barrio.ciudad}`,
                        String(barrio.id_barrio)
                    )
                );
            });
            opcionesCargadas = true;
        } catch (error) {
            cargaOpciones = null;
            mostrarMensaje(mensaje, error.message, "error");
        }
    }

    function abrirFormulario() {
        ocultarMensaje(mensaje);
        abrirDialogo(dialogo);
        void cargarOpciones();
    }

    botonAbrir.addEventListener("click", () => {
        if (usuarioSesion?.rol === "propietario") {
            abrirFormulario();
            return;
        }

        window.dispatchEvent(new Event("casa-mundial:solicitar-publicacion"));
    });

    window.addEventListener("casa-mundial:abrir-publicacion", abrirFormulario);

    formulario.addEventListener("submit", async evento => {
        evento.preventDefault();

        if (!formulario.reportValidity()) {
            return;
        }

        botonEnviar.disabled = true;
        ocultarMensaje(mensaje);

        try {
            const valores = Object.fromEntries(new FormData(formulario).entries());
            const datos = {
                ...valores,
                id_tipo: Number(valores.id_tipo),
                id_barrio: Number(valores.id_barrio),
                habitaciones: Number(valores.habitaciones),
                banos: Number(valores.banos)
            };
            const respuesta = await apiRequest("/api/publicaciones", {
                method: "POST",
                body: JSON.stringify(datos)
            });

            mostrarMensaje(mensaje, respuesta.mensaje, "exito");
            formulario.reset();
        } catch (error) {
            mostrarMensaje(mensaje, error.message, "error");
        } finally {
            botonEnviar.disabled = false;
        }
    });

    configurarCierreDialogo(dialogo);
}


/* ==========================================================================
   07. FORMULARIO DE CONTACTO
   ========================================================================== */
function initContacto() {
    const formulario = $("#contactForm");
    const mensaje = $("#contactFeedback");

    formulario.addEventListener("submit", async evento => {
        evento.preventDefault();

        const botonEnviar = $('button[type="submit"]', formulario);
        botonEnviar.disabled = true;

        try {
            const datos = Object.fromEntries(new FormData(formulario).entries());
            const respuesta = await apiRequest("/api/contacto", {
                method: "POST",
                body: JSON.stringify(datos)
            });

            mostrarMensaje(mensaje, respuesta.mensaje, "exito");
            formulario.reset();
        } catch (error) {
            mostrarMensaje(mensaje, error.message, "error");
        } finally {
            botonEnviar.disabled = false;
        }
    });
}


/* ==========================================================================
   08. ANIMACIONES AL HACER SCROLL
   ========================================================================== */
let observador = null;

function observarElementos(elementos) {
    if (!observador) {
        elementos.forEach(elemento => elemento.classList.add("is-visible"));
        return;
    }

    elementos.forEach(elemento => observador.observe(elemento));
}

function initAnimaciones() {
    const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducirMovimiento || !("IntersectionObserver" in window)) {
        return;
    }

    observador = new IntersectionObserver(entradas => {
        entradas.forEach(entrada => {
            if (entrada.isIntersecting) {
                entrada.target.classList.add("is-visible");
                observador.unobserve(entrada.target);
            }
        });
    }, { threshold: 0.12 });
}


/* ==========================================================================
   09. INICIO
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
    cargarFavoritos();
    initAnimaciones();

    initHeader();
    initBuscador();
    initTarjetas();
    initAcceso();
    initPublicacion();
    initContacto();

    observarElementos($$(".reveal"));
    void cargarPropiedades();

    $("#currentYear").textContent = new Date().getFullYear();
});
