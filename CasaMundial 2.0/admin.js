"use strict";

const $ = (selector, context = document) => context.querySelector(selector);
const LIMIT = 50;

const state = {
    objects: [],
    selected: null,
    columns: [],
    primaryKey: [],
    rows: [],
    offset: 0,
    total: 0,
    readOnly: true,
    mode: "create",
    editingKey: null
};

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function setFeedback(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle("is-error", isError);
    element.classList.toggle("is-success", Boolean(message) && !isError);
}

async function request(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...options.headers
        }
    });

    let data = null;
    if (response.status !== 204) {
        try {
            data = await response.json();
        } catch (_error) {
            if (!response.ok) {
                throw new Error("El servidor no pudo completar la solicitud.");
            }
        }
    }

    if (!response.ok) {
        throw new Error(data?.error || "No se pudo completar la solicitud.");
    }
    return data;
}

function currentPath() {
    return `/api/admin/tables/${encodeURIComponent(state.selected)}`;
}

async function loadObjects() {
    setFeedback($("#objectsStatus"), "Conectando con la base de datos...");
    try {
        const data = await request("/api/admin/tables");
        state.objects = data.objects;
        $("#databaseName").textContent = `Base: ${data.database}`;
        renderObjects();
        setFeedback($("#objectsStatus"), `${state.objects.length} tablas y vistas`);
        if (state.objects.length > 0) {
            await selectObject(state.objects[0].name);
        }
    } catch (error) {
        $("#databaseName").textContent = "Base de datos no disponible";
        setFeedback($("#objectsStatus"), error.message, true);
        setFeedback($("#tableFeedback"), error.message, true);
    }
}

function renderObjects() {
    const list = $("#tableList");
    list.replaceChildren();

    state.objects.forEach(object => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "table-item";
        button.classList.toggle("is-active", object.name === state.selected);
        button.setAttribute("aria-current", String(object.name === state.selected));

        const name = document.createElement("span");
        name.className = "table-item-name";
        name.textContent = object.name;

        const type = document.createElement("span");
        type.className = "object-type";
        type.textContent = object.type === "view" ? "Vista" : "Tabla";

        button.append(name, type);
        button.addEventListener("click", () => void selectObject(object.name));
        list.append(button);
    });
}

async function selectObject(name, offset = 0) {
    state.selected = name;
    state.offset = offset;
    renderObjects();
    await loadRows();
}

async function loadRows() {
    if (!state.selected) {
        return;
    }

    $("#tableTitle").textContent = state.selected;
    $("#rowsBody").innerHTML = '<tr><td class="empty-state">Cargando registros...</td></tr>';
    $("#createButton").disabled = true;
    $("#refreshButton").disabled = true;
    setFeedback($("#tableFeedback"), "");

    try {
        const data = await request(
            `${currentPath()}?offset=${state.offset}&limit=${LIMIT}`
        );
        state.columns = data.columns;
        state.primaryKey = data.primary_key;
        state.rows = data.rows;
        state.total = data.total;
        state.readOnly = data.read_only;
        renderTable(data);
    } catch (error) {
        $("#rowsHead").replaceChildren();
        $("#rowsBody").innerHTML =
            `<tr><td class="empty-state">${escapeHtml(error.message)}</td></tr>`;
        setFeedback($("#tableFeedback"), error.message, true);
    } finally {
        $("#refreshButton").disabled = false;
    }
}

