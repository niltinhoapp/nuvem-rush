import type { DataRequestExport } from "./dataRequest";

export function downloadDataRequestJson(
  requestId: string,
  data: DataRequestExport,
) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `nuvem-rush-data-request-${requestId.slice(0, 12)}.json`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
