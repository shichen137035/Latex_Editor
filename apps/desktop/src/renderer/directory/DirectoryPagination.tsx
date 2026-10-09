import { t } from "../i18n/index.js";
import { DirectoryIcon } from "./DirectoryIcon.js";
import { directoryPageNumbers } from "./pagination.js";

export function DirectoryPagination({ index, count, onPage }: { index: number; count: number; onPage(index: number): void }) {
  if (count <= 1) return null;
  return <nav className="directory-pagination" aria-label={t("directory.pagination")}>
    <button type="button" className="directory-page-previous" disabled={index === 0} aria-label={t("directory.previousPage")} title={t("directory.previousPage")} onClick={() => onPage(index - 1)}><DirectoryIcon name="previous"/></button>
    {directoryPageNumbers(index, count).map((page, position) => page === "gap" ? <span key={`gap-${position}`} className="directory-page-gap">…</span> : <button type="button" key={page} aria-label={t("directory.goToPage", { page: page + 1 })} aria-current={page === index ? "page" : undefined} className={page === index ? "active" : ""} onClick={() => onPage(page)}>{page + 1}</button>)}
    <button type="button" className="directory-page-next" disabled={index === count - 1} aria-label={t("directory.nextPage")} title={t("directory.nextPage")} onClick={() => onPage(index + 1)}><DirectoryIcon name="next"/></button>
  </nav>;
}