function renderTable(data) {
    const columns = data.columns.map(column => column.name);
    const head = $("#rowsHead");
    const body = $("#rowsBody");
    head.replaceChildren();
    body.replaceChildren();

    const headingRow = document.createElement("tr");
    columns.forEach(name => {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = name;
        headingRow.append(cell);
    });
    if (!data.read_only) {
        const actions = document.createElement("th");
        actions.scope = "col";
        actions.textContent = "Acciones";
        headingRow.append(actions);
    }
    head.append(headingRow);

    if (data.rows.length === 0) {
        const empty = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = Math.max(columns.length + (data.read_only ? 0 : 1), 1);
        cell.className = "empty-state";
        cell.textContent = "Esta tabla no tiene registros.";
        empty.append(cell);
        body.append(empty);
    } else {
        data.rows.forEach(row => {
            const tr = document.createElement("tr");
            columns.forEach(name => {
                const td = document.createElement("td");
                const value = row[name];
                td.textContent = value === null ? "NULL" : displayValue(value);
                td.title = td.textContent;
                tr.append(td);
            });

            if (!data.read_only) {
                const actions = document.createElement("td");
                actions.className = "row-actions";
                const edit = document.createElement("button");
                edit.type = "button";
                edit.className = "row-action";
                edit.textContent = "Editar";
                edit.addEventListener("click", () => openEditor("edit", row));

                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "row-action row-action-danger";
                remove.textContent = "Borrar";
                remove.addEventListener("click", () => void deleteRow(row));
                actions.append(edit, remove);
                tr.append(actions);
            }
            body.append(tr);
        });
    }

    $("#tableDescription").textContent = data.read_only
        ? "Vista de solo lectura."
        : "Puedes agregar, editar o eliminar registros.";
    $("#columnSummary").textContent =
        `${columns.length} columnas visibles${data.primary_key.length ? ` · Clave: ${data.primary_key.join(", ")}` : ""}`;
    $("#rowSummary").textContent = `${data.total} registros`;
    $("#createButton").disabled = data.read_only;

    const currentPage = Math.floor(state.offset / LIMIT) + 1;
    const lastPage = Math.max(Math.ceil(data.total / LIMIT), 1);
    $("#pageSummary").textContent = `Página ${currentPage} de ${lastPage}`;
    $("#previousPage").disabled = state.offset === 0;
    $("#nextPage").disabled = state.offset + LIMIT >= data.total;
}

function displayValue(value) {
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return String(value);
}

function columnInputType(column) {
    const type = column.type.toLowerCase();
    if (type.includes("datetime") || type.includes("timestamp")) {
        return "datetime-local";
    }
    if (type.startsWith("date")) {
        return "date";
    }
    if (type.startsWith("time")) {
        return "time";
    }
    if (/^(tinyint|smallint|mediumint|int|integer|bigint)/.test(type)) {
        return "number";
    }
    if (/^(decimal|numeric|float|double|real)/.test(type)) {
        return "number";
    }
    if (type.includes("bool")) {
        return "checkbox";
    }
    return "text";
}

function openEditor(mode, row = {}) {
    state.mode = mode;
    state.editingKey = mode === "edit"
        ? Object.fromEntries(state.primaryKey.map(name => [name, row[name]]))
        : null;

    $("#dialogTitle").textContent = mode === "create"
        ? `Nuevo registro · ${state.selected}`
        : `Editar registro · ${state.selected}`;
    $("#dialogHelp").textContent =
        "Los campos ocultos de contraseña no se muestran ni se pueden modificar desde este panel.";
    $("#formFields").replaceChildren();
    setFeedback($("#formFeedback"), "");

    state.columns.forEach(column => {
        if (mode === "create" && column.auto_increment) {
            return;
        }

        const label = document.createElement("label");
        label.className = "field-label";
        label.htmlFor = `field-${column.name}`;

        const caption = document.createElement("span");
        caption.textContent = `${column.name} · ${column.type}${column.nullable ? " · opcional" : ""}`;

        const input = document.createElement("input");
        input.id = `field-${column.name}`;
        input.name = column.name;
        input.type = columnInputType(column);
        input.dataset.nullable = String(column.nullable);

        if (input.type === "checkbox") {
            input.checked = Boolean(row[column.name]);
        } else if (row[column.name] !== null && row[column.name] !== undefined) {
            const value = String(row[column.name]);
            input.value = input.type === "datetime-local" ? value.replace(" ", "T").slice(0, 16) : value;
        }

        const isPrimaryKey = state.primaryKey.includes(column.name);
        input.readOnly = mode === "edit" && isPrimaryKey;
        input.disabled = mode === "edit" && isPrimaryKey;
        if (!column.nullable && !column.has_default && !column.auto_increment) {
            input.required = true;
        }
        if (input.type === "number") {
            input.step = /^(decimal|numeric|float|double|real)/.test(column.type.toLowerCase())
                ? "any"
                : "1";
        }

        label.append(caption, input);
        $("#formFields").append(label);
    });

    $("#saveRow").textContent = mode === "create" ? "Crear registro" : "Guardar cambios";
    $("#rowDialog").showModal();
}

