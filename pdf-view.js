/**
 * Fieldview: `samba_pdf` – for String fields that store a path (relative to
 * the plugin base_path) to a file on the Samba share. Renders one of:
 *
 *   - inline PDF viewer (<iframe>) for .pdf
 *   - inline <img> for images
 *   - a download / "open in external app" pair of buttons for everything else
 *
 * The rendered HTML is self-contained; no external JavaScript needed for the
 * fieldview itself.
 */

const {
  div,
  a,
  iframe,
  img,
  i,
  span,
  button,
} = require("@saltcorn/markup/tags");
const { text } = require("@saltcorn/markup");

/** Extract the file extension in lowercase, without the dot. */
function extOf(name) {
  const s = String(name || "");
  const dot = s.lastIndexOf(".");
  return dot >= 0 ? s.slice(dot + 1).toLowerCase() : "";
}

function isPdf(name) {
  return extOf(name) === "pdf";
}

function isImage(name) {
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(extOf(name));
}

/**
 * Build a download URL served by the plugin route (defined in index.js).
 * `disposition` is "inline" or "attachment".
 */
function fileUrl(value, disposition = "inline") {
  const q = new URLSearchParams({
    path: value || "",
    disposition,
  }).toString();
  return `/sambafile?${q}`;
}

/** smb:// link for external file managers (Nemo, Nautilus, Explorer). */
function smbUrl(value) {
  return `/sambalink?path=${encodeURIComponent(value || "")}`;
}

// ---------------------------------------------------------------------------
// Fieldview definition
// ---------------------------------------------------------------------------

const samba_pdf = {
  isEdit: false,
  description:
    "Show a file stored on the Samba share. PDFs are embedded inline; other files get open/download buttons.",
  configFields: () => [
    {
      name: "height",
      label: "Viewer height (px)",
      type: "Integer",
      default: 700,
    },
    {
      name: "show_download",
      label: "Show download button",
      type: "Bool",
      default: true,
    },
    {
      name: "show_external",
      label: "Show 'Open in file manager' button (smb://)",
      type: "Bool",
      default: true,
    },
    {
      name: "force_download_only",
      label: "Never embed – always show buttons",
      type: "Bool",
      default: false,
    },
  ],
  run: (value, req, options = {}) => {
    if (!value) return span({ class: "text-muted" }, "—");
    const safeVal = text(String(value));
    const height = Number(options.height) > 0 ? Number(options.height) : 700;

    const buttons = [];
    if (options.show_download !== false) {
      buttons.push(
        a(
          {
            href: fileUrl(safeVal, "attachment"),
            class: "btn btn-sm btn-outline-secondary me-2",
          },
          i({ class: "fas fa-download me-1" }),
          "Download"
        )
      );
    }
    if (options.show_external !== false) {
      buttons.push(
        a(
          {
            href: smbUrl(safeVal),
            class: "btn btn-sm btn-outline-primary me-2",
            title: "Open in Nemo/Nautilus/Explorer",
          },
          i({ class: "fas fa-external-link-alt me-1" }),
          "Open in file manager"
        )
      );
    }
    buttons.push(
      a(
        {
          href: fileUrl(safeVal, "inline"),
          target: "_blank",
          class: "btn btn-sm btn-outline-secondary",
        },
        i({ class: "fas fa-eye me-1" }),
        "Open in new tab"
      )
    );

    let body;
    if (options.force_download_only) {
      body = "";
    } else if (isPdf(safeVal)) {
      body = iframe({
        src: fileUrl(safeVal, "inline"),
        style: `width:100%;height:${height}px;border:1px solid #dee2e6;border-radius:4px;`,
      });
    } else if (isImage(safeVal)) {
      body = img({
        src: fileUrl(safeVal, "inline"),
        style: `max-width:100%;max-height:${height}px;border:1px solid #dee2e6;border-radius:4px;`,
        alt: safeVal,
      });
    } else {
      body = div(
        { class: "text-muted small mb-2" },
        i({ class: "fas fa-file me-1" }),
        safeVal
      );
    }

    return div(
      { class: "samba-pdf-fieldview" },
      div({ class: "samba-pdf-buttons mb-2" }, ...buttons),
      body
    );
  },
};

module.exports = { samba_pdf };
