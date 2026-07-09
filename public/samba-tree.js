/**
 * saltcorn-samba – Client-Controller für die `SambaTree`-View.
 *
 * Rendert einen Lazy-loading-Verzeichnisbaum. Kinder werden per Klick über
 * /sambadir?path=... nachgeladen. Klick auf eine Datei öffnet sie entweder
 * inline (PDF/Bilder) im eingebauten Viewer <div> oder springt via /sambalink
 * (smb://) in den nativen Datei-Manager.
 *
 * Utilities (iconFor, joinPath, fmtSize, isViewable, i18n-Übersetzungen)
 * kommen aus dem gemeinsamen Modul `SambaCommon` (public/samba-common.js),
 * das der Server per <script>-Tag vor dieser Datei einbindet.
 */
(function () {
  "use strict";

  var C = window.SambaCommon || {};

  /**
   * Kleines DOM-Konstruktions-Helferlein. `attrs` unterstützt `class`,
   * `text` (setzt textContent) und beliebige `onXxx`-Handler; alle anderen
   * Attribute landen als HTML-Attribut.
   */
  function element(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "class") el.className = attrs[key];
        else if (key === "text") el.textContent = attrs[key];
        else if (key.slice(0, 2) === "on") {
          el.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
        } else {
          el.setAttribute(key, attrs[key]);
        }
      });
    }
    (children || []).forEach(function (child) {
      if (child == null) return;
      el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return el;
  }

  /** GET /sambadir für ein Verzeichnis. Wirft bei nicht-OK-Antworten. */
  async function fetchDirectory(path, showHidden) {
    var url =
      "/sambadir?path=" + encodeURIComponent(path || "") +
      (showHidden ? "&show_hidden=1" : "");
    var response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  /**
   * Rendert eine Ebene des Baums in `container`. Für jedes Item wird eine
   * Zeile mit Toggle-, Label- und Meta-Span erzeugt; Ordner haben zusätzlich
   * einen leeren Kindercontainer, der bei Bedarf lazy befüllt wird.
   */
  function renderLevel(container, path, items, opts, viewerElement) {
    container.innerHTML = "";
    var list = element("ul", { class: "samba-tree-list list-unstyled mb-0" }, []);

    items.forEach(function (item) {
      var fullPath = C.joinPath(path, item.name);
      var childrenBox = element("div", { class: "samba-tree-children ms-3" }, []);

      var toggle = element(
        "span",
        {
          class: "samba-tree-toggle me-1",
          text: item.isDir ? "▸" : " ",
          style: "cursor:pointer;display:inline-block;width:1em;",
        },
        []
      );
      var label = element(
        "span",
        {
          class: "samba-tree-label",
          text: C.iconFor(item) + " " + item.name,
          style: "cursor:pointer;",
          title: fullPath,
        },
        []
      );
      var meta = element(
        "span",
        {
          class: "samba-tree-meta text-muted small ms-2",
          text: item.isDir ? "" : C.fmtSize(item.size),
        },
        []
      );

      var externalButton = null;
      if (opts.exposeSmbLink) {
        externalButton = element(
          "a",
          {
            class: "samba-tree-external btn btn-sm btn-link p-0 ms-2",
            href: "/sambalink?path=" + encodeURIComponent(fullPath),
            target: "_blank",
            title: C.t("tree.open_in_fm_title"),
            text: "↗",
          },
          []
        );
      }

      /**
       * Toggle-Handler: erster Klick lädt die Kinder nach, weitere Klicks
       * schalten nur zwischen ausgeklappt/eingeklappt um.
       */
      var toggleDirectory = function () {
        if (childrenBox.dataset.loaded === "1") {
          var visible = childrenBox.style.display !== "none";
          childrenBox.style.display = visible ? "none" : "block";
          toggle.textContent = visible ? "▸" : "▾";
          return;
        }
        toggle.textContent = "…";
        fetchDirectory(fullPath, opts.showHidden)
          .then(function (data) {
            renderLevel(childrenBox, fullPath, data.items || [], opts, viewerElement);
            childrenBox.dataset.loaded = "1";
            childrenBox.style.display = "block";
            toggle.textContent = "▾";
          })
          .catch(function (err) {
            childrenBox.innerHTML =
              '<div class="text-danger small">' + C.t("tree.error_prefix") + err.message + "</div>";
            childrenBox.dataset.loaded = "1";
            toggle.textContent = "▸";
          });
      };

      /**
       * Datei-Klick-Handler: inline für ansehbare Formate, sonst Sprung ins
       * OS-Datei-Manager-Fenster.
       */
      var openFile = function () {
        if (!viewerElement) return;
        if (opts.pdfInline && C.isViewable(item.name)) {
          var streamUrl =
            "/sambafile?path=" + encodeURIComponent(fullPath) + "&disposition=inline";
          var isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(item.name);
          viewerElement.innerHTML = "";
          var header = element(
            "div",
            { class: "samba-viewer-header d-flex align-items-center mb-2" },
            [
              element("strong", { text: item.name }, []),
              element(
                "a",
                {
                  href: streamUrl,
                  target: "_blank",
                  class: "btn btn-sm btn-outline-secondary ms-auto me-2",
                  text: C.t("tree.open_new_tab"),
                },
                []
              ),
              element(
                "a",
                {
                  href:
                    "/sambafile?path=" +
                    encodeURIComponent(fullPath) +
                    "&disposition=attachment",
                  class: "btn btn-sm btn-outline-secondary me-2",
                  text: C.t("fm.download"),
                },
                []
              ),
              opts.exposeSmbLink
                ? element(
                    "a",
                    {
                      href: "/sambalink?path=" + encodeURIComponent(fullPath),
                      target: "_blank",
                      class: "btn btn-sm btn-outline-primary",
                      text: C.t("tree.open_in_fm"),
                    },
                    []
                  )
                : null,
            ]
          );
          viewerElement.appendChild(header);
          if (isImage) {
            viewerElement.appendChild(
              element(
                "img",
                {
                  src: streamUrl,
                  style:
                    "max-width:100%;max-height:70vh;border:1px solid #dee2e6;border-radius:4px;",
                },
                []
              )
            );
          } else {
            viewerElement.appendChild(
              element(
                "iframe",
                {
                  src: streamUrl,
                  style:
                    "width:100%;height:70vh;border:1px solid #dee2e6;border-radius:4px;",
                },
                []
              )
            );
          }
        } else {
          // Nicht inline-fähig: Klassischer Sprung in die smb://-Zwischenseite.
          window.open("/sambalink?path=" + encodeURIComponent(fullPath), "_blank");
        }
      };

      label.addEventListener("click", function () {
        if (item.isDir) toggleDirectory();
        else openFile();
      });
      toggle.addEventListener("click", function () {
        if (item.isDir) toggleDirectory();
      });

      var lineChildren = [toggle, label, meta];
      if (externalButton) lineChildren.push(externalButton);

      var lineItem = element("li", { class: "samba-tree-item" }, [
        element("div", { class: "samba-tree-line d-flex align-items-center" }, lineChildren),
        childrenBox,
      ]);
      childrenBox.style.display = "none";
      list.appendChild(lineItem);
    });

    if (!items.length) {
      container.appendChild(
        element(
          "div",
          { class: "text-muted small fst-italic p-2", text: C.t("ui.empty_short") },
          []
        )
      );
    } else {
      container.appendChild(list);
    }
  }

  /**
   * Einstiegspunkt – vom View-Shell aufgerufen.
   * `elementId` bezeichnet das Baum-Root-`<div>`; ein optionales
   * `elementId + "-viewer"` wird als Inline-Anzeige verwendet.
   */
  function mount(elementId) {
    var root = document.getElementById(elementId);
    if (!root || root.dataset.mounted === "1") return;
    root.dataset.mounted = "1";
    var viewer = document.getElementById(elementId + "-viewer");
    var opts = {};
    try {
      opts = JSON.parse(root.getAttribute("data-opts") || "{}");
    } catch (_) {
      opts = {};
    }
    root.innerHTML =
      '<div class="text-muted small p-2">' + C.t("ui.loading") + "</div>";
    fetchDirectory(opts.startPath || "", opts.showHidden)
      .then(function (data) {
        renderLevel(root, opts.startPath || "", data.items || [], opts, viewer);
      })
      .catch(function (err) {
        root.innerHTML =
          '<div class="alert alert-danger">' + C.t("tree.samba_prefix") + err.message + "</div>";
      });
  }

  window.saltcornSambaMount = mount;
})();
