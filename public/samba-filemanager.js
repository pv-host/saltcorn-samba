/**
 * Client-side controller for the SambaFileManager view (v0.3.0).
 *
 * Adds upload, rename, delete and mkdir on top of the read-only browser.
 * Every write action goes through /sambaupload | /sambadelete | /sambarename
 * | /sambamkdir with a CSRF token (rendered into the shell) and expects
 * JSON responses.
 */
(function () {
  "use strict";

  // ---- tiny DOM helper ----------------------------------------------------
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs)
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") el.className = attrs[k];
        else if (k === "text") el.textContent = attrs[k];
        else if (k === "html") el.innerHTML = attrs[k];
        else if (k.slice(0, 2) === "on")
          el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else el.setAttribute(k, attrs[k]);
      });
    (children || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  // ---- helpers ------------------------------------------------------------
  function extOf(name) {
    var s = String(name || "");
    var d = s.lastIndexOf(".");
    return d >= 0 ? s.slice(d + 1).toLowerCase() : "";
  }
  function iconFor(item) {
    if (item.isDir) return "📁";
    var e = extOf(item.name);
    if (e === "pdf") return "📄";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].indexOf(e) >= 0) return "🖼️";
    if (["doc", "docx", "odt", "rtf", "txt", "md"].indexOf(e) >= 0) return "📝";
    if (["xls", "xlsx", "ods", "csv"].indexOf(e) >= 0) return "📊";
    if (["ppt", "pptx", "odp"].indexOf(e) >= 0) return "📽️";
    if (["zip", "tar", "gz", "7z", "rar"].indexOf(e) >= 0) return "🗜️";
    if (["mp3", "wav", "ogg", "flac", "m4a"].indexOf(e) >= 0) return "🎵";
    if (["mp4", "mkv", "mov", "avi", "webm"].indexOf(e) >= 0) return "🎬";
    return "📎";
  }
  function mediaTypeFor(item) {
    if (item.isDir) return "folder";
    var e = extOf(item.name);
    var map = {
      pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
      txt: "text/plain", md: "text/markdown", csv: "text/csv",
      json: "application/json", xml: "application/xml", html: "text/html", htm: "text/html",
      zip: "application/zip", doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      mp3: "audio/mpeg", mp4: "video/mp4", mkv: "video/x-matroska",
      mov: "video/quicktime", avi: "video/x-msvideo",
    };
    return map[e] || (e ? "application/" + e : "application/octet-stream");
  }
  function fmtSize(n) {
    if (!n || n < 0) return "";
    if (n < 1024) return n + " B";
    var kib = n / 1024;
    if (kib < 1024) return kib.toFixed(kib < 10 ? 1 : 0) + " KiB";
    var mib = kib / 1024;
    if (mib < 1024) return mib.toFixed(mib < 10 ? 1 : 0) + " MiB";
    return (mib / 1024).toFixed(2) + " GiB";
  }
  function fmtDate(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) return "";
    var pad = function (x) { return String(x).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function joinPath(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (a.replace(/\/+$/, "") + "/" + b.replace(/^\/+/, "")).replace(/\/+/g, "/");
  }
  function parentOf(p) {
    if (!p) return "";
    var i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  }
  function isViewable(name) {
    var n = (name || "").toLowerCase();
    return n.endsWith(".pdf") ||
      /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(n) ||
      /\.(txt|md|json|xml|csv|html?)$/.test(n);
  }

  // ---- http helpers -------------------------------------------------------
  async function fetchDir(path, showHidden) {
    var url = "/sambadir?path=" + encodeURIComponent(path || "") +
      (showHidden ? "&show_hidden=1" : "");
    var r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) {
      var msg;
      try { msg = (await r.json()).error; } catch (_) { msg = "HTTP " + r.status; }
      throw new Error(msg || "HTTP " + r.status);
    }
    return r.json();
  }
  async function postJson(url, body, csrf) {
    var r = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf || "",
      },
      body: JSON.stringify(body || {}),
    });
    var data = null;
    try { data = await r.json(); } catch (_) { data = null; }
    if (!r.ok) {
      var msg = (data && data.error) || ("HTTP " + r.status);
      var err = new Error(msg);
      err.status = r.status;
      err.body = data;
      throw err;
    }
    return data || { ok: true };
  }

  // ---- modal & toast ------------------------------------------------------
  function toast(msg, type) {
    var box = h("div", {
      class: "samba-toast samba-toast-" + (type || "info"),
      text: msg,
    }, []);
    document.body.appendChild(box);
    setTimeout(function () { box.classList.add("samba-toast-hide"); }, 3200);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 3800);
  }
  function modal(title, bodyEl, footerEls) {
    var backdrop = h("div", { class: "samba-modal-backdrop" }, []);
    var modalEl = h("div", { class: "samba-modal card" }, [
      h("div", { class: "samba-modal-header card-header d-flex align-items-center" }, [
        h("strong", { text: title }, []),
        h("button", {
          type: "button", class: "btn-close ms-auto",
          "aria-label": "Close",
          onclick: function () { close(); },
        }, []),
      ]),
      h("div", { class: "samba-modal-body card-body" }, [bodyEl]),
      h("div", { class: "samba-modal-footer card-footer d-flex justify-content-end gap-2" }, footerEls || []),
    ]);
    backdrop.appendChild(modalEl);
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
    return { close: close, root: modalEl };
  }

  // ---- component ----------------------------------------------------------
  function mount(id, opts) {
    opts = opts || {};
    var root = document.getElementById(id + "-list");
    if (!root) return;
    if (root.dataset.mounted === "1") return;
    root.dataset.mounted = "1";

    var toolbar = document.getElementById(id + "-toolbar");
    var counter = document.getElementById(id + "-count");
    var viewer = document.getElementById(id + "-viewer");

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

    // ---- toolbar --------------------------------------------------------
    function renderToolbar() {
      toolbar.innerHTML = "";
      var upBtn = h("button", {
        type: "button",
        class: "btn btn-sm btn-outline-secondary me-1" + (canGoUp() ? "" : " disabled"),
        onclick: function () { if (canGoUp()) navigate(parentOf(state.path)); },
        title: "Up one directory",
      }, ["⬆ Up"]);
      var homeBtn = h("button", {
        type: "button",
        class: "btn btn-sm btn-outline-secondary me-1" + (state.path === state.rootPath ? " disabled" : ""),
        onclick: function () { navigate(state.rootPath); },
        title: "Go to root",
      }, ["🏠"]);
      var reloadBtn = h("button", {
        type: "button",
        class: "btn btn-sm btn-outline-secondary me-2",
        onclick: function () { load(state.path); },
        title: "Refresh",
      }, ["↻"]);

      var breadcrumb = h("nav", { class: "d-inline-block", "aria-label": "breadcrumb" }, [
        (function () {
          var ol = h("ol", { class: "breadcrumb mb-0 d-inline-flex" }, []);
          var rel = state.path.slice(state.rootPath.length).replace(/^\/+/, "");
          var parts = rel ? rel.split("/") : [];
          ol.appendChild(h("li", {
            class: "breadcrumb-item" + (parts.length ? "" : " active"),
          }, [
            parts.length
              ? h("a", { href: "#", onclick: function (e) { e.preventDefault(); navigate(state.rootPath); } }, ["/"])
              : "/",
          ]));
          var cur = state.rootPath;
          parts.forEach(function (seg, idx) {
            cur = joinPath(cur, seg);
            var isLast = idx === parts.length - 1;
            var target = cur;
            ol.appendChild(h("li", { class: "breadcrumb-item" + (isLast ? " active" : "") }, [
              isLast ? seg : h("a", {
                href: "#",
                onclick: function (e) { e.preventDefault(); navigate(target); },
              }, [seg]),
            ]));
          });
          return ol;
        })(),
      ]);

      var hiddenToggle = h("label", { class: "form-check form-check-inline ms-3 mb-0 align-middle" }, [
        h("input", {
          type: "checkbox", class: "form-check-input",
          onchange: function (e) { state.showHidden = e.target.checked; load(state.path); },
        }, []),
        h("span", { class: "form-check-label small ms-1", text: "Show hidden" }, []),
      ]);
      hiddenToggle.querySelector("input").checked = state.showHidden;

      toolbar.appendChild(upBtn);
      toolbar.appendChild(homeBtn);
      toolbar.appendChild(reloadBtn);
      toolbar.appendChild(breadcrumb);
      toolbar.appendChild(hiddenToggle);

      // Write buttons on the right
      var right = h("span", { class: "ms-auto d-inline-flex gap-1" }, []);
      if (state.perms.allowUpload) {
        right.appendChild(h("button", {
          type: "button",
          class: "btn btn-sm btn-primary",
          onclick: openUploadDialog,
          title: "Upload files to this directory",
        }, ["⬆ Upload"]));
      }
      if (state.perms.allowMkdir) {
        right.appendChild(h("button", {
          type: "button",
          class: "btn btn-sm btn-outline-primary",
          onclick: openMkdirDialog,
          title: "Create new folder",
        }, ["+ Folder"]));
      }
      if (right.childNodes.length) {
        toolbar.appendChild(h("span", { class: "flex-grow-1" }, []));
        toolbar.appendChild(right);
      }
    }

    // ---- table ----------------------------------------------------------
    function sortItems(items) {
      var by = state.sortBy, dir = state.sortDir;
      return items.slice().sort(function (a, b) {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        var va, vb;
        if (by === "size") { va = a.size || 0; vb = b.size || 0; }
        else if (by === "mtime") {
          va = a.mtime ? new Date(a.mtime).getTime() : 0;
          vb = b.mtime ? new Date(b.mtime).getTime() : 0;
        } else if (by === "type") { va = mediaTypeFor(a); vb = mediaTypeFor(b); }
        else { va = String(a.name).toLowerCase(); vb = String(b.name).toLowerCase(); }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }
    function sortHeader(label, key) {
      var arrow = state.sortBy === key ? (state.sortDir > 0 ? " ▲" : " ▼") : "";
      return h("th", {
        class: "samba-fm-th",
        style: "cursor:pointer;user-select:none;",
        onclick: function () {
          if (state.sortBy === key) state.sortDir = -state.sortDir;
          else { state.sortBy = key; state.sortDir = 1; }
          render();
        },
      }, [label + arrow]);
    }
    function renderTable(items) {
      root.innerHTML = "";
      var showWriteActions = state.perms.allowDelete || state.perms.allowRename;
      var table = h("table", {
        class: "table table-sm table-hover mb-0 samba-fm-table align-middle",
      }, [
        h("thead", {}, [
          h("tr", {}, [
            h("th", { style: "width:2.4rem;" }, []),
            sortHeader("Filename", "name"),
            sortHeader("Media type", "type"),
            sortHeader("Size", "size"),
            sortHeader("Modified", "mtime"),
            h("th", { style: "width:" + (showWriteActions ? "18rem" : "14rem") + ";" }, ["Actions"]),
          ]),
        ]),
      ]);
      var tbody = h("tbody", {}, []);
      var sorted = sortItems(items);
      var slice = sorted;
      if (state.pageSize > 0) {
        var from = (state.page - 1) * state.pageSize;
        slice = sorted.slice(from, from + state.pageSize);
      }

      slice.forEach(function (item) {
        var full = joinPath(state.path, item.name);
        var isDir = item.isDir;

        var nameCell = h("td", {}, [
          h("a", {
            href: "#", class: "samba-fm-name",
            onclick: function (e) {
              e.preventDefault();
              if (isDir) navigate(full); else openFile(item, full);
            },
          }, [item.name]),
        ]);

        var actions = [];
        if (isDir) {
          actions.push(h("button", {
            type: "button", class: "btn btn-sm btn-outline-secondary me-1",
            onclick: function () { navigate(full); },
          }, ["Open"]));
        } else {
          actions.push(h("a", {
            class: "btn btn-sm btn-outline-secondary me-1",
            href: "/sambafile?path=" + encodeURIComponent(full) + "&disposition=inline",
            target: "_blank", title: "Open in new tab",
          }, ["View"]));
          actions.push(h("a", {
            class: "btn btn-sm btn-outline-secondary me-1",
            href: "/sambafile?path=" + encodeURIComponent(full) + "&disposition=attachment",
            title: "Download",
          }, ["⬇"]));
        }
        if (opts.exposeSmbLink) {
          actions.push(h("a", {
            class: "btn btn-sm btn-outline-primary me-1",
            href: "/sambalink?path=" + encodeURIComponent(full),
            target: "_blank",
            title: "Open in file manager (Nemo/Nautilus/Explorer)",
          }, ["↗"]));
        }
        if (state.perms.allowRename) {
          actions.push(h("button", {
            type: "button", class: "btn btn-sm btn-outline-secondary me-1",
            title: "Rename",
            onclick: function () { openRenameDialog(item, full); },
          }, ["✎"]));
        }
        if (state.perms.allowDelete) {
          actions.push(h("button", {
            type: "button", class: "btn btn-sm btn-outline-danger",
            title: "Delete",
            onclick: function () { confirmDelete(item, full); },
          }, ["🗑"]));
        }

        tbody.appendChild(h("tr", {}, [
          h("td", { class: "samba-fm-icon", style: "font-size:1.2rem;" }, [iconFor(item)]),
          nameCell,
          h("td", { class: "text-muted small" }, [mediaTypeFor(item)]),
          h("td", { class: "text-muted small" }, [isDir ? "" : fmtSize(item.size)]),
          h("td", { class: "text-muted small" }, [fmtDate(item.mtime)]),
          h("td", {}, actions),
        ]));
      });
      table.appendChild(tbody);
      root.appendChild(table);

      if (!items.length) {
        root.appendChild(h("div", {
          class: "text-muted fst-italic p-3 text-center",
          text: "(empty directory)",
        }, []));
      }

      if (state.pageSize > 0 && sorted.length > state.pageSize) {
        var totalPages = Math.ceil(sorted.length / state.pageSize);
        root.appendChild(h("div", {
          class: "d-flex align-items-center justify-content-end p-2 border-top",
        }, [
          h("span", { class: "text-muted small me-2", text: "Page " + state.page + " / " + totalPages }, []),
          h("button", {
            type: "button",
            class: "btn btn-sm btn-outline-secondary me-1" + (state.page <= 1 ? " disabled" : ""),
            onclick: function () { if (state.page > 1) { state.page--; render(); } },
          }, ["‹"]),
          h("button", {
            type: "button",
            class: "btn btn-sm btn-outline-secondary" + (state.page >= totalPages ? " disabled" : ""),
            onclick: function () { if (state.page < totalPages) { state.page++; render(); } },
          }, ["›"]),
        ]));
      }
    }
    function updateCounter(items) {
      if (!counter) return;
      var dirs = items.filter(function (i) { return i.isDir; }).length;
      var files = items.length - dirs;
      counter.textContent = dirs + " folders · " + files + " files";
    }
    function render() {
      renderToolbar();
      renderTable(state.lastItems);
      updateCounter(state.lastItems);
    }

    // ---- navigation & viewer -------------------------------------------
    function navigate(path) { state.page = 1; load(path); }
    function openFile(item, full) {
      if (!viewer) {
        window.open("/sambafile?path=" + encodeURIComponent(full) + "&disposition=inline", "_blank");
        return;
      }
      if (opts.pdfInline && isViewable(item.name)) {
        viewer.innerHTML = "";
        var isImg = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(item.name);
        var url = "/sambafile?path=" + encodeURIComponent(full) + "&disposition=inline";
        var header = h("div", {
          class: "samba-fm-viewer-header d-flex align-items-center p-2 border-top",
        }, [
          h("strong", { text: item.name }, []),
          h("span", { class: "text-muted small ms-2", text: fmtSize(item.size) }, []),
          h("button", {
            type: "button", class: "btn btn-sm btn-outline-secondary ms-auto",
            onclick: function () { viewer.innerHTML = ""; },
          }, ["Close"]),
        ]);
        viewer.appendChild(header);
        if (isImg) {
          viewer.appendChild(h("img", {
            src: url,
            style: "max-width:100%;max-height:70vh;display:block;margin:0 auto;",
          }, []));
        } else {
          viewer.appendChild(h("iframe", {
            src: url, style: "width:100%;height:70vh;border:0;display:block;",
          }, []));
        }
      } else {
        window.open("/sambafile?path=" + encodeURIComponent(full) + "&disposition=inline", "_blank");
      }
    }

    // ---- write actions --------------------------------------------------
    function confirmDelete(item, full) {
      var body = h("div", {}, [
        h("p", {}, [
          "Delete ",
          h("strong", { text: item.name }, []),
          "?",
        ]),
        item.isDir
          ? h("div", { class: "alert alert-warning small mb-0" }, [
              "This will only succeed if the directory is empty.",
            ])
          : h("div", { class: "text-muted small" }, ["This action cannot be undone."]),
      ]);
      var m = modal("Confirm delete", body, [
        h("button", {
          type: "button", class: "btn btn-outline-secondary",
          onclick: function () { m.close(); },
        }, ["Cancel"]),
        h("button", {
          type: "button", class: "btn btn-danger",
          onclick: async function () {
            try {
              await postJson("/sambadelete", {
                path: full, isDir: item.isDir ? "1" : "0",
              }, opts.csrfToken);
              m.close();
              toast("Deleted " + item.name, "success");
              load(state.path);
            } catch (e) {
              toast("Delete failed: " + e.message, "error");
            }
          },
        }, ["Delete"]),
      ]);
    }

    function openRenameDialog(item, full) {
      var input = h("input", {
        type: "text", class: "form-control", value: item.name,
      }, []);
      var body = h("div", {}, [
        h("label", { class: "form-label small text-muted", text: "New name" }, []),
        input,
        h("div", { class: "form-text small", text: "Slashes are not allowed. Move by editing folder path? Use the ↗ browse feature instead." }, []),
      ]);
      var m = modal("Rename '" + item.name + "'", body, [
        h("button", {
          type: "button", class: "btn btn-outline-secondary",
          onclick: function () { m.close(); },
        }, ["Cancel"]),
        h("button", {
          type: "button", class: "btn btn-primary",
          onclick: async function () {
            var v = input.value.trim();
            if (!v || v === item.name) { m.close(); return; }
            try {
              await postJson("/sambarename", {
                from: full, newName: v,
              }, opts.csrfToken);
              m.close();
              toast("Renamed to " + v, "success");
              load(state.path);
            } catch (e) {
              toast("Rename failed: " + e.message, "error");
            }
          },
        }, ["Rename"]),
      ]);
      setTimeout(function () { input.focus(); input.select(); }, 20);
    }

    function openMkdirDialog() {
      var input = h("input", {
        type: "text", class: "form-control", placeholder: "New folder name",
      }, []);
      var body = h("div", {}, [
        h("label", { class: "form-label small text-muted", text: "Folder name" }, []),
        input,
      ]);
      var m = modal("Create folder in " + (state.path || "/"), body, [
        h("button", {
          type: "button", class: "btn btn-outline-secondary",
          onclick: function () { m.close(); },
        }, ["Cancel"]),
        h("button", {
          type: "button", class: "btn btn-primary",
          onclick: async function () {
            var v = input.value.trim();
            if (!v) return;
            try {
              await postJson("/sambamkdir", {
                path: state.path, name: v,
              }, opts.csrfToken);
              m.close();
              toast("Created folder " + v, "success");
              load(state.path);
            } catch (e) {
              toast("Create folder failed: " + e.message, "error");
            }
          },
        }, ["Create"]),
      ]);
      setTimeout(function () { input.focus(); }, 20);
    }

    function openUploadDialog() {
      var maxMb = Number(state.perms.maxUploadMb) || 50;
      var fileInput = h("input", {
        type: "file", class: "form-control", multiple: "multiple",
      }, []);
      var overwriteCb = h("input", { type: "checkbox", class: "form-check-input" }, []);
      var dropZone = h("div", {
        class: "samba-drop border rounded p-4 text-center text-muted",
        text: "Drop files here or click to select",
        onclick: function () { fileInput.click(); },
      }, []);
      var picked = h("div", { class: "samba-picked small mt-2" }, []);

      function setFiles(fileList) {
        fileInput.__files = Array.prototype.slice.call(fileList);
        picked.innerHTML = "";
        if (!fileInput.__files.length) return;
        var ul = h("ul", { class: "list-unstyled mb-0" }, []);
        fileInput.__files.forEach(function (f) {
          ul.appendChild(h("li", { text: f.name + " (" + fmtSize(f.size) + ")" }, []));
        });
        picked.appendChild(ul);
      }
      fileInput.addEventListener("change", function () { setFiles(fileInput.files); });
      ["dragenter", "dragover"].forEach(function (ev) {
        dropZone.addEventListener(ev, function (e) {
          e.preventDefault(); e.stopPropagation();
          dropZone.classList.add("samba-drop-active");
        });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        dropZone.addEventListener(ev, function (e) {
          e.preventDefault(); e.stopPropagation();
          dropZone.classList.remove("samba-drop-active");
        });
      });
      dropZone.addEventListener("drop", function (e) {
        if (e.dataTransfer && e.dataTransfer.files) setFiles(e.dataTransfer.files);
      });

      var progress = h("div", { class: "samba-upload-progress mt-2" }, []);
      var body = h("div", {}, [
        h("div", { class: "small text-muted mb-2" }, [
          "Uploading to ",
          h("code", { text: state.path || "/" }, []),
          ". Max " + maxMb + " MiB per file.",
        ]),
        dropZone,
        h("div", { class: "mt-2" }, [
          h("label", { class: "form-label small text-muted", text: "…or pick files" }, []),
          fileInput,
        ]),
        picked,
        h("label", { class: "form-check mt-2" }, [
          overwriteCb,
          h("span", { class: "form-check-label ms-1 small", text: "Overwrite existing files" }, []),
        ]),
        progress,
      ]);

      var uploadBtn;
      var m = modal("Upload files", body, [
        h("button", {
          type: "button", class: "btn btn-outline-secondary",
          onclick: function () { m.close(); },
        }, ["Cancel"]),
        (uploadBtn = h("button", {
          type: "button", class: "btn btn-primary",
          onclick: async function () {
            var files = fileInput.__files || Array.prototype.slice.call(fileInput.files || []);
            if (!files.length) { toast("No files selected", "error"); return; }
            uploadBtn.setAttribute("disabled", "disabled");
            try {
              var fd = new FormData();
              fd.append("path", state.path);
              fd.append("overwrite", overwriteCb.checked ? "1" : "0");
              files.forEach(function (f) { fd.append("file", f); });
              progress.innerHTML = "Uploading…";
              var r = await fetch("/sambaupload", {
                method: "POST",
                credentials: "same-origin",
                headers: { "X-CSRF-Token": opts.csrfToken || "" },
                body: fd,
              });
              var data = null;
              try { data = await r.json(); } catch (_) { data = null; }
              if (!r.ok && r.status !== 207) {
                throw new Error((data && data.error) || ("HTTP " + r.status));
              }
              var results = (data && data.results) || [];
              var okCount = results.filter(function (x) { return x.ok; }).length;
              var failed = results.filter(function (x) { return !x.ok; });
              if (failed.length) {
                progress.innerHTML = "";
                progress.appendChild(h("div", {
                  class: "alert alert-warning small mb-0",
                }, [
                  "Uploaded " + okCount + " / " + results.length + " files. Failures:",
                  h("ul", { class: "mb-0" }, failed.map(function (r) {
                    return h("li", { text: r.name + ": " + r.error }, []);
                  })),
                ]));
                toast("Some uploads failed", "error");
              } else {
                toast("Uploaded " + okCount + " file(s)", "success");
                m.close();
              }
              load(state.path);
            } catch (e) {
              progress.innerHTML = "";
              progress.appendChild(h("div", {
                class: "alert alert-danger small mb-0", text: "Upload failed: " + e.message,
              }, []));
              toast("Upload failed", "error");
            } finally {
              uploadBtn.removeAttribute("disabled");
            }
          },
        }, ["Upload"])),
      ]);
    }

    // ---- data ------------------------------------------------------------
    async function load(path) {
      state.path = path;
      root.innerHTML = '<div class="text-muted p-3">Loading…</div>';
      try {
        var data = await fetchDir(path, state.showHidden);
        state.lastItems = data.items || [];
        state.perms = data.perms || {};
        render();
      } catch (e) {
        root.innerHTML =
          '<div class="alert alert-danger m-2">Samba: ' + (e.message || String(e)) + "</div>";
        renderToolbar();
      }
    }
    load(state.path);
  }

  window.saltcornSambaMountFM = mount;
})();
