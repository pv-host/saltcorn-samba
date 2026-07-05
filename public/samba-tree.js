/**
 * Client-side directory tree for the SambaTree view template.
 *
 * Exposes window.saltcornSambaMount(elementId). The tree lazily loads
 * children from /sambadir?path=... and opens files either inline (PDF/image)
 * in the built-in viewer <div> or by redirecting to /sambalink (smb://).
 */
(function () {
  "use strict";

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs)
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") el.className = attrs[k];
        else if (k === "text") el.textContent = attrs[k];
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

  function iconFor(item) {
    if (item.isDir) return "📁";
    var n = (item.name || "").toLowerCase();
    if (n.endsWith(".pdf")) return "📄";
    if (/\.(png|jpe?g|gif|webp|svg|bmp)$/.test(n)) return "🖼️";
    if (/\.(docx?|odt|rtf|txt|md)$/.test(n)) return "📝";
    if (/\.(xlsx?|ods|csv)$/.test(n)) return "📊";
    if (/\.(zip|tar|gz|7z|rar)$/.test(n)) return "🗜️";
    return "📎";
  }

  function isViewable(name) {
    var n = (name || "").toLowerCase();
    return (
      n.endsWith(".pdf") ||
      /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(n) ||
      /\.(txt|md|json|xml|csv|html?)$/.test(n)
    );
  }

  function joinPath(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (a.replace(/\/+$/, "") + "/" + b.replace(/^\/+/, "")).replace(
      /\/+/g,
      "/"
    );
  }

  function fmtSize(n) {
    if (!n) return "";
    var u = ["B", "KB", "MB", "GB", "TB"];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + " " + u[i];
  }

  async function fetchDir(path, showHidden) {
    var url =
      "/sambadir?path=" +
      encodeURIComponent(path || "") +
      (showHidden ? "&show_hidden=1" : "");
    var r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function renderList(container, path, items, opts, viewerEl) {
    container.innerHTML = "";
    var ul = h("ul", { class: "samba-tree-list list-unstyled mb-0" }, []);

    items.forEach(function (item) {
      var full = joinPath(path, item.name);
      var childrenBox = h("div", { class: "samba-tree-children ms-3" }, []);
      var toggle = h(
        "span",
        {
          class: "samba-tree-toggle me-1",
          text: item.isDir ? "▸" : " ",
          style: "cursor:pointer;display:inline-block;width:1em;",
        },
        []
      );
      var label = h(
        "span",
        {
          class: "samba-tree-label",
          text: iconFor(item) + " " + item.name,
          style: "cursor:pointer;",
          title: full,
        },
        []
      );
      var meta = h(
        "span",
        {
          class: "samba-tree-meta text-muted small ms-2",
          text: item.isDir ? "" : fmtSize(item.size),
        },
        []
      );

      var externalBtn = null;
      if (opts.exposeSmbLink) {
        externalBtn = h(
          "a",
          {
            class: "samba-tree-external btn btn-sm btn-link p-0 ms-2",
            href: "/sambalink?path=" + encodeURIComponent(full),
            target: "_blank",
            title: "Open in file manager",
            text: "↗",
          },
          []
        );
      }

      var openDir = function () {
        if (childrenBox.dataset.loaded === "1") {
          var vis = childrenBox.style.display !== "none";
          childrenBox.style.display = vis ? "none" : "block";
          toggle.textContent = vis ? "▸" : "▾";
          return;
        }
        toggle.textContent = "…";
        fetchDir(full, opts.showHidden)
          .then(function (data) {
            renderList(childrenBox, full, data.items || [], opts, viewerEl);
            childrenBox.dataset.loaded = "1";
            childrenBox.style.display = "block";
            toggle.textContent = "▾";
          })
          .catch(function (e) {
            childrenBox.innerHTML =
              '<div class="text-danger small">Error: ' + e.message + "</div>";
            childrenBox.dataset.loaded = "1";
            toggle.textContent = "▸";
          });
      };

      var openFile = function () {
        if (!viewerEl) return;
        if (opts.pdfInline && isViewable(item.name)) {
          var url =
            "/sambafile?path=" +
            encodeURIComponent(full) +
            "&disposition=inline";
          var isImg = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(item.name);
          viewerEl.innerHTML = "";
          var header = h(
            "div",
            { class: "samba-viewer-header d-flex align-items-center mb-2" },
            [
              h("strong", { text: item.name }, []),
              h(
                "a",
                {
                  href: url,
                  target: "_blank",
                  class: "btn btn-sm btn-outline-secondary ms-auto me-2",
                  text: "Open in new tab",
                },
                []
              ),
              h(
                "a",
                {
                  href:
                    "/sambafile?path=" +
                    encodeURIComponent(full) +
                    "&disposition=attachment",
                  class: "btn btn-sm btn-outline-secondary me-2",
                  text: "Download",
                },
                []
              ),
              opts.exposeSmbLink
                ? h(
                    "a",
                    {
                      href: "/sambalink?path=" + encodeURIComponent(full),
                      target: "_blank",
                      class: "btn btn-sm btn-outline-primary",
                      text: "Open in file manager",
                    },
                    []
                  )
                : null,
            ]
          );
          viewerEl.appendChild(header);
          if (isImg) {
            viewerEl.appendChild(
              h(
                "img",
                {
                  src: url,
                  style:
                    "max-width:100%;max-height:70vh;border:1px solid #dee2e6;border-radius:4px;",
                },
                []
              )
            );
          } else {
            viewerEl.appendChild(
              h(
                "iframe",
                {
                  src: url,
                  style:
                    "width:100%;height:70vh;border:1px solid #dee2e6;border-radius:4px;",
                },
                []
              )
            );
          }
        } else {
          // Not inline-viewable – fall back to the external link page.
          window.open(
            "/sambalink?path=" + encodeURIComponent(full),
            "_blank"
          );
        }
      };

      label.addEventListener("click", function () {
        if (item.isDir) openDir();
        else openFile();
      });
      toggle.addEventListener("click", function () {
        if (item.isDir) openDir();
      });

      var lineChildren = [toggle, label, meta];
      if (externalBtn) lineChildren.push(externalBtn);

      var li = h("li", { class: "samba-tree-item" }, [
        h("div", { class: "samba-tree-line d-flex align-items-center" }, lineChildren),
        childrenBox,
      ]);
      childrenBox.style.display = "none";
      ul.appendChild(li);
    });

    if (!items.length) {
      container.appendChild(
        h(
          "div",
          { class: "text-muted small fst-italic p-2", text: "(empty)" },
          []
        )
      );
    } else {
      container.appendChild(ul);
    }
  }

  function mount(elId) {
    var el = document.getElementById(elId);
    if (!el || el.dataset.mounted === "1") return;
    el.dataset.mounted = "1";
    var viewer = document.getElementById(elId + "-viewer");
    var opts = {};
    try {
      opts = JSON.parse(el.getAttribute("data-opts") || "{}");
    } catch (_) {
      opts = {};
    }
    el.innerHTML =
      '<div class="text-muted small p-2">Loading…</div>';
    fetchDir(opts.startPath || "", opts.showHidden)
      .then(function (data) {
        renderList(el, opts.startPath || "", data.items || [], opts, viewer);
      })
      .catch(function (e) {
        el.innerHTML =
          '<div class="alert alert-danger">Samba: ' + e.message + "</div>";
      });
  }

  window.saltcornSambaMount = mount;
})();
