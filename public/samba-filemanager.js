/**
 * saltcorn-samba – Client-Controller für die `SambaFileManager`-View.
 *
 * Ergänzt zur reinen Anzeige aus samba-tree.js noch Upload, Rename, Delete
 * und Mkdir. Jede Schreib-Aktion geht über eine der Routen
 *   /sambaupload | /sambadelete | /sambarename | /sambamkdir
 * mit einem CSRF-Token, das in der View-Shell in den JavaScript-Kontext
 * eingebettet wird und pro Request als X-CSRF-Token-Header mitgesendet wird.
 *
 * Gemeinsame Utilities (iconFor, joinPath, fmtSize, fmtDate, i18n) leben
 * in public/samba-common.js und werden via window.SambaCommon konsumiert.
 * Dadurch entfällt die frühere Duplizierung von iconFor() in beiden Client-JS.
 */
(function () {
  "use strict";

  var C = window.SambaCommon || {};

  // ---- DOM-Helper --------------------------------------------------------
  /**
   * Minimaler DOM-Konstruktor. Attribute `class`, `text` und `on…`-Handler
   * werden speziell behandelt; alles andere landet als HTML-Attribut. Kinder
   * dürfen Strings (Textknoten) oder Elemente sein; `null` wird verworfen.
   */
  function element(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "class") el.className = attrs[key];
        else if (key === "text") el.textContent = attrs[key];
        else if (key === "html") el.innerHTML = attrs[key];
        else if (key.slice(0, 2) === "on")
          el.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
        else el.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) {
      if (child == null) return;
      el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return el;
  }

  // ---- HTTP-Helper -------------------------------------------------------
  /**
   * GET /sambadir mit definierten Fehlermeldungen: JSON-`error`-Feld
   * schlägt HTTP-Status als Meldung.
   */
  async function fetchDirectory(path, showHidden) {
    var url =
      "/sambadir?path=" + encodeURIComponent(path || "") +
      (showHidden ? "&show_hidden=1" : "");
    var response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      var msg;
      try { msg = (await response.json()).error; } catch (_) { msg = "HTTP " + response.status; }
      throw new Error(msg || "HTTP " + response.status);
    }
    return response.json();
  }

  /**
   * POST als JSON mit CSRF-Token-Header. Erwartet JSON-Antwort mit optionalem
   * `error`-Feld; Status-Code wird bei Fehlern als `.status` durchgereicht.
   */
  async function postJson(url, body, csrfToken) {
    var response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken || "",
      },
      body: JSON.stringify(body || {}),
    });
    var data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (!response.ok) {
      var msg = (data && data.error) || ("HTTP " + response.status);
      var err = new Error(msg);
      err.status = response.status;
      err.body = data;
      throw err;
    }
    return data || { ok: true };
  }

  // ---- Toast + Modal -----------------------------------------------------
  /** Zeigt eine kurze Feedback-Nachricht am Bildschirmrand. */
  function toast(message, type) {
    var box = element("div", {
      class: "samba-toast samba-toast-" + (type || "info"),
      text: message,
    }, []);
    document.body.appendChild(box);
    setTimeout(function () { box.classList.add("samba-toast-hide"); }, 3200);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 3800);
  }

  /**
   * Baut einen einfachen Modal-Dialog auf. Rückgabe: `{ close, root }`;
   * ESC und Klick auf den Backdrop schließen automatisch.
   */
  function openModal(title, bodyElement, footerElements) {
    var backdrop = element("div", { class: "samba-modal-backdrop" }, []);
    var modalRoot = element("div", { class: "samba-modal card" }, [
      element("div", { class: "samba-modal-header card-header d-flex align-items-center" }, [
        element("strong", { text: title }, []),
        element("button", {
          type: "button", class: "btn-close ms-auto",
          "aria-label": C.t("ui.close"),
          onclick: function () { close(); },
        }, []),
      ]),
      element("div", { class: "samba-modal-body card-body" }, [bodyElement]),
      element("div", { class: "samba-modal-footer card-footer d-flex justify-content-end gap-2" }, footerElements || []),
    ]);
    backdrop.appendChild(modalRoot);
    document.body.appendChild(backdrop);

    function close() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close();
    });
    return { close: close, root: modalRoot };
  }

  // ---- Komponente --------------------------------------------------------
  /**
   * Baut den File-Manager-State auf und rendert Toolbar + Tabelle in die
   * vom Server vorbereiteten `<div>`-Elemente. Wird von der View-Shell
   * genau einmal pro Instanz mit `mount(id, opts)` aufgerufen.
   */
  function mount(id, opts) {
    opts = opts || {};
    var listRoot = document.getElementById(id + "-list");
    if (!listRoot) return;
    if (listRoot.dataset.mounted === "1") return;
    listRoot.dataset.mounted = "1";

    var toolbarRoot = document.getElementById(id + "-toolbar");
    var counterEl = document.getElementById(id + "-count");
    var viewerRoot = document.getElementById(id + "-viewer");

    var state = {
      path: opts.startPath || "",
      rootPath: opts.startPath || "",
      showHidden: !!opts.showHidden,
      sortBy: "name",
      sortDir: 1,
      page: 1,
      pageSize: Number(opts.pageSize) || 0,
      lastItems: [],
      perms: {},
    };

    function canGoUp() {
      if (!opts.allowNavigateUp) return false;
      return state.path.length > state.rootPath.length;
    }

    // ---- Toolbar --------------------------------------------------------
    /** Rendert Up/Home/Refresh + Breadcrumb + Toggle "show hidden" + Write-Buttons. */
    function renderToolbar() {
      toolbarRoot.innerHTML = "";
      var upButton = element("button", {
        type: "button",
        class: "btn btn-sm btn-outline-secondary me-1" + (canGoUp() ? "" : " disabled"),
        onclick: function () { if (canGoUp()) navigate(C.parentOf(state.path)); },
        title: C.t("ui.up_title"),
      }, [C.t("ui.up")]);

      var homeButton = element("button", {
        type: "button",
        class: "btn btn-sm btn-outline-secondary me-1" + (state.path === state.rootPath ? " disabled" : ""),
        onclick: function () { navigate(state.rootPath); },
        title: C.t("ui.home_title"),
      }, ["🏠"]);

      var reloadButton = element("button", {
        type: "button",
        class: "btn btn-sm btn-outline-secondary me-2",
        onclick: function () { load(state.path); },
        title: C.t("ui.refresh_title"),
      }, ["↻"]);

      var breadcrumb = element("nav", { class: "d-inline-block", "aria-label": "breadcrumb" }, [
        (function buildBreadcrumb() {
          var list = element("ol", { class: "breadcrumb mb-0 d-inline-flex" }, []);
          var rel = state.path.slice(state.rootPath.length).replace(/^\/+/, "");
          var segments = rel ? rel.split("/") : [];
          list.appendChild(element("li", {
            class: "breadcrumb-item" + (segments.length ? "" : " active"),
          }, [
            segments.length
              ? element("a", { href: "#", onclick: function (e) { e.preventDefault(); navigate(state.rootPath); } }, ["/"])
              : "/",
          ]));
          var cursor = state.rootPath;
          segments.forEach(function (segment, idx) {
            cursor = C.joinPath(cursor, segment);
            var isLast = idx === segments.length - 1;
            var target = cursor;
            list.appendChild(element("li", { class: "breadcrumb-item" + (isLast ? " active" : "") }, [
              isLast ? segment : element("a", {
                href: "#",
                onclick: function (e) { e.preventDefault(); navigate(target); },
              }, [segment]),
            ]));
          });
          return list;
        })(),
      ]);

      var hiddenToggle = element("label", { class: "form-check form-check-inline ms-3 mb-0 align-middle" }, [
        element("input", {
          type: "checkbox", class: "form-check-input",
          onchange: function (e) { state.showHidden = e.target.checked; load(state.path); },
        }, []),
        element("span", { class: "form-check-label small ms-1", text: C.t("ui.show_hidden") }, []),
      ]);
      hiddenToggle.querySelector("input").checked = state.showHidden;

      toolbarRoot.appendChild(upButton);
      toolbarRoot.appendChild(homeButton);
      toolbarRoot.appendChild(reloadButton);
      toolbarRoot.appendChild(breadcrumb);
      toolbarRoot.appendChild(hiddenToggle);

      // Write-Buttons rechts angeschlagen.
      var rightGroup = element("span", { class: "ms-auto d-inline-flex gap-1" }, []);
      if (state.perms.allowUpload) {
        rightGroup.appendChild(element("button", {
          type: "button",
          class: "btn btn-sm btn-primary",
          onclick: openUploadDialog,
          title: C.t("fm.upload_title"),
        }, [C.t("fm.upload")]));
      }
      if (state.perms.allowMkdir) {
        rightGroup.appendChild(element("button", {
          type: "button",
          class: "btn btn-sm btn-outline-primary",
          onclick: openMkdirDialog,
          title: C.t("fm.new_folder_title"),
        }, [C.t("fm.new_folder")]));
      }
      if (rightGroup.childNodes.length) {
        toolbarRoot.appendChild(element("span", { class: "flex-grow-1" }, []));
        toolbarRoot.appendChild(rightGroup);
      }
    }

    // ---- Tabelle --------------------------------------------------------
    /**
     * Sortiert Ordner immer vor Dateien; danach nach der ausgewählten Spalte.
     * Kein stabiler Sort (Array.prototype.sort ist in modernen Browsern
     * stabil, aber wir belasten uns nicht damit).
     */
    function sortItems(items) {
      var key = state.sortBy;
      var direction = state.sortDir;
      return items.slice().sort(function (a, b) {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        var va, vb;
        if (key === "size") { va = a.size || 0; vb = b.size || 0; }
        else if (key === "mtime") {
          va = a.mtime ? new Date(a.mtime).getTime() : 0;
          vb = b.mtime ? new Date(b.mtime).getTime() : 0;
        } else if (key === "type") { va = C.mediaTypeFor(a); vb = C.mediaTypeFor(b); }
        else { va = String(a.name).toLowerCase(); vb = String(b.name).toLowerCase(); }
        if (va < vb) return -1 * direction;
        if (va > vb) return 1 * direction;
        return 0;
      });
    }

    /** Klickbarer Spaltenkopf: toggelt Richtung bzw. wechselt Sortierspalte. */
    function sortHeader(label, key) {
      var arrow = state.sortBy === key ? (state.sortDir > 0 ? " ▲" : " ▼") : "";
      return element("th", {
        class: "samba-fm-th",
        style: "cursor:pointer;user-select:none;",
        onclick: function () {
          if (state.sortBy === key) state.sortDir = -state.sortDir;
          else { state.sortBy = key; state.sortDir = 1; }
          render();
        },
      }, [label + arrow]);
    }

    /** Baut die Datei-Tabelle inkl. Pagination, wenn `pageSize` > 0 ist. */
    function renderTable(items) {
      listRoot.innerHTML = "";
      var showWriteActions = state.perms.allowDelete || state.perms.allowRename;
      var table = element("table", {
        class: "table table-sm table-hover mb-0 samba-fm-table align-middle",
      }, [
        element("thead", {}, [
          element("tr", {}, [
            element("th", { style: "width:2.4rem;" }, []),
            sortHeader(C.t("fm.col.filename"), "name"),
            sortHeader(C.t("fm.col.media_type"), "type"),
            sortHeader(C.t("fm.col.size"), "size"),
            sortHeader(C.t("fm.col.modified"), "mtime"),
            element("th", { style: "width:" + (showWriteActions ? "18rem" : "14rem") + ";" }, [C.t("fm.col.actions")]),
          ]),
        ]),
      ]);
      var tbody = element("tbody", {}, []);
      var sorted = sortItems(items);
      var pageSlice = sorted;
      if (state.pageSize > 0) {
        var from = (state.page - 1) * state.pageSize;
        pageSlice = sorted.slice(from, from + state.pageSize);
      }

      pageSlice.forEach(function (item) {
        var fullPath = C.joinPath(state.path, item.name);
        var isDir = item.isDir;

        var nameCell = element("td", {}, [
          element("a", {
            href: "#", class: "samba-fm-name",
            onclick: function (e) {
              e.preventDefault();
              if (isDir) navigate(fullPath); else openFile(item, fullPath);
            },
          }, [item.name]),
        ]);

        var actions = [];
        if (isDir) {
          actions.push(element("button", {
            type: "button", class: "btn btn-sm btn-outline-secondary me-1",
            onclick: function () { navigate(fullPath); },
          }, [C.t("fm.open")]));
        } else {
          actions.push(element("a", {
            class: "btn btn-sm btn-outline-secondary me-1",
            href: "/sambafile?path=" + encodeURIComponent(fullPath) + "&disposition=inline",
            target: "_blank", title: C.t("fm.open_new_tab"),
          }, [C.t("fm.view")]));
          actions.push(element("a", {
            class: "btn btn-sm btn-outline-secondary me-1",
            href: "/sambafile?path=" + encodeURIComponent(fullPath) + "&disposition=attachment",
            title: C.t("fm.download"),
          }, ["⬇"]));
        }
        if (opts.exposeSmbLink) {
          actions.push(element("a", {
            class: "btn btn-sm btn-outline-primary me-1",
            href: "/sambalink?path=" + encodeURIComponent(fullPath),
            target: "_blank",
            title: C.t("fm.smb_link_title"),
          }, ["↗"]));
        }
        if (state.perms.allowRename) {
          actions.push(element("button", {
            type: "button", class: "btn btn-sm btn-outline-secondary me-1",
            title: C.t("fm.rename_title"),
            onclick: function () { openRenameDialog(item, fullPath); },
          }, ["✎"]));
        }
        if (state.perms.allowDelete) {
          actions.push(element("button", {
            type: "button", class: "btn btn-sm btn-outline-danger",
            title: C.t("fm.delete_title"),
            onclick: function () { confirmDelete(item, fullPath); },
          }, ["🗑"]));
        }

        tbody.appendChild(element("tr", {}, [
          element("td", { class: "samba-fm-icon", style: "font-size:1.2rem;" }, [C.iconFor(item)]),
          nameCell,
          element("td", { class: "text-muted small" }, [C.mediaTypeFor(item)]),
          element("td", { class: "text-muted small" }, [isDir ? "" : C.fmtSize(item.size)]),
          element("td", { class: "text-muted small" }, [C.fmtDate(item.mtime)]),
          element("td", {}, actions),
        ]));
      });
      table.appendChild(tbody);
      listRoot.appendChild(table);

      if (!items.length) {
        listRoot.appendChild(element("div", {
          class: "text-muted fst-italic p-3 text-center",
          text: C.t("ui.empty"),
        }, []));
      }

      if (state.pageSize > 0 && sorted.length > state.pageSize) {
        var totalPages = Math.ceil(sorted.length / state.pageSize);
        listRoot.appendChild(element("div", {
          class: "d-flex align-items-center justify-content-end p-2 border-top",
        }, [
          element("span", { class: "text-muted small me-2",
            text: C.t("ui.page_of", { page: state.page, total: totalPages }) }, []),
          element("button", {
            type: "button",
            class: "btn btn-sm btn-outline-secondary me-1" + (state.page <= 1 ? " disabled" : ""),
            onclick: function () { if (state.page > 1) { state.page--; render(); } },
          }, [C.t("ui.prev_page")]),
          element("button", {
            type: "button",
            class: "btn btn-sm btn-outline-secondary" + (state.page >= totalPages ? " disabled" : ""),
            onclick: function () { if (state.page < totalPages) { state.page++; render(); } },
          }, [C.t("ui.next_page")]),
        ]));
      }
    }

    /** Aktualisiert den kleinen "3 folders · 12 files"-Text im Karten-Header. */
    function updateCounter(items) {
      if (!counterEl) return;
      var dirCount = items.filter(function (i) { return i.isDir; }).length;
      var fileCount = items.length - dirCount;
      counterEl.textContent = C.t("fm.counter", { dirs: dirCount, files: fileCount });
    }

    /** Toolbar + Tabelle + Counter neu zeichnen. */
    function render() {
      renderToolbar();
      renderTable(state.lastItems);
      updateCounter(state.lastItems);
    }

    // ---- Navigation & Viewer -------------------------------------------
    function navigate(path) { state.page = 1; load(path); }

    /** Öffnet eine Datei entweder inline im Viewer oder in einem neuen Tab. */
    function openFile(item, fullPath) {
      if (!viewerRoot) {
        window.open("/sambafile?path=" + encodeURIComponent(fullPath) + "&disposition=inline", "_blank");
        return;
      }
      if (opts.pdfInline && C.isViewable(item.name)) {
        viewerRoot.innerHTML = "";
        var isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(item.name);
        var streamUrl = "/sambafile?path=" + encodeURIComponent(fullPath) + "&disposition=inline";
        var header = element("div", {
          class: "samba-fm-viewer-header d-flex align-items-center p-2 border-top",
        }, [
          element("strong", { text: item.name }, []),
          element("span", { class: "text-muted small ms-2", text: C.fmtSize(item.size) }, []),
          element("button", {
            type: "button", class: "btn btn-sm btn-outline-secondary ms-auto",
            onclick: function () { viewerRoot.innerHTML = ""; },
          }, [C.t("ui.close")]),
        ]);
        viewerRoot.appendChild(header);
        if (isImage) {
          viewerRoot.appendChild(element("img", {
            src: streamUrl,
            style: "max-width:100%;max-height:70vh;display:block;margin:0 auto;",
          }, []));
        } else {
          viewerRoot.appendChild(element("iframe", {
            src: streamUrl, style: "width:100%;height:70vh;border:0;display:block;",
          }, []));
        }
      } else {
        window.open("/sambafile?path=" + encodeURIComponent(fullPath) + "&disposition=inline", "_blank");
      }
    }

    // ---- Schreib-Aktionen ----------------------------------------------
    /** Öffnet einen "Wirklich löschen?"-Dialog und ruft /sambadelete auf. */
    function confirmDelete(item, fullPath) {
      var body = element("div", {}, [
        element("p", {}, [
          C.t("fm.confirm_delete.prompt_prefix"),
          element("strong", { text: item.name }, []),
          C.t("fm.confirm_delete.prompt_suffix"),
        ]),
        item.isDir
          ? element("div", { class: "alert alert-warning small mb-0", text: C.t("fm.confirm_delete.dir_hint") }, [])
          : element("div", { class: "text-muted small", text: C.t("fm.confirm_delete.file_hint") }, []),
      ]);
      var dialog = openModal(C.t("fm.confirm_delete.title"), body, [
        element("button", {
          type: "button", class: "btn btn-outline-secondary",
          onclick: function () { dialog.close(); },
        }, [C.t("ui.cancel")]),
        element("button", {
          type: "button", class: "btn btn-danger",
          onclick: async function () {
            try {
              await postJson("/sambadelete", {
                path: fullPath, isDir: item.isDir ? "1" : "0",
              }, opts.csrfToken);
              dialog.close();
              toast(C.t("fm.deleted_ok", { name: item.name }), "success");
              load(state.path);
            } catch (err) {
              toast(C.t("fm.deleted_fail", { msg: err.message }), "error");
            }
          },
        }, [C.t("fm.delete")]),
      ]);
    }

    /** Rename-Dialog. Der Server prüft nochmal via sanitizeFilename. */
    function openRenameDialog(item, fullPath) {
      var input = element("input", {
        type: "text", class: "form-control", value: item.name,
      }, []);
      var body = element("div", {}, [
        element("label", { class: "form-label small text-muted", text: C.t("fm.rename.label") }, []),
        input,
        element("div", { class: "form-text small", text: C.t("fm.rename.hint") }, []),
      ]);
      var dialog = openModal(C.t("fm.rename.title", { name: item.name }), body, [
        element("button", {
          type: "button", class: "btn btn-outline-secondary",
          onclick: function () { dialog.close(); },
        }, [C.t("ui.cancel")]),
        element("button", {
          type: "button", class: "btn btn-primary",
          onclick: async function () {
            var newName = input.value.trim();
            if (!newName || newName === item.name) { dialog.close(); return; }
            try {
              await postJson("/sambarename", {
                from: fullPath, newName: newName,
              }, opts.csrfToken);
              dialog.close();
              toast(C.t("fm.renamed_ok", { name: newName }), "success");
              load(state.path);
            } catch (err) {
              toast(C.t("fm.rename_fail", { msg: err.message }), "error");
            }
          },
        }, [C.t("fm.rename")]),
      ]);
      setTimeout(function () { input.focus(); input.select(); }, 20);
    }

    /** Neuen Ordner im aktuellen Pfad anlegen. */
    function openMkdirDialog() {
      var input = element("input", {
        type: "text", class: "form-control", placeholder: C.t("fm.mkdir.placeholder"),
      }, []);
      var body = element("div", {}, [
        element("label", { class: "form-label small text-muted", text: C.t("fm.mkdir.label") }, []),
        input,
      ]);
      var dialog = openModal(C.t("fm.mkdir.title", { path: state.path || "/" }), body, [
        element("button", {
          type: "button", class: "btn btn-outline-secondary",
          onclick: function () { dialog.close(); },
        }, [C.t("ui.cancel")]),
        element("button", {
          type: "button", class: "btn btn-primary",
          onclick: async function () {
            var name = input.value.trim();
            if (!name) return;
            try {
              await postJson("/sambamkdir", {
                path: state.path, name: name,
              }, opts.csrfToken);
              dialog.close();
              toast(C.t("fm.mkdir_ok", { name: name }), "success");
              load(state.path);
            } catch (err) {
              toast(C.t("fm.mkdir_fail", { msg: err.message }), "error");
            }
          },
        }, [C.t("fm.mkdir.create")]),
      ]);
      setTimeout(function () { input.focus(); }, 20);
    }

    /**
     * Upload-Dialog mit Drag-&-Drop-Zone und File-Input. Sendet multipart
     * mit CSRF-Header. 207 (Multi-Status) mit Teilfehlern wird als Teil-
     * Erfolg dargestellt.
     */
    function openUploadDialog() {
      var maxMb = Number(state.perms.maxUploadMb) || 50;
      var fileInput = element("input", {
        type: "file", class: "form-control", multiple: "multiple",
      }, []);
      var overwriteCheckbox = element("input", { type: "checkbox", class: "form-check-input" }, []);
      var dropZone = element("div", {
        class: "samba-drop border rounded p-4 text-center text-muted",
        text: C.t("fm.upload.dropzone"),
        onclick: function () { fileInput.click(); },
      }, []);
      var pickedList = element("div", { class: "samba-picked small mt-2" }, []);

      function setFiles(fileList) {
        fileInput.__files = Array.prototype.slice.call(fileList);
        pickedList.innerHTML = "";
        if (!fileInput.__files.length) return;
        var ul = element("ul", { class: "list-unstyled mb-0" }, []);
        fileInput.__files.forEach(function (file) {
          ul.appendChild(element("li", { text: file.name + " (" + C.fmtSize(file.size) + ")" }, []));
        });
        pickedList.appendChild(ul);
      }
      fileInput.addEventListener("change", function () { setFiles(fileInput.files); });
      ["dragenter", "dragover"].forEach(function (evt) {
        dropZone.addEventListener(evt, function (e) {
          e.preventDefault(); e.stopPropagation();
          dropZone.classList.add("samba-drop-active");
        });
      });
      ["dragleave", "drop"].forEach(function (evt) {
        dropZone.addEventListener(evt, function (e) {
          e.preventDefault(); e.stopPropagation();
          dropZone.classList.remove("samba-drop-active");
        });
      });
      dropZone.addEventListener("drop", function (e) {
        if (e.dataTransfer && e.dataTransfer.files) setFiles(e.dataTransfer.files);
      });

      var progress = element("div", { class: "samba-upload-progress mt-2" }, []);
      var body = element("div", {}, [
        element("div", { class: "small text-muted mb-2" }, [
          C.t("fm.upload.into_prefix"),
          element("code", { text: state.path || "/" }, []),
          C.t("fm.upload.limit", { mb: maxMb }),
        ]),
        dropZone,
        element("div", { class: "mt-2" }, [
          element("label", { class: "form-label small text-muted", text: C.t("fm.upload.or_pick") }, []),
          fileInput,
        ]),
        pickedList,
        element("label", { class: "form-check mt-2" }, [
          overwriteCheckbox,
          element("span", { class: "form-check-label ms-1 small", text: C.t("fm.upload.overwrite") }, []),
        ]),
        progress,
      ]);

      var uploadButton;
      var dialog = openModal(C.t("fm.upload.title"), body, [
        element("button", {
          type: "button", class: "btn btn-outline-secondary",
          onclick: function () { dialog.close(); },
        }, [C.t("ui.cancel")]),
        (uploadButton = element("button", {
          type: "button", class: "btn btn-primary",
          onclick: async function () {
            var files = fileInput.__files || Array.prototype.slice.call(fileInput.files || []);
            if (!files.length) { toast(C.t("fm.upload.no_files"), "error"); return; }
            uploadButton.setAttribute("disabled", "disabled");
            try {
              var formData = new FormData();
              formData.append("path", state.path);
              formData.append("overwrite", overwriteCheckbox.checked ? "1" : "0");
              files.forEach(function (file) { formData.append("file", file); });
              progress.innerHTML = C.t("fm.upload.uploading");
              var response = await fetch("/sambaupload", {
                method: "POST",
                credentials: "same-origin",
                headers: { "X-CSRF-Token": opts.csrfToken || "" },
                body: formData,
              });
              var data = null;
              try { data = await response.json(); } catch (_) { data = null; }
              if (!response.ok && response.status !== 207) {
                throw new Error((data && data.error) || ("HTTP " + response.status));
              }
              var results = (data && data.results) || [];
              var okCount = results.filter(function (item) { return item.ok; }).length;
              var failed = results.filter(function (item) { return !item.ok; });
              if (failed.length) {
                progress.innerHTML = "";
                progress.appendChild(element("div", {
                  class: "alert alert-warning small mb-0",
                }, [
                  C.t("fm.upload.partial_summary", { ok: okCount, total: results.length }),
                  element("ul", { class: "mb-0" }, failed.map(function (item) {
                    return element("li", { text: item.name + ": " + item.error }, []);
                  })),
                ]));
                toast(C.t("fm.upload.some_failed"), "error");
              } else {
                toast(C.t("fm.upload.ok", { n: okCount }), "success");
                dialog.close();
              }
              load(state.path);
            } catch (err) {
              progress.innerHTML = "";
              progress.appendChild(element("div", {
                class: "alert alert-danger small mb-0",
                text: C.t("fm.upload.failed", { msg: err.message }),
              }, []));
              toast(C.t("fm.upload.failed_short"), "error");
            } finally {
              uploadButton.removeAttribute("disabled");
            }
          },
        }, [C.t("fm.upload.button")])),
      ]);
    }

    // ---- Datenzugriff --------------------------------------------------
    /** Lädt den aktuellen Pfad neu, aktualisiert `state` und rendert. */
    async function load(path) {
      state.path = path;
      listRoot.innerHTML = '<div class="text-muted p-3">' + C.t("ui.loading") + "</div>";
      try {
        var data = await fetchDirectory(path, state.showHidden);
        state.lastItems = data.items || [];
        state.perms = data.perms || {};
        render();
      } catch (err) {
        listRoot.innerHTML =
          '<div class="alert alert-danger m-2">' +
          C.t("tree.samba_prefix") + (err.message || String(err)) + "</div>";
        renderToolbar();
      }
    }
    load(state.path);
  }

  window.saltcornSambaMountFM = mount;
})();
