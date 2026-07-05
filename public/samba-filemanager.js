/**
 * Client-side controller for the SambaFileManager view.
 *
 * Exposes `window.saltcornSambaMountFM(id, opts)` where `id` is the DOM id
 * prefix used by the shell (see filemanager-view.js). Fetches directory
 * listings from `/sambadir` and files from `/sambafile`.
 *
 * The UI mirrors Saltcorn's Settings → Files page: a table with icon, name,
 * media type, size, modified date and per-row actions, plus a breadcrumb
 * path bar with an "up" button.
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
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      txt: "text/plain",
      md: "text/markdown",
      csv: "text/csv",
      json: "application/json",
      xml: "application/xml",
      html: "text/html",
      htm: "text/html",
      zip: "application/zip",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      mp3: "audio/mpeg",
      mp4: "video/mp4",
      mkv: "video/x-matroska",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
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
    var pad = function (x) {
      return String(x).padStart(2, "0");
    };
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
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
    return (
      n.endsWith(".pdf") ||
      /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(n) ||
      /\.(txt|md|json|xml|csv|html?)$/.test(n)
    );
  }

  async function fetchDir(path, showHidden) {
    var url =
      "/sambadir?path=" +
      encodeURIComponent(path || "") +
      (showHidden ? "&show_hidden=1" : "");
    var r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) {
      var msg = "";
      try {
        msg = (await r.json()).error;
      } catch (_) {
        msg = "HTTP " + r.status;
      }
      throw new Error(msg || "HTTP " + r.status);
    }
    return r.json();
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
    };

    function canGoUp() {
      if (!opts.allowNavigateUp) return false;
      // Never let the user escape the root computed by the view configuration.
      return state.path.length > state.rootPath.length;
    }

    function renderToolbar() {
      toolbar.innerHTML = "";
      var upBtn = h(
        "button",
        {
          type: "button",
          class:
            "btn btn-sm btn-outline-secondary me-2" +
            (canGoUp() ? "" : " disabled"),
          onclick: function () {
            if (canGoUp()) navigate(parentOf(state.path));
          },
          title: "Up one directory",
        },
        ["⬆ Up"]
      );
      var homeBtn = h(
        "button",
        {
          type: "button",
          class:
            "btn btn-sm btn-outline-secondary me-2" +
            (state.path === state.rootPath ? " disabled" : ""),
          onclick: function () {
            navigate(state.rootPath);
          },
          title: "Go to root",
        },
        ["🏠"]
      );
      var reloadBtn = h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-outline-secondary me-2",
          onclick: function () {
            load(state.path);
          },
          title: "Refresh",
        },
        ["↻"]
      );

      var breadcrumb = h("nav", { class: "d-inline-block", "aria-label": "breadcrumb" }, [
        (function () {
          var ol = h("ol", { class: "breadcrumb mb-0 d-inline-flex" }, []);
          var segs = [];
          var rel = state.path.slice(state.rootPath.length).replace(/^\/+/, "");
          var parts = rel ? rel.split("/") : [];
          // root crumb
          ol.appendChild(
            h("li", { class: "breadcrumb-item" + (parts.length ? "" : " active") }, [
              parts.length
                ? h(
                    "a",
                    {
                      href: "#",
                      onclick: function (e) {
                        e.preventDefault();
                        navigate(state.rootPath);
                      },
                    },
                    ["/"]
                  )
                : "/",
            ])
          );
          var cur = state.rootPath;
          parts.forEach(function (seg, idx) {
            cur = joinPath(cur, seg);
            var isLast = idx === parts.length - 1;
            var target = cur;
            ol.appendChild(
              h(
                "li",
                { class: "breadcrumb-item" + (isLast ? " active" : "") },
                [
                  isLast
                    ? seg
                    : h(
                        "a",
                        {
                          href: "#",
                          onclick: function (e) {
                            e.preventDefault();
                            navigate(target);
                          },
                        },
                        [seg]
                      ),
                ]
              )
            );
          });
          return ol;
        })(),
      ]);

      var hiddenToggle = h(
        "label",
        { class: "form-check form-check-inline ms-3 mb-0 align-middle" },
        [
          h(
            "input",
            {
              type: "checkbox",
              class: "form-check-input",
              onchange: function (e) {
                state.showHidden = e.target.checked;
                load(state.path);
              },
            },
            []
          ),
          h(
            "span",
            { class: "form-check-label small ms-1", text: "Show hidden" },
            []
          ),
        ]
      );
      hiddenToggle.querySelector("input").checked = state.showHidden;

      toolbar.appendChild(upBtn);
      toolbar.appendChild(homeBtn);
      toolbar.appendChild(reloadBtn);
      toolbar.appendChild(breadcrumb);
      toolbar.appendChild(hiddenToggle);
    }

    function sortItems(items) {
      var by = state.sortBy;
      var dir = state.sortDir;
      return items.slice().sort(function (a, b) {
        // directories first
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        var va, vb;
        if (by === "size") {
          va = a.size || 0;
          vb = b.size || 0;
        } else if (by === "mtime") {
          va = a.mtime ? new Date(a.mtime).getTime() : 0;
          vb = b.mtime ? new Date(b.mtime).getTime() : 0;
        } else if (by === "type") {
          va = mediaTypeFor(a);
          vb = mediaTypeFor(b);
        } else {
          va = String(a.name).toLowerCase();
          vb = String(b.name).toLowerCase();
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }

    function sortHeader(label, key) {
      var arrow =
        state.sortBy === key ? (state.sortDir > 0 ? " ▲" : " ▼") : "";
      return h(
        "th",
        {
          class: "samba-fm-th",
          style: "cursor:pointer;user-select:none;",
          onclick: function () {
            if (state.sortBy === key) state.sortDir = -state.sortDir;
            else {
              state.sortBy = key;
              state.sortDir = 1;
            }
            render();
          },
        },
        [label + arrow]
      );
    }

    function renderTable(items) {
      root.innerHTML = "";
      var table = h(
        "table",
        { class: "table table-sm table-hover mb-0 samba-fm-table align-middle" },
        [
          h("thead", {}, [
            h("tr", {}, [
              h("th", { style: "width:2.4rem;" }, []),
              sortHeader("Filename", "name"),
              sortHeader("Media type", "type"),
              sortHeader("Size", "size"),
              sortHeader("Modified", "mtime"),
              h("th", { style: "width:14rem;" }, ["Actions"]),
            ]),
          ]),
        ]
      );

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
          isDir
            ? h(
                "a",
                {
                  href: "#",
                  class: "samba-fm-name",
                  onclick: function (e) {
                    e.preventDefault();
                    navigate(full);
                  },
                },
                [item.name]
              )
            : h(
                "a",
                {
                  href: "#",
                  class: "samba-fm-name",
                  onclick: function (e) {
                    e.preventDefault();
                    openFile(item, full);
                  },
                },
                [item.name]
              ),
        ]);

        var actions = [];
        if (isDir) {
          actions.push(
            h(
              "button",
              {
                type: "button",
                class: "btn btn-sm btn-outline-secondary me-1",
                onclick: function () {
                  navigate(full);
                },
              },
              ["Open"]
            )
          );
        } else {
          actions.push(
            h(
              "a",
              {
                class: "btn btn-sm btn-outline-secondary me-1",
                href:
                  "/sambafile?path=" +
                  encodeURIComponent(full) +
                  "&disposition=inline",
                target: "_blank",
                title: "Open in new tab",
              },
              ["View"]
            )
          );
          actions.push(
            h(
              "a",
              {
                class: "btn btn-sm btn-outline-secondary me-1",
                href:
                  "/sambafile?path=" +
                  encodeURIComponent(full) +
                  "&disposition=attachment",
                title: "Download",
              },
              ["Download"]
            )
          );
        }
        if (opts.exposeSmbLink) {
          actions.push(
            h(
              "a",
              {
                class: "btn btn-sm btn-outline-primary",
                href: "/sambalink?path=" + encodeURIComponent(full),
                target: "_blank",
                title: "Open in file manager (Nemo/Nautilus/Explorer)",
              },
              ["↗"]
            )
          );
        }

        tbody.appendChild(
          h("tr", {}, [
            h("td", { class: "samba-fm-icon", style: "font-size:1.2rem;" }, [
              iconFor(item),
            ]),
            nameCell,
            h("td", { class: "text-muted small" }, [mediaTypeFor(item)]),
            h("td", { class: "text-muted small" }, [isDir ? "" : fmtSize(item.size)]),
            h("td", { class: "text-muted small" }, [fmtDate(item.mtime)]),
            h("td", {}, actions),
          ])
        );
      });

      table.appendChild(tbody);
      root.appendChild(table);

      if (!items.length) {
        root.appendChild(
          h(
            "div",
            {
              class: "text-muted fst-italic p-3 text-center",
              text: "(empty directory)",
            },
            []
          )
        );
      }

      // pagination
      if (state.pageSize > 0 && sorted.length > state.pageSize) {
        var totalPages = Math.ceil(sorted.length / state.pageSize);
        var pager = h(
          "div",
          { class: "d-flex align-items-center justify-content-end p-2 border-top" },
          [
            h(
              "span",
              { class: "text-muted small me-2", text: "Page " + state.page + " / " + totalPages },
              []
            ),
            h(
              "button",
              {
                type: "button",
                class:
                  "btn btn-sm btn-outline-secondary me-1" +
                  (state.page <= 1 ? " disabled" : ""),
                onclick: function () {
                  if (state.page > 1) {
                    state.page--;
                    render();
                  }
                },
              },
              ["‹"]
            ),
            h(
              "button",
              {
                type: "button",
                class:
                  "btn btn-sm btn-outline-secondary" +
                  (state.page >= totalPages ? " disabled" : ""),
                onclick: function () {
                  if (state.page < totalPages) {
                    state.page++;
                    render();
                  }
                },
              },
              ["›"]
            ),
          ]
        );
        root.appendChild(pager);
      }
    }

    function updateCounter(items) {
      if (!counter) return;
      var dirs = items.filter(function (i) {
        return i.isDir;
      }).length;
      var files = items.length - dirs;
      counter.textContent = dirs + " folders · " + files + " files";
    }

    function render() {
      renderToolbar();
      renderTable(state.lastItems);
      updateCounter(state.lastItems);
    }

    function navigate(path) {
      state.page = 1;
      load(path);
    }

    function openFile(item, full) {
      if (!viewer) {
        window.open(
          "/sambafile?path=" + encodeURIComponent(full) + "&disposition=inline",
          "_blank"
        );
        return;
      }
      if (opts.pdfInline && isViewable(item.name)) {
        viewer.innerHTML = "";
        var isImg = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(item.name);
        var url =
          "/sambafile?path=" + encodeURIComponent(full) + "&disposition=inline";
        var closeBtn = h(
          "button",
          {
            type: "button",
            class: "btn btn-sm btn-outline-secondary ms-auto",
            onclick: function () {
              viewer.innerHTML = "";
            },
          },
          ["Close"]
        );
        var header = h(
          "div",
          {
            class:
              "samba-fm-viewer-header d-flex align-items-center p-2 border-top",
          },
          [
            h("strong", { text: item.name }, []),
            h("span", { class: "text-muted small ms-2", text: fmtSize(item.size) }, []),
            closeBtn,
          ]
        );
        viewer.appendChild(header);
        if (isImg) {
          viewer.appendChild(
            h(
              "img",
              {
                src: url,
                style:
                  "max-width:100%;max-height:70vh;display:block;margin:0 auto;",
              },
              []
            )
          );
        } else {
          viewer.appendChild(
            h(
              "iframe",
              {
                src: url,
                style:
                  "width:100%;height:70vh;border:0;display:block;",
              },
              []
            )
          );
        }
      } else {
        window.open(
          "/sambafile?path=" + encodeURIComponent(full) + "&disposition=inline",
          "_blank"
        );
      }
    }

    async function load(path) {
      state.path = path;
      root.innerHTML =
        '<div class="text-muted p-3">Loading…</div>';
      try {
        var data = await fetchDir(path, state.showHidden);
        state.lastItems = data.items || [];
        render();
      } catch (e) {
        root.innerHTML =
          '<div class="alert alert-danger m-2">Samba: ' +
          (e.message || String(e)) +
          "</div>";
        // Still render the toolbar so the user can go up / retry.
        renderToolbar();
      }
    }

    load(state.path);
  }

  window.saltcornSambaMountFM = mount;
})();