function formValues() {
    const values = {};
    const formData = new FormData($("#rowForm"));

    state.columns.forEach(column => {
        if (state.mode === "edit" && state.primaryKey.includes(column.name)) {
            return;
        }
        if (state.mode === "create" && column.auto_increment) {
            return;
        }

        const input = $(`#field-${CSS.escape(column.name)}`);
        if (!input || input.disabled) {
            return;
        }

        if (input.type === "checkbox") {
            values[column.name] = input.checked ? 1 : 0;
            return;
        }

        const value = formData.get(column.name);
        if (value === "") {
            if (column.has_default) {
                return;
            }
            values[column.name] = column.nullable ? null : "";
            return;
        }

        if (input.type === "number") {
            values[column.name] = /^(decimal|numeric|float|double|real)/.test(column.type.toLowerCase())
                ? String(value)
                : Number(value);
        } else {
            values[column.name] = input.type === "datetime-local"
                ? String(value).replace("T", " ")
                : String(value);
        }
    });
    return values;
}

async function saveRow(event) {
    event.preventDefault();
    const saveButton = $("#saveRow");
    saveButton.disabled = true;
    setFeedback($("#formFeedback"), "Guardando...");

    try {
        const options = {
            method: state.mode === "create" ? "POST" : "PUT",
            body: JSON.stringify(
                state.mode === "create"
                    ? { values: formValues() }
                    : { pk: state.editingKey, values: formValues() }
            )
        };
        const url = state.mode === "create" ? `${currentPath()}/rows` : `${currentPath()}/rows`;
        const data = await request(url, options);
        $("#rowDialog").close();
        setFeedback($("#tableFeedback"), data.mensaje);
        await loadRows();
    } catch (error) {
        setFeedback($("#formFeedback"), error.message, true);
    } finally {
        saveButton.disabled = false;
    }
}

function rowPrimaryKey(row) {
    return Object.fromEntries(state.primaryKey.map(name => [name, row[name]]));
}

async function deleteRow(row) {
    const key = rowPrimaryKey(row);
    const summary = Object.entries(key).map(([name, value]) => `${name}=${value}`).join(", ");
    if (!window.confirm(`¿Borrar definitivamente esta fila de ${state.selected} (${summary})?`)) {
        return;
    }

    try {
        const data = await request(`${currentPath()}/rows`, {
            method: "DELETE",
            body: JSON.stringify({ pk: key })
        });
        setFeedback($("#tableFeedback"), data.mensaje);
        if (state.rows.length === 1 && state.offset > 0) {
            state.offset = Math.max(0, state.offset - LIMIT);
        }
        await loadRows();
    } catch (error) {
        setFeedback($("#tableFeedback"), error.message, true);
    }
}

$("#createButton").addEventListener("click", () => openEditor("create"));
$("#refreshButton").addEventListener("click", () => void loadRows());
$("#rowForm").addEventListener("submit", saveRow);
$("#closeDialog").addEventListener("click", () => $("#rowDialog").close());
$("#cancelDialog").addEventListener("click", () => $("#rowDialog").close());
$("#previousPage").addEventListener("click", () => {
    void selectObject(state.selected, Math.max(0, state.offset - LIMIT));
});
$("#nextPage").addEventListener("click", () => {
    void selectObject(state.selected, state.offset + LIMIT);
});

void loadObjects();
